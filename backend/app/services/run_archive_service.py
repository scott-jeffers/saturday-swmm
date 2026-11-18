"""Keep every completed run so runs can be compared.

When a run started in this session completes, its ``.out`` and ``.rpt`` are
copied to ``<project>/runs/<id>/`` with a ``run.json`` describing the engine,
scenario and headline results. The newest :data:`KEEP_UNPINNED` unpinned runs
are kept; pinned runs are kept until the user deletes them.

``"current"`` stands for the project's live ``.out``/``.rpt`` wherever a run
id is accepted.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services import rpt_service

KEEP_UNPINNED = 20
RUNS_DIR = "runs"
_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")

# rpt table → (id column, [(column, label)]) compared between two runs.
COMPARE_TABLES: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "Node Flooding Summary": ("node", [("Total Flood Volume", "Flood volume"), ("Hours Flooded", "Hours flooded")]),
    "Node Depth Summary": ("node", [("Maximum Depth", "Max depth"), ("Maximum HGL", "Max HGL")]),
    "Link Flow Summary": ("link", [("Maximum Flow", "Max flow"), ("Maximum Velocity", "Max velocity"), ("Max/Full Flow", "Max/full flow")]),
    "Subcatchment Runoff Summary": ("subcatchment", [("Peak Runoff", "Peak runoff"), ("Total Runoff Volume", "Runoff volume")]),
}
SUMMARY_KEYS = (
    "flooded_nodes",
    "flood_volume",
    "surcharged_nodes",
    "surcharged_conduits",
    "runoff_continuity_pct",
    "routing_continuity_pct",
)


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()[:24] or "run"


class RunArchiveService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: Optional[dict[str, Any]] = None

    # ------------------------------------------------------------ paths
    def _root(self) -> Path:
        from app.services.project_service import project_service

        return project_service.require_root() / RUNS_DIR

    def _dir(self, run_id: str) -> Path:
        if not _ID_RE.match(run_id) or run_id in (".", ".."):
            raise HTTPException(status_code=400, detail="Invalid run id")
        d = self._root() / run_id
        if not (d / "run.json").is_file():
            raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
        return d

    def paths(self, run_id: str) -> tuple[Path, Path]:
        """(.out, .rpt) for a run id or ``current``."""
        from app.services.project_service import project_service

        if run_id == "current":
            return project_service.out_path(), project_service.rpt_path()
        d = self._dir(run_id)
        meta = json.loads((d / "run.json").read_text(encoding="utf-8"))
        return d / meta["out"], d / meta["rpt"]

    # --------------------------------------------------------- capture
    def note_started(self, engine: str) -> None:
        """Remember a run this session started; archived once it completes."""
        from app.services.project_service import project_service

        if engine == "flow_accum":
            return
        info = project_service.current()
        self._pending = {
            "engine": engine,
            "out": project_service.out_path(),
            "rpt": project_service.rpt_path(),
            "inp_name": project_service.require_inp().name,
            "scenario_id": getattr(info, "scenario_id", None) or "base",
            "scenario_name": getattr(info, "scenario_name", None) or "Base",
            "started": datetime.now().isoformat(timespec="seconds"),
        }

    def on_status(self, engine: Optional[str], status: str) -> None:
        """Called with the current run status; archives a finished run once."""
        p = self._pending
        if not p or engine != p["engine"] or status not in ("completed", "failed", "cancelled"):
            return
        with self._lock:
            if self._pending is not p:
                return
            self._pending = None
        if status != "completed":
            return
        try:
            self._archive(p)
        except Exception:  # never break status polling over an archive problem
            pass

    def _archive(self, p: dict[str, Any]) -> Optional[str]:
        out: Path = p["out"]
        rpt: Path = p["rpt"]
        if not out.is_file():
            return None
        root = self._root()
        root.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        run_id = f"{stamp}-{p['engine']}-{_slug(p['scenario_name'])}"
        d = root / run_id
        n = 2
        while d.exists():
            d = root / f"{run_id}-{n}"
            n += 1
        d.mkdir()
        shutil.copy2(out, d / out.name)
        if rpt.is_file():
            shutil.copy2(rpt, d / rpt.name)
        summary = rpt_service.summarize_file(d / rpt.name)
        meta = {
            "id": d.name,
            "label": "",
            "pinned": False,
            "engine": p["engine"],
            "scenario_id": p["scenario_id"],
            "scenario_name": p["scenario_name"],
            "inp_name": p["inp_name"],
            "started": p["started"],
            "finished": datetime.now().isoformat(timespec="seconds"),
            "finished_ns": time.time_ns(),
            "out": out.name,
            "rpt": rpt.name,
            "summary": {k: summary.get(k) for k in (*SUMMARY_KEYS, "flood_volume_units")},
        }
        (d / "run.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        self._prune()
        return d.name

    @staticmethod
    def _release_readers() -> None:
        # Windows can't delete a .out the result reader still has open.
        from app.services.output_service import output_service

        output_service.invalidate()

    def _prune(self) -> None:
        runs = [r for r in self.list()["runs"] if not r.get("pinned")]
        if len(runs) > KEEP_UNPINNED:
            self._release_readers()
        for r in runs[KEEP_UNPINNED:]:
            shutil.rmtree(self._root() / r["id"], ignore_errors=True)

    # ------------------------------------------------------------ CRUD
    def list(self) -> dict[str, Any]:
        root = self._root()
        runs = []
        if root.is_dir():
            for d in root.iterdir():
                f = d / "run.json"
                if d.is_dir() and f.is_file():
                    try:
                        meta = json.loads(f.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        continue
                    meta["id"] = d.name
                    meta["size_bytes"] = sum(x.stat().st_size for x in d.iterdir() if x.is_file())
                    runs.append(meta)
        runs.sort(key=lambda r: (r.get("finished", ""), r.get("finished_ns", 0)), reverse=True)
        return {"runs": runs, "keep_unpinned": KEEP_UNPINNED}

    def update(self, run_id: str, label: Optional[str], pinned: Optional[bool]) -> dict[str, Any]:
        d = self._dir(run_id)
        f = d / "run.json"
        meta = json.loads(f.read_text(encoding="utf-8"))
        if label is not None:
            meta["label"] = label.strip()[:120]
        if pinned is not None:
            meta["pinned"] = bool(pinned)
        f.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        return self.list()

    def delete(self, run_id: str) -> dict[str, Any]:
        d = self._dir(run_id)
        self._release_readers()
        shutil.rmtree(d)
        return self.list()

    # --------------------------------------------------------- compare
    def _report(self, run_id: str) -> dict[str, Any]:
        _, rpt = self.paths(run_id)
        if not rpt.is_file():
            raise HTTPException(status_code=404, detail=f"No report for run {run_id}")
        return rpt_service.parse_report(rpt.read_text(encoding="utf-8", errors="replace"))

    def compare(self, a: str, b: str, limit: int = 300) -> dict[str, Any]:
        ra, rb = self._report(a), self._report(b)
        summary = []
        for k in SUMMARY_KEYS:
            va, vb = ra.get(k), rb.get(k)
            d = (vb - va) if isinstance(va, (int, float)) and isinstance(vb, (int, float)) else None
            summary.append({"key": k, "a": va, "b": vb, "delta": d})
        tables = []
        by_a = {t["title"]: t for t in ra["tables"]}
        by_b = {t["title"]: t for t in rb["tables"]}
        for title, (kind, cols) in COMPARE_TABLES.items():
            ta, tb = by_a.get(title), by_b.get(title)
            if not ta and not tb:
                continue
            ref = ta or tb
            idx = {c: i for i, c in enumerate(ref["columns"])}
            units = {c: (ref["units"][idx[c]] if idx.get(c) is not None and idx[c] < len(ref["units"]) else "") for c, _ in cols}
            rows_a = {str(r[0]): r for r in (ta or {"rows": []})["rows"]}
            rows_b = {str(r[0]): r for r in (tb or {"rows": []})["rows"]}
            rows = []
            for oid in sorted(set(rows_a) | set(rows_b)):
                vals = []
                score = 0.0
                for c, _ in cols:
                    i = idx.get(c)
                    va = rows_a.get(oid, [None] * 99)[i] if i is not None else None
                    vb = rows_b.get(oid, [None] * 99)[i] if i is not None else None
                    fa = va if isinstance(va, (int, float)) else (0.0 if oid not in rows_a and title == "Node Flooding Summary" else None)
                    fb = vb if isinstance(vb, (int, float)) else (0.0 if oid not in rows_b and title == "Node Flooding Summary" else None)
                    d = (fb - fa) if fa is not None and fb is not None else None
                    if d is not None:
                        score = max(score, abs(d))
                    vals.append({"a": fa, "b": fb, "delta": d})
                rows.append({"id": oid, "values": vals, "_score": score})
            rows.sort(key=lambda r: r["_score"], reverse=True)
            for r in rows:
                r.pop("_score")
            tables.append(
                {
                    "title": title,
                    "object": kind,
                    "columns": [label for _, label in cols],
                    "units": [units[c] for c, _ in cols],
                    "rows": rows[:limit],
                    "total": len(rows),
                }
            )
        return {"a": a, "b": b, "summary": summary, "flood_volume_units": rb.get("flood_volume_units") or ra.get("flood_volume_units"), "tables": tables}


run_archive_service = RunArchiveService()
