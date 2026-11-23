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

from app.services.scenario_service_parse import (  # noqa: E402
    _SECTION_RE,
    TWO_TOKEN_KEYS,
    WHOLE_SECTIONS,
    Section,
    _tokens,
    parse_inp,
    render_inp,
)

# Sections that may name input files.
FILE_SECTIONS = {"RAINGAGES", "TIMESERIES", "FILES", "BACKDROP", "2D_MESH_FILE"}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()[:40]
    return s or "scenario"


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


# Element sections → the map object type an ID in them refers to.
_OBJ_OF_SECTION = {
    **{k: "node" for k in ("JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS", "COORDINATES", "INFLOWS", "DWF", "RDII", "TREATMENT")},
    **{k: "link" for k in ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS", "XSECTIONS", "LOSSES", "VERTICES")},
    **{k: "subcatchment" for k in ("SUBCATCHMENTS", "SUBAREAS", "INFILTRATION", "POLYGONS", "LID_USAGE", "COVERAGES", "LOADINGS", "GROUNDWATER")},
}


def compare_inp(a_text: str, b_text: str) -> list[dict[str, Any]]:
    """Like ``diff_inp`` but with the rows on each side, and the map object each change touches."""
    a, b = parse_inp(a_text), parse_inp(b_text)
    out: list[dict[str, Any]] = []
    for ch in diff_inp(a_text, b_text):
        up = ch["section"].upper()
        ra = a[up][2].get(ch["id"], []) if up in a else []
        rb = b[up][2].get(ch["id"], []) if up in b else []
        obj = _OBJ_OF_SECTION.get(up)
        out.append({**ch, "a": [r.strip() for r in ra][:20], "b": [r.strip() for r in rb][:20], "object": obj})
    return out


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
            target = (src_dir / p).resolve()
            try:
                rel = os.path.relpath(target, dst_dir.resolve())
            except ValueError:  # different drive on Windows: keep it absolute
                rel = str(target)
            # Forward slashes: SWMM reads them on every platform, and the file stays portable.
            return f'"{Path(rel).as_posix()}"'

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

    def list(self, catch_up: bool = True) -> dict[str, Any]:
        from app.services.project_service import project_service

        if catch_up:
            self.catch_up()
        data = self._load()
        root = self._root()
        active = project_service.active_scenario_id()
        out = []
        for s in data["scenarios"]:
            inp = root / s["inp"]
            info = self._inherit_state(s) if s.get("parent") else {"changes": 0, "flags": 0, "behind": 0}
            out.append({
                **s,
                "locked": bool(s.get("locked")),
                "exists": inp.is_file(),
                "has_results": inp.with_suffix(".out").is_file(),
                "results_stale": inp.with_suffix(".out").is_file() and inp.is_file() and inp.stat().st_mtime > inp.with_suffix(".out").stat().st_mtime + 1.0,
                "children": [c["id"] for c in data["scenarios"] if c.get("parent") == s["id"]],
                **info,
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

    def delete(self, sid: str, branch: bool = False) -> dict[str, Any]:
        from app.services.project_service import project_service

        if sid == "base":
            raise HTTPException(status_code=400, detail="The Base scenario can't be deleted.")
        data = self._load()
        s = self._get(data, sid)
        kids = [c for c in data["scenarios"] if c.get("parent") == sid]
        if kids and not branch:
            raise HTTPException(
                status_code=409,
                detail={"message": f"{s['name']} has child scenarios: {', '.join(c['name'] for c in kids)}.", "fix": "Delete the whole branch, or move the children to another parent first (drag them in the scenario tree)."},
            )
        for c in kids:
            self.delete(c["id"], branch=True)
        data = self._load()
        s = self._get(data, sid)
        root = self._root()
        folder = (root / s["inp"]).parent
        if folder.is_dir() and FOLDER in folder.parts:
            trash = root / FOLDER / ".deleted"
            trash.mkdir(parents=True, exist_ok=True)
            from app.services.output_service import output_service

            output_service.invalidate()  # Windows can't move a folder with an open .out
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

    def compare(self, a: str, b: str) -> dict[str, Any]:
        """Every element that differs between two scenarios (``base`` is the base model)."""
        data = self._load()
        root = self._root()

        def text(sid: str) -> str:
            path = self._base_inp() if sid == "base" else root / self._get(data, sid)["inp"]
            return path.read_text(encoding="utf-8", errors="replace")

        return {"a": a, "b": b, "changes": compare_inp(text(a), text(b))}

    # ---------------------------------------------------------- inheritance
    # A child = its parent's model plus its own changes. Its own changes are what
    # differs from ``.parent.inp`` (the parent when the child last took its
    # changes); see scenario_inherit.py.

    def _paths(self, s: dict[str, Any]) -> tuple[Path, Path, Path]:
        """(child .inp, its parent snapshot, its inheritance notes)."""
        child = self._root() / s["inp"]
        return child, child.parent / SNAPSHOT, child.parent / ".inherit.json"

    def _parent_text(self, data: dict[str, Any], s: dict[str, Any]) -> str:
        """The parent's model as the child should see it (file paths rewritten for the child's folder)."""
        parent_p = self._root() / self._get(data, s["parent"])["inp"]
        child_p = self._root() / s["inp"]
        return _rewrite_file_refs(parent_p.read_text(encoding="utf-8", errors="replace"), parent_p.parent, child_p.parent)

    @staticmethod
    def _read_notes(p: Path) -> dict[str, Any]:
        try:
            return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        except Exception:
            return {}

    def _inherit_state(self, s: dict[str, Any]) -> dict[str, Any]:
        from app.services import scenario_inherit as inh

        child, snap, notes_p = self._paths(s)
        if not child.is_file():
            return {"changes": 0, "flags": 0, "behind": 0}
        try:
            snap_t = snap.read_text(encoding="utf-8", errors="replace") if snap.is_file() else child.read_text(encoding="utf-8", errors="replace")
            ov = inh.overrides(snap_t, child.read_text(encoding="utf-8", errors="replace"))
        except Exception:
            ov = []
        notes = self._read_notes(notes_p)
        distinct = {(c.get("object") or c["section"], c["id"], c.get("key") if c["change"] == "modified" else c["change"]) for c in ov}
        return {"changes": len(distinct), "flags": len(notes.get("flags", [])), "behind": int(notes.get("behind", 0))}

    def _write_child(self, child: Path, before: str, after: str, label: str) -> None:
        from app.services.edit_history import edit_history
        from app.services.inp_model_service import inp_model_service
        from app.services.project_service import project_service

        atomic_write_text(child, after)
        # Undo in the child can take a change from the parent back out.
        edit_history.record(child, before.encode("utf-8"), after.encode("utf-8"), label)
        if getattr(project_service, "_inp_path", None) == child:
            inp_model_service.invalidate()

    def _scenario_for(self, inp: Path) -> Optional[str]:
        data = self._load()
        root = self._root()
        for s in data["scenarios"]:
            if (root / s["inp"]).resolve() == inp.resolve():
                return s["id"]
        return None

    def on_model_changed(self, inp: Path, label: str = "") -> list[str]:
        """After the model at ``inp`` changed: carry the change down its branch. Returns the scenarios updated."""
        try:
            sid = self._scenario_for(inp)
        except HTTPException:
            return []
        if sid is None:
            return []
        self._tidy_flags(sid)
        return self._cascade(sid, label)

    def _cascade(self, sid: str, label: str = "") -> list[str]:
        """Rebuild every child of ``sid`` (then theirs) from its parent plus its own changes."""
        from app.services import scenario_inherit as inh

        data = self._load()
        updated: list[str] = []
        parent_name = self._get(data, sid)["name"]
        for c in [x for x in data["scenarios"] if x.get("parent") == sid]:
            child, snap_p, notes_p = self._paths(c)
            if not child.is_file():
                continue
            parent_now = self._parent_text(data, c)
            snap = snap_p.read_text(encoding="utf-8", errors="replace") if snap_p.is_file() else parent_now
            notes = self._read_notes(notes_p)
            if not diff_inp(snap, parent_now):
                continue
            if c.get("locked"):
                # A locked scenario waits; it takes the changes when unlocked.
                notes["behind"] = len(diff_inp(snap, parent_now))
                atomic_write_text(notes_p, json.dumps(notes, indent=1))
                continue
            before = child.read_text(encoding="utf-8", errors="replace")
            # An element renamed in the parent keeps the child's changes to it.
            renames = inh.detect_renames(snap, parent_now)
            work = inh.rename_ids(before, renames) if renames else before
            if renames:
                snap = inh.rename_ids(snap, renames)
            after, flags = inh.rebuild(snap, parent_now, work)
            if diff_inp(before, after):
                self._write_child(child, before, after, f"From {parent_name}" + (f": {label}" if label else ""))
                updated.append(c["id"])
            atomic_write_text(snap_p, parent_now)
            keep = [f for f in notes.get("flags", []) if (f["section"], f["id"], f.get("field")) not in {(g["section"], g["id"], g.get("field")) for g in flags}]
            notes["flags"] = keep + flags
            notes["behind"] = 0
            atomic_write_text(notes_p, json.dumps(notes, indent=1))
            self._tidy_flags(c["id"])
            updated += self._cascade(c["id"], label)
        return updated

    def _tidy_flags(self, sid: str) -> None:
        """Drop "parent changed this" notes whose field is no longer the child's own."""
        from app.services import scenario_inherit as inh

        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            return
        child, snap_p, notes_p = self._paths(s)
        notes = self._read_notes(notes_p)
        if not notes.get("flags") or not child.is_file() or not snap_p.is_file():
            return
        ov = inh.overrides(snap_p.read_text(encoding="utf-8", errors="replace"), child.read_text(encoding="utf-8", errors="replace"))
        mine = {(o["section"].upper(), o["id"], o.get("field")) for o in ov}
        mine_obj = {(o["section"].upper(), o["id"]) for o in ov}
        notes["flags"] = [
            f for f in notes["flags"]
            if (f["section"].upper(), f["id"], f.get("field")) in mine or (f.get("field") is None and (f["section"].upper(), f["id"]) in mine_obj and f.get("kind") != "removed_in_parent")
        ]
        atomic_write_text(notes_p, json.dumps(notes, indent=1))

    def catch_up(self) -> list[str]:
        """Take changes made to parents outside the app (in EPA SWMM, a text editor) down the tree."""
        try:
            data = self._load()
        except HTTPException:
            return []
        updated: list[str] = []
        for s in data["scenarios"]:
            if s.get("parent"):
                continue
            updated += self._catch_up_from(s["id"])
        return updated

    def _catch_up_from(self, sid: str) -> list[str]:
        data = self._load()
        updated: list[str] = []
        for c in [x for x in data["scenarios"] if x.get("parent") == sid]:
            child, snap_p, _ = self._paths(c)
            if child.is_file() and snap_p.is_file() and diff_inp(snap_p.read_text(encoding="utf-8", errors="replace"), self._parent_text(data, c)):
                updated += self._cascade(sid)
                break
        for c in [x for x in self._load()["scenarios"] if x.get("parent") == sid]:
            updated += self._catch_up_from(c["id"])
        return updated

    def inheritance(self, sid: Optional[str] = None) -> dict[str, Any]:
        """The scenario's own changes and its "parent changed this" notes."""
        from app.services import scenario_inherit as inh
        from app.services.project_service import project_service

        sid = sid or project_service.active_scenario_id()
        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            return {"id": sid, "parent": None, "parent_name": None, "locked": bool(s.get("locked")), "changes": [], "flags": [], "behind": 0}
        child, snap_p, notes_p = self._paths(s)
        snap = snap_p.read_text(encoding="utf-8", errors="replace") if snap_p.is_file() else self._parent_text(data, s)
        notes = self._read_notes(notes_p)
        return {
            "id": sid,
            "parent": s["parent"],
            "parent_name": self._get(data, s["parent"])["name"],
            "locked": bool(s.get("locked")),
            "changes": inh.overrides(snap, child.read_text(encoding="utf-8", errors="replace")),
            "flags": notes.get("flags", []),
            "behind": int(notes.get("behind", 0)),
        }

    def removed_geojson(self, sid: str) -> dict[str, Any]:
        """Shapes (in the model's coordinates) of elements this scenario removed, from its parent: drawn as ghosts."""
        from app.services.inp_model_service import inp_model_service

        inh = self.inheritance(sid)
        gone = {(c["object"], c["id"]) for c in inh["changes"] if c["change"] == "removed" and c.get("object")}
        if not gone:
            return {"type": "FeatureCollection", "features": []}
        data = self._load()
        _, snap_p, _ = self._paths(self._get(data, sid))
        if not snap_p.is_file():
            return {"type": "FeatureCollection", "features": []}
        fc = inp_model_service.to_geojson(inp_model_service.load(snap_p))
        kind = {"node": "node", "link": "link", "subcatchment": "subcatchment"}
        feats = [f for f in fc.get("features", []) if (kind.get(str(f.get("properties", {}).get("object_type", ""))), str(f.get("properties", {}).get("id"))) in gone]
        return {"type": "FeatureCollection", "features": feats}

    # ---------------------------------------------------------- operations on changes
    def _edit_scenario(self, sid: str, fn, label: str) -> None:
        """Apply ``fn(text) -> text`` to a scenario's model, record it, and carry it down."""
        data = self._load()
        s = self._get(data, sid)
        if s.get("locked"):
            raise HTTPException(status_code=423, detail={"message": f"{s['name']} is locked.", "fix": "Unlock it in the scenario menu to change it."})
        p = self._root() / s["inp"]
        before = p.read_text(encoding="utf-8", errors="replace")
        after = fn(before)
        if after != before and diff_inp(before, after):
            self._write_child(p, before, after, label)
            self._tidy_flags(sid)
            self._cascade(sid, label)

    def reset(self, sid: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        """Give fields (or whole objects) back to the parent: the parent's value is used again."""
        from app.services import scenario_inherit as inh

        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            raise HTTPException(status_code=400, detail="Base has no parent to reset to.")
        _, snap_p, _ = self._paths(s)
        parent = snap_p.read_text(encoding="utf-8", errors="replace") if snap_p.is_file() else self._parent_text(data, s)

        def fn(text: str) -> str:
            for it in items:
                f = it.get("field")
                if f is None:
                    text = inh.set_field(text, it["section"], it["id"], None, inh.object_lines(parent, it["section"], it["id"]))
                else:
                    text = inh.set_field(text, it["section"], it["id"], int(f), inh.field_value(parent, it["section"], it["id"], int(f)))
            return text

        self._edit_scenario(sid, fn, f"Reset {len(items)} change{'s' if len(items) != 1 else ''} to {self._get(data, s['parent'])['name']}")
        return self.inheritance(sid)

    def keep_mine(self, sid: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        """Dismiss "parent changed this" notes: the scenario keeps its own values."""
        data = self._load()
        _, _, notes_p = self._paths(self._get(data, sid))
        notes = self._read_notes(notes_p)
        drop = {(i["section"].upper(), i["id"], i.get("field")) for i in items}
        notes["flags"] = [f for f in notes.get("flags", []) if (f["section"].upper(), f["id"], f.get("field")) not in drop]
        atomic_write_text(notes_p, json.dumps(notes, indent=1))
        return self.inheritance(sid)

    def _copy_items(self, src_text: str, dst_text: str, items: list[dict[str, Any]]) -> str:
        from app.services import scenario_inherit as inh

        for it in items:
            f = it.get("field")
            if f is None:
                dst_text = inh.set_field(dst_text, it["section"], it["id"], None, inh.object_lines(src_text, it["section"], it["id"]))
            else:
                v = inh.field_value(src_text, it["section"], it["id"], int(f))
                dst_text = inh.set_field(dst_text, it["section"], it["id"], int(f), v)
        return dst_text

    def push_to_parent(self, sid: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        """Move changes up a level: the parent takes them, and its other children inherit them."""
        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            raise HTTPException(status_code=400, detail="Base has no parent.")
        mine = (self._root() / s["inp"]).read_text(encoding="utf-8", errors="replace")
        parent = self._get(data, s["parent"])
        self._edit_scenario(parent["id"], lambda t: self._copy_items(mine, t, items), f"From {s['name']}: {len(items)} change{'s' if len(items) != 1 else ''}")
        return self.inheritance(sid)

    def apply_to_siblings(self, sid: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        """Make the same changes in the other children of the same parent."""
        data = self._load()
        s = self._get(data, sid)
        mine = (self._root() / s["inp"]).read_text(encoding="utf-8", errors="replace")
        done = []
        for o in data["scenarios"]:
            if o["id"] != sid and o.get("parent") == s.get("parent") and o.get("parent") and not o.get("locked"):
                self._edit_scenario(o["id"], lambda t: self._copy_items(mine, t, items), f"From {s['name']}")
                done.append(o["name"])
        return {**self.inheritance(sid), "applied_to": done}

    # ---------------------------------------------------------- tree operations
    def set_locked(self, sid: str, locked: bool) -> dict[str, Any]:
        if sid == "base" and locked:
            raise HTTPException(status_code=400, detail={"message": "Base can't be locked.", "fix": "Lock a child scenario to freeze it; Base is where shared changes are made."})
        data = self._load()
        s = self._get(data, sid)
        s["locked"] = bool(locked)
        self._save(data)
        if not locked and s.get("parent"):
            # Take what the parent changed while it was locked.
            self._cascade(s["parent"])
        return self.list(catch_up=False)

    def _descendants(self, data: dict[str, Any], sid: str) -> set[str]:
        out: set[str] = set()
        stack = [sid]
        while stack:
            cur = stack.pop()
            for c in data["scenarios"]:
                if c.get("parent") == cur and c["id"] not in out:
                    out.add(c["id"])
                    stack.append(c["id"])
        return out

    def reparent(self, sid: str, new_parent: str) -> dict[str, Any]:
        """Move a scenario under another parent. Its own changes move with it; everything else now comes from the new parent."""
        if sid == "base":
            raise HTTPException(status_code=400, detail="Base can't be moved.")
        data = self._load()
        s = self._get(data, sid)
        self._get(data, new_parent)
        if new_parent == sid or new_parent in self._descendants(data, sid):
            raise HTTPException(status_code=400, detail={"message": "A scenario can't go under itself or one of its own children.", "fix": "Pick a scenario outside this branch."})
        from app.services import scenario_inherit as inh

        child, snap_p, notes_p = self._paths(s)
        old_snap = snap_p.read_text(encoding="utf-8", errors="replace") if snap_p.is_file() else None
        s["parent"] = new_parent
        self._save(data)
        data = self._load()
        s = self._get(data, sid)
        parent_now = self._parent_text(data, s)
        flags: list[dict[str, Any]] = []
        if old_snap is not None and child.is_file():
            # Rebase: the old parent's values become the new parent's, the scenario's own changes stay.
            before = child.read_text(encoding="utf-8", errors="replace")
            after, flags = inh.rebuild(old_snap, parent_now, before)
            if diff_inp(before, after):
                self._write_child(child, before, after, f"Moved under {self._get(data, new_parent)['name']}")
        atomic_write_text(snap_p, parent_now)
        atomic_write_text(notes_p, json.dumps({"flags": flags, "behind": 0}, indent=1))
        self._tidy_flags(sid)
        self._cascade(sid, "moved")
        return self.list(catch_up=False)

    def duplicate(self, sid: str, name: str) -> dict[str, Any]:
        """A sibling with the same parent and the same changes."""
        from app.services.project_service import project_service

        if sid == "base":
            raise HTTPException(status_code=400, detail={"message": "Base can't be duplicated.", "fix": "Make a child of Base instead: it starts as an exact copy."})
        data = self._load()
        s = self._get(data, sid)
        out = self.create(name, parent=s["parent"], description=s.get("description", ""))
        new = next(x for x in out["scenarios"] if x["name"] == name.strip())
        src, src_snap, _ = self._paths(s)
        dst, dst_snap, _ = self._paths(new)
        text = _rewrite_file_refs(src.read_text(encoding="utf-8", errors="replace"), src.parent, dst.parent)
        atomic_write_text(dst, text)
        if src_snap.is_file():
            atomic_write_text(dst_snap, _rewrite_file_refs(src_snap.read_text(encoding="utf-8", errors="replace"), src.parent, dst.parent))
        project_service.set_active_scenario(new["id"])
        return self.list(catch_up=False)

    def insert_parent(self, sid: str, name: str) -> dict[str, Any]:
        """A new scenario between this one and its parent, starting as a copy of the parent."""
        from app.services.project_service import project_service

        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            raise HTTPException(status_code=400, detail="Base has no parent.")
        out = self.create(name, parent=s["parent"])
        new = next(x for x in out["scenarios"] if x["name"] == name.strip())
        self.reparent(sid, new["id"])
        project_service.set_active_scenario(new["id"])
        return self.list(catch_up=False)

    def make_base(self, sid: str) -> dict[str, Any]:
        """Make this scenario's model the new Base. Base's old model is kept in scenarios/.deleted."""
        from app.services.edit_history import edit_history
        from app.services.inp_model_service import inp_model_service

        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            raise HTTPException(status_code=400, detail="This is already Base.")
        root = self._root()
        base = self._base_inp()
        child = root / s["inp"]
        before = base.read_text(encoding="utf-8", errors="replace")
        after = _rewrite_file_refs(child.read_text(encoding="utf-8", errors="replace"), child.parent, base.parent)
        trash = root / FOLDER / ".deleted"
        trash.mkdir(parents=True, exist_ok=True)
        atomic_write_text(trash / f"base-before-{s['name'][:30]}-{datetime.now():%Y%m%d-%H%M%S}.inp", before)
        atomic_write_text(base, after)
        edit_history.record(base, before.encode("utf-8"), after.encode("utf-8"), f"Made {s['name']} the Base")
        inp_model_service.invalidate()
        self._cascade("base", f"{s['name']} made Base")
        return self.list(catch_up=False)

    def sync_from_parent(self, sid: str) -> dict[str, Any]:
        """Kept for older clients: children now take their parent's changes on their own."""
        data = self._load()
        s = self._get(data, sid)
        if not s.get("parent"):
            raise HTTPException(status_code=400, detail="The Base scenario has no parent.")
        updated = self._cascade(s["parent"])
        return {"applied": updated, "conflicts": self.inheritance(sid)["flags"], **self.list(catch_up=False)}


scenario_service = ScenarioService()
