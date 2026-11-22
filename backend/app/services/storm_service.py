"""Storms: a project's library of rainfall events, and runs of any scenario
under any storm.

A storm is a SWMM rain file (``storms/<id>.dat``, station format) with a
little metadata in ``storms/storms.json``: its name, how its values are
recorded (VOLUME / INTENSITY / CUMULATIVE), the recording interval, units,
when it starts and ends, and how long to keep simulating after it ends.

"model" is the built-in storm meaning "the rainfall the model itself
specifies". Running a scenario under any other storm never edits the
scenario's .inp: the run uses a generated copy in a cell folder next to it,

    <scenario dir>/.storms/<storm id>/<model>.inp|.out|.rpt

in which every rain gage reads the storm's file and the simulation window
covers the storm plus its after-time. LID reports land beside that copy.
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

MODEL = "model"
STORMS_DIR = "storms"
CELL_DIR = ".storms"
FORMATS = ("VOLUME", "INTENSITY", "CUMULATIVE")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")
_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]")
_STA = re.compile(r"^\s*(\S+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([+-]?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*$")
_DT = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s+([+-]?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)\s*$")
WINDOW_KEYS = ("START_DATE", "START_TIME", "REPORT_START_DATE", "REPORT_START_TIME", "END_DATE", "END_TIME")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "storm"


def parse_rain_text(text: str, default_station: str = "STORM") -> dict[str, Any]:
    """Records of a SWMM rain file. Date-style lines (MM/DD/YYYY hh:mm v) are
    rewritten in station format. Returns station, start, end (datetimes),
    total, record count and the normalised text."""
    rows: list[tuple[str, datetime, float]] = []
    comments: list[str] = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith(";"):
            comments.append(s)
            continue
        m = _STA.match(s)
        if m:
            y, mo, d, h, mi = (int(m.group(i)) for i in range(2, 7))
            rows.append((m.group(1), datetime(y, mo, d) + timedelta(hours=h, minutes=mi), float(m.group(7))))
            continue
        m = _DT.match(s)
        if m:
            mo, d, y, h, mi = (int(m.group(i)) for i in range(1, 6))
            rows.append((default_station, datetime(y, mo, d) + timedelta(hours=h, minutes=mi), float(m.group(6))))
            continue
    if not rows:
        raise HTTPException(status_code=400, detail="No rainfall records found. Use SWMM's station format (Station Year Month Day Hour Minute Value) or MM/DD/YYYY hh:mm value.")
    stations = {r[0] for r in rows}
    if len(stations) > 1:
        raise HTTPException(status_code=400, detail=f"The file has {len(stations)} stations; a storm needs one.")
    station = rows[0][0]
    rows.sort(key=lambda r: r[1])
    body = [*comments, *(f"{station}\t{t.year}\t{t.month}\t{t.day}\t{t.hour}\t{t.minute}\t{v:g}" for _, t, v in rows)]
    return {
        "station": station,
        "start": rows[0][1],
        "last": rows[-1][1],
        "records": len(rows),
        "total": sum(v for *_, v in rows),
        "text": "\n".join(body) + "\n",
    }


def _interval_minutes(interval: str) -> int:
    m = re.match(r"^\s*(\d+):(\d{1,2})\s*$", interval or "")
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    try:
        return max(1, int(round(float(interval) * 60)))  # decimal hours
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Bad recording interval: {interval}") from exc


def _fmt_interval(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


class StormService:
    # ------------------------------------------------------------ library
    def _dir(self) -> Path:
        from app.services.project_service import project_service

        return project_service.require_root() / STORMS_DIR

    def _load(self) -> list[dict[str, Any]]:
        p = self._dir() / "storms.json"
        if not p.is_file():
            return []
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        return [s for s in data.get("storms", []) if isinstance(s, dict) and _ID_RE.match(str(s.get("id", "")))]

    def _save(self, storms: list[dict[str, Any]]) -> None:
        d = self._dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / "storms.json").write_text(json.dumps({"version": 1, "storms": storms}, indent=2) + "\n", encoding="utf-8")

    def _public(self, s: dict[str, Any]) -> dict[str, Any]:
        return {k: s.get(k) for k in ("id", "name", "kind", "file", "format", "interval", "units", "start", "end", "after_hours", "total", "return_period", "duration_hr", "note")}

    def model_entry(self) -> dict[str, Any]:
        return {"id": MODEL, "name": "Model rainfall", "kind": "model", "file": None, "format": None, "interval": None, "units": None,
                "start": None, "end": None, "after_hours": None, "total": None, "return_period": None, "duration_hr": None,
                "note": self._model_gages()}

    @staticmethod
    def _model_gages() -> str:
        """What the active model's rain gages read, e.g. "RG1: time series 2yr24hr"."""
        try:
            from app.services.project_service import project_service

            text = project_service.require_inp().read_text(encoding="utf-8", errors="replace")
        except Exception:
            return "The rain gages as the model sets them"
        parts, sec = [], ""
        for raw in text.splitlines():
            m = _SECTION_RE.match(raw)
            if m:
                sec = m.group(1).strip().upper()
                continue
            s = raw.strip()
            if sec != "RAINGAGES" or not s or s.startswith(";"):
                continue
            tok = s.split()
            if len(tok) >= 6:
                src = tok[4].upper()
                what = f"time series {tok[5]}" if src == "TIMESERIES" else f"file {Path(tok[5].strip(chr(34))).name}"
                parts.append(f"{tok[0]}: {what}")
        return "; ".join(parts[:3]) + (f" and {len(parts) - 3} more" if len(parts) > 3 else "") if parts else "The rain gages as the model sets them"

    def list(self) -> dict[str, Any]:
        from app.services.project_service import project_service

        return {"active": project_service.active_storm_id(), "storms": [self.model_entry(), *(self._public(s) for s in self._load())]}

    def get(self, sid: str) -> dict[str, Any]:
        if sid == MODEL:
            return self.model_entry()
        for s in self._load():
            if s["id"] == sid:
                return s
        raise HTTPException(status_code=404, detail=f"Storm not found: {sid}")

    def exists(self, sid: str) -> bool:
        return sid == MODEL or any(s["id"] == sid for s in self._load())

    def create(
        self,
        name: str,
        text: str,
        *,
        fmt: str = "VOLUME",
        interval: str = "0:05",
        units: str = "IN",
        after_hours: float = 12.0,
        kind: str = "design",
        return_period: Optional[float] = None,
        duration_hr: Optional[float] = None,
        note: str = "",
        replace: bool = True,
    ) -> dict[str, Any]:
        name = name.strip() or "Storm"
        fmt = fmt.upper()
        if fmt not in FORMATS:
            raise HTTPException(status_code=400, detail=f"Format must be one of {', '.join(FORMATS)}")
        units = units.upper()
        if units not in ("IN", "MM"):
            raise HTTPException(status_code=400, detail="Units must be IN or MM")
        minutes = _interval_minutes(interval)
        parsed = parse_rain_text(text)
        storms = self._load()
        sid = _slug(name)
        same = next((s for s in storms if s["id"] == sid), None)
        if same and not replace:
            n = 2
            while any(s["id"] == f"{sid}-{n}" for s in storms):
                n += 1
            sid, same = f"{sid}-{n}", None
        d = self._dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{sid}.dat").write_text(parsed["text"], encoding="utf-8")
        end = parsed["last"] + timedelta(minutes=minutes)
        entry = {
            "id": sid,
            "name": name,
            "kind": kind if kind in ("design", "record") else "design",
            "file": f"{sid}.dat",
            "station": parsed["station"],
            "format": fmt,
            "interval": _fmt_interval(minutes),
            "units": units,
            "start": parsed["start"].isoformat(timespec="minutes"),
            "end": end.isoformat(timespec="minutes"),
            "after_hours": float(after_hours),
            "total": round(parsed["total"], 4) if fmt == "VOLUME" else None,
            "return_period": return_period,
            "duration_hr": duration_hr,
            "note": note,
            "created": datetime.now().isoformat(timespec="seconds"),
        }
        if same:
            storms = [entry if s["id"] == sid else s for s in storms]
            self._drop_cells(sid)  # results of the old storm no longer apply
        else:
            storms.append(entry)
        self._save(storms)
        return self._public(entry)

    def update(self, sid: str, name: Optional[str] = None, after_hours: Optional[float] = None) -> dict[str, Any]:
        storms = self._load()
        s = next((x for x in storms if x["id"] == sid), None)
        if s is None:
            raise HTTPException(status_code=404, detail=f"Storm not found: {sid}")
        if name is not None and name.strip():
            s["name"] = name.strip()
        if after_hours is not None:
            s["after_hours"] = max(0.0, float(after_hours))
        self._save(storms)
        return self._public(s)

    def delete(self, sid: str) -> dict[str, Any]:
        from app.services.project_service import project_service

        if sid == MODEL:
            raise HTTPException(status_code=400, detail="The model's own rainfall can't be deleted")
        storms = self._load()
        if not any(s["id"] == sid for s in storms):
            raise HTTPException(status_code=404, detail=f"Storm not found: {sid}")
        if project_service.active_storm_id() == sid:
            project_service.set_active_storm(MODEL)
        self._save([s for s in storms if s["id"] != sid])
        f = self._dir() / f"{sid}.dat"
        if f.is_file():
            f.unlink()
        self._drop_cells(sid)
        return self.list()

    def _drop_cells(self, sid: str) -> None:
        for inp in self.scenario_inps().values():
            d = inp.parent / CELL_DIR / sid
            if d.is_dir():
                shutil.rmtree(d, ignore_errors=True)

    # ------------------------------------------------------------ cells
    @staticmethod
    def scenario_inps() -> dict[str, Path]:
        from app.services.project_service import project_service
        from app.services.scenario_service import scenario_service

        out = {"base": project_service.base_inp()}
        for s in scenario_service.list()["scenarios"]:
            if s["id"] != "base":
                try:
                    out[s["id"]] = scenario_service.inp_path(s["id"])
                except HTTPException:
                    pass
        return out

    def cell_paths(self, inp: Path, storm: str) -> tuple[Path, Path, Path]:
        """(input the engine runs, .out, .rpt) for a scenario's .inp under a storm."""
        if storm == MODEL:
            return inp, inp.with_suffix(".out"), inp.with_suffix(".rpt")
        d = inp.parent / CELL_DIR / storm
        run = d / inp.name
        return run, run.with_suffix(".out"), run.with_suffix(".rpt")

    def prepare_cell(self, inp: Path, storm: str) -> Path:
        """Write the run copy of ``inp`` under ``storm`` and return its path."""
        if storm == MODEL:
            return inp
        from app.services.fs_utils import atomic_write_text
        from app.services.scenario_service import _rewrite_file_refs

        s = self.get(storm)
        run, _, _ = self.cell_paths(inp, storm)
        run.parent.mkdir(parents=True, exist_ok=True)
        text = inp.read_text(encoding="utf-8", errors="replace")
        text = _rewrite_file_refs(text, inp.parent, run.parent)
        rain = (self._dir() / s["file"]).resolve()
        start = datetime.fromisoformat(s["start"])
        end = datetime.fromisoformat(s["end"]) + timedelta(hours=float(s.get("after_hours") or 0))
        text = apply_storm(text, str(rain), s.get("station") or "STORM", s["format"], s["interval"], s["units"], start, end)
        atomic_write_text(run, text)
        return run

    def cell_stale(self, inp: Path, storm: str) -> bool:
        _, out, _ = self.cell_paths(inp, storm)
        if not out.is_file():
            return False
        newest = inp.stat().st_mtime
        if storm != MODEL:
            f = self._dir() / self.get(storm)["file"]
            if f.is_file():
                newest = max(newest, f.stat().st_mtime)
        return newest > out.stat().st_mtime + 1.0


def apply_storm(text: str, rain_path: str, station: str, fmt: str, interval: str, units: str, start: datetime, end: datetime) -> str:
    """Point every rain gage at ``rain_path`` and fit the simulation window."""
    lines = text.splitlines()
    out: list[str] = []
    sec = ""
    seen_window: set[str] = set()
    window = {
        "START_DATE": start.strftime("%m/%d/%Y"),
        "START_TIME": start.strftime("%H:%M:%S"),
        "REPORT_START_DATE": start.strftime("%m/%d/%Y"),
        "REPORT_START_TIME": start.strftime("%H:%M:%S"),
        "END_DATE": end.strftime("%m/%d/%Y"),
        "END_TIME": end.strftime("%H:%M:%S"),
    }
    path_tok = '"' + rain_path.replace("\\", "/") + '"'

    def close_options() -> None:
        for k in WINDOW_KEYS:
            if k not in seen_window:
                out.append(f"{k:<20} {window[k]}")

    for raw in lines:
        m = _SECTION_RE.match(raw)
        if m:
            if sec == "OPTIONS":
                close_options()
            sec = m.group(1).strip().upper()
            out.append(raw)
            continue
        s = raw.strip()
        if not s or s.startswith(";"):
            out.append(raw)
            continue
        tok = s.split()
        if sec == "OPTIONS" and tok[0].upper() in window:
            key = tok[0].upper()
            seen_window.add(key)
            out.append(f"{key:<20} {window[key]}")
            continue
        if sec == "RAINGAGES":
            out.append(f"{tok[0]:<16} {fmt:<10} {interval:<8} 1.0      FILE       {path_tok} {station} {units}")
            continue
        out.append(raw)
    if sec == "OPTIONS":
        close_options()
    return "\n".join(out) + "\n"


storm_service = StormService()
