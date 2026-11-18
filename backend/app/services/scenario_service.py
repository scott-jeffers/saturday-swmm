"""Parent/child scenarios that keep every model a plain, complete SWMM file.

Layout inside a project folder::

    model.inp                         <- Base scenario (the project's own .inp)
    scenarios.json                    <- the scenario tree (ids, names, parents)
    scenarios/<slug>/model.inp        <- each child: a full, runnable SWMM input
    scenarios/<slug>/model.rpt|.out   <- that scenario's own results
    scenarios/<slug>/.parent.inp      <- the parent as it was at the last fork/sync

Nothing is stored as a "delta": every scenario's .inp opens in EPA SWMM,
PCSWMM or a text editor on its own. Inheritance works by comparing objects
(rows keyed by their ID in each section):

* "Changes vs parent" diffs a child against its parent's current file.
* "Update from parent" is a three-way merge using ``.parent.inp``: rows the
  child never touched take the parent's new version; rows the child changed
  are kept (and reported as conflicts when the parent changed them too).

File references (rain files, time-series files, meshes) are rewritten when a
child is created so they still point at the same files from the subfolder.
"""

from __future__ import annotations

import json
import re
import shutil
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.fs_utils import atomic_write_text

INDEX = "scenarios.json"
FOLDER = "scenarios"
SNAPSHOT = ".parent.inp"

# Sections compared as one block (multi-line records or free text).
WHOLE_SECTIONS = {"TITLE", "CONTROLS", "TRANSECTS", "MAP", "BACKDROP"}
# Sections whose rows are keyed by the first two tokens.
TWO_TOKEN_KEYS = {"TAGS", "INFLOWS", "DWF", "LID_USAGE", "LOADINGS", "BUILDUP", "WASHOFF", "TREATMENT", "COVERAGES"}
# Sections that may name input files.
FILE_SECTIONS = {"RAINGAGES", "TIMESERIES", "FILES", "BACKDROP", "2D_MESH_FILE"}

_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()[:40]
    return s or "scenario"


# ------------------------------------------------------------------ parsing
Section = tuple[str, list[str], "OrderedDict[str, list[str]]"]  # name, header comments, rows


def _tokens(line: str) -> list[str]:
    from app.services.inp_model_service import _tokenize

    return _tokenize(line)


def parse_inp(text: str) -> "OrderedDict[str, Section]":
    """Sections in file order; rows grouped by object key, order kept."""
    out: "OrderedDict[str, Section]" = OrderedDict()
    cur: Optional[str] = None
    for raw in text.splitlines():
        m = _SECTION_RE.match(raw)
        if m:
            cur = m.group(1).strip()
            out.setdefault(cur.upper(), (cur, [], OrderedDict()))
            continue
        if cur is None:
            continue
        name, header, rows = out[cur.upper()]
        stripped = raw.strip()
        if not stripped or stripped.startswith(";"):
            if not rows:
                header.append(raw)
            continue
        up = cur.upper()
        if up in WHOLE_SECTIONS:
            key = "*"
        else:
            toks = _tokens(raw)
            if not toks:
                continue
            key = " ".join(toks[:2]) if up in TWO_TOKEN_KEYS and len(toks) > 1 else toks[0]
        rows.setdefault(key, []).append(raw.rstrip())
    return out


def render_inp(secs: "OrderedDict[str, Section]") -> str:
    parts: list[str] = []
    for _, (name, header, rows) in secs.items():
        parts.append(f"[{name}]")
        parts.extend(h.rstrip() for h in header if h.strip())
        for lines in rows.values():
            parts.extend(lines)
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def diff_inp(old_text: str, new_text: str) -> list[dict[str, Any]]:
    """Object-level changes going from ``old`` to ``new``."""
    a, b = parse_inp(old_text), parse_inp(new_text)
    changes: list[dict[str, Any]] = []
    for sec in list(a.keys()) + [k for k in b if k not in a]:
        ra = a[sec][2] if sec in a else OrderedDict()
        rb = b[sec][2] if sec in b else OrderedDict()
        name = (b.get(sec) or a.get(sec))[0]  # type: ignore[index]
        for key in list(ra.keys()) + [k for k in rb if k not in ra]:
            if key not in rb:
                changes.append({"section": name, "id": key, "change": "removed"})
            elif key not in ra:
                changes.append({"section": name, "id": key, "change": "added"})
            elif [l.split() for l in ra[key]] != [l.split() for l in rb[key]]:
                changes.append({"section": name, "id": key, "change": "modified"})
    return changes


def merge_from_parent(base: str, parent_now: str, child: str) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    """Three-way merge. Returns (merged_text, applied_changes, conflicts)."""
    B, P, C = parse_inp(base), parse_inp(parent_now), parse_inp(child)
    same = lambda x, y: [l.split() for l in x] == [l.split() for l in y]  # noqa: E731
    applied: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    out: "OrderedDict[str, Section]" = OrderedDict()

    for sec in list(C.keys()) + [k for k in P if k not in C]:
        cname, cheader, crows = C.get(sec) or (P[sec][0], P[sec][1], OrderedDict())
        brows = B[sec][2] if sec in B else OrderedDict()
        prows = P[sec][2] if sec in P else OrderedDict()
        rows: "OrderedDict[str, list[str]]" = OrderedDict()
        keys = list(crows.keys()) + [k for k in prows if k not in crows and k not in brows]
        for key in keys:
            b, p, c = brows.get(key), prows.get(key), crows.get(key)
            child_changed = not ((b is None and c is None) or (b is not None and c is not None and same(b, c)))
            parent_changed = not ((b is None and p is None) or (b is not None and p is not None and same(b, p)))
            if not parent_changed:
                if c is not None:
                    rows[key] = c
                continue
            if not child_changed:
                if p is not None:
                    rows[key] = p
                applied.append({
                    "section": cname, "id": key,
                    "change": "added" if b is None else "removed" if p is None else "modified",
                })
                continue
            # both changed
            if c is not None:
                rows[key] = c
            if not (p is not None and c is not None and same(p, c)):
                conflicts.append({"section": cname, "id": key})
        if rows or sec in C:
            out[sec] = (cname, list(cheader), rows)
    return render_inp(out), applied, conflicts


# ------------------------------------------------------- file references
def _rewrite_file_refs(text: str, src_dir: Path, dst_dir: Path) -> str:
    """Point relative input-file references at the same files from ``dst_dir``."""
    import os

    lines = text.splitlines(keepends=True)
    cur = None
    for i, raw in enumerate(lines):
        m = _SECTION_RE.match(raw.rstrip("\r\n"))
        if m:
            cur = m.group(1).strip().upper()
            continue
        if cur not in FILE_SECTIONS and not (cur == "2D_OPTIONS" and "MESH" in raw.upper()):
            continue
        s = raw.strip()
        if not s or s.startswith(";"):
            continue

        def fix(match: re.Match) -> str:
            tok = match.group(0)
            bare = tok.strip('"')
            p = Path(bare)
            if p.is_absolute() or not (src_dir / p).is_file():
                return tok
            rel = os.path.relpath((src_dir / p).resolve(), dst_dir.resolve())
            return f'"{rel}"'

        lines[i] = re.sub(r'"[^"]+"|\S+', fix, raw)
    return "".join(lines)


# ------------------------------------------------------------------ service
class ScenarioService:
    def _root(self) -> Path:
        from app.services.project_service import project_service

        return project_service.require_root()

    def _base_inp(self) -> Path:
        from app.services.project_service import project_service

        return project_service.base_inp()

    def _load(self) -> dict[str, Any]:
        root = self._root()
        p = root / INDEX
        base_name = self._base_inp().name
        data: dict[str, Any] = {}
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        scen = [s for s in data.get("scenarios", []) if isinstance(s, dict) and s.get("id")]
        if not any(s["id"] == "base" for s in scen):
            scen.insert(0, {"id": "base", "name": "Base", "parent": None, "inp": base_name, "created": _now(), "description": ""})
        for s in scen:
            if s["id"] == "base":
                s["inp"] = base_name
        return {"version": 1, "scenarios": scen}

    def _save(self, data: dict[str, Any]) -> None:
        atomic_write_text(self._root() / INDEX, json.dumps(data, indent=2) + "\n")

    def _get(self, data: dict[str, Any], sid: str) -> dict[str, Any]:
        for s in data["scenarios"]:
            if s["id"] == sid:
                return s
        raise HTTPException(status_code=404, detail=f"Scenario not found: {sid}")

    def inp_path(self, sid: str) -> Path:
        data = self._load()
        return self._root() / self._get(data, sid)["inp"]

    def list(self) -> dict[str, Any]:
        from app.services.project_service import project_service

        data = self._load()
        root = self._root()
        active = project_service.active_scenario_id()
        out = []
        for s in data["scenarios"]:
            inp = root / s["inp"]
            out.append({
                **s,
                "exists": inp.is_file(),
                "has_results": inp.with_suffix(".out").is_file(),
                "children": [c["id"] for c in data["scenarios"] if c.get("parent") == s["id"]],
            })
        return {"active": active, "scenarios": out}

    def create(self, name: str, parent: Optional[str] = None, description: str = "") -> dict[str, Any]:
        from app.services.project_service import project_service

        name = name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Give the scenario a name.")
        data = self._load()
        if any(s["name"].lower() == name.lower() for s in data["scenarios"]):
            raise HTTPException(status_code=409, detail=f"There is already a scenario called “{name}”.")
        parent = parent or project_service.active_scenario_id()
        p = self._get(data, parent)
        root = self._root()
        src = root / p["inp"]
        if not src.is_file():
            raise HTTPException(status_code=404, detail="The parent scenario's .inp file is missing.")
        slug = _slug(name)
        folder = root / FOLDER / slug
        n = 2
        while folder.exists():
            folder = root / FOLDER / f"{slug}-{n}"
            n += 1
        folder.mkdir(parents=True)
        text = _rewrite_file_refs(src.read_text(encoding="utf-8", errors="replace"), src.parent, folder)
        dst = folder / self._base_inp().name
        atomic_write_text(dst, text)
        atomic_write_text(folder / SNAPSHOT, text)
        sid = "s-" + uuid.uuid4().hex[:8]
        data["scenarios"].append({
            "id": sid,
            "name": name,
            "parent": parent,
            "inp": dst.relative_to(root).as_posix(),
            "created": _now(),
            "description": description.strip(),
        })
        self._save(data)
        project_service.set_active_scenario(sid)
        return self.list()

    def update(self, sid: str, name: Optional[str] = None, description: Optional[str] = None) -> dict[str, Any]:
        data = self._load()
        s = self._get(data, sid)
        if name is not None and name.strip():
            if any(o["name"].lower() == name.strip().lower() and o["id"] != sid for o in data["scenarios"]):
                raise HTTPException(status_code=409, detail=f"There is already a scenario called “{name}”.")
            s["name"] = name.strip()
        if description is not None:
            s["description"] = description.strip()
        self._save(data)
        return self.list()

    def delete(self, sid: str) -> dict[str, Any]:
        from app.services.project_service import project_service

        if sid == "base":
            raise HTTPException(status_code=400, detail="The Base scenario can't be deleted.")
        data = self._load()
        s = self._get(data, sid)
        kids = [c["name"] for c in data["scenarios"] if c.get("parent") == sid]
        if kids:
            raise HTTPException(status_code=409, detail=f"Delete its child scenarios first: {', '.join(kids)}.")
        root = self._root()
        folder = (root / s["inp"]).parent
        if folder.is_dir() and FOLDER in folder.parts:
            trash = root / FOLDER / ".deleted"
            trash.mkdir(parents=True, exist_ok=True)
            shutil.move(str(folder), str(trash / f"{folder.name}-{datetime.now():%Y%m%d-%H%M%S}"))
        data["scenarios"] = [o for o in data["scenarios"] if o["id"] != sid]
        self._save(data)
        if project_service.active_scenario_id() == sid:
            project_service.set_active_scenario(s.get("parent") or "base")
        return self.list()

    def diff(self, sid: str) -> dict[str, Any]:
        data = self._load()
        s = self._get(data, sid)
        root = self._root()
        child = (root / s["inp"]).read_text(encoding="utf-8", errors="replace")
        if not s.get("parent"):
            return {"vs_parent": [], "own_changes": [], "parent_updates": []}
        parent_text = (root / self._get(data, s["parent"])["inp"]).read_text(encoding="utf-8", errors="replace")
        snap_p = (root / s["inp"]).parent / SNAPSHOT
        snap = snap_p.read_text(encoding="utf-8", errors="replace") if snap_p.is_file() else parent_text
        return {
            "vs_parent": diff_inp(parent_text, child),
            "own_changes": diff_inp(snap, child),
            "parent_updates": diff_inp(snap, parent_text),
        }

    def sync_from_parent(self, sid: str) -> dict[str, Any]:
        from app.services.inp_model_service import inp_model_service

        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            raise HTTPException(status_code=400, detail="The Base scenario has no parent.")
        root = self._root()
        child_p = root / s["inp"]
        parent_p = root / self._get(data, s["parent"])["inp"]
        parent_text = _rewrite_file_refs(parent_p.read_text(encoding="utf-8", errors="replace"), parent_p.parent, child_p.parent)
        snap_p = child_p.parent / SNAPSHOT
        snap = snap_p.read_text(encoding="utf-8", errors="replace") if snap_p.is_file() else parent_text
        merged, applied, conflicts = merge_from_parent(snap, parent_text, child_p.read_text(encoding="utf-8", errors="replace"))
        if applied:
            atomic_write_text(child_p, merged)
            inp_model_service.invalidate()
        atomic_write_text(snap_p, parent_text)
        return {"applied": applied, "conflicts": conflicts, **self.list()}


scenario_service = ScenarioService()
