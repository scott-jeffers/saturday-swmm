"""Network clean-up tools: reverse links, lengths from geometry, interpolate
inverts, split a conduit, merge two nodes.

Each tool edits the .inp text section by section (keeping every other line as
it was), writes the file once, and names the edit so it is one undo step.
"""

from __future__ import annotations

import math
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.fs_utils import atomic_write_text
from app.services.scenario_service import parse_inp, render_inp

LINK_SECTIONS = ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS")
NODE_SECTIONS = ("JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS")
# Sections whose rows are keyed by a node ID (removed with the node on merge).
NODE_KEYED = NODE_SECTIONS + ("COORDINATES", "INFLOWS", "DWF", "RDII", "TREATMENT")
LINK_KEYED = LINK_SECTIONS + ("XSECTIONS", "LOSSES", "VERTICES")


def _num(s: str) -> Optional[float]:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _fmt(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".") if abs(v) < 1e6 else f"{v:.1f}"


def _split_comment(line: str) -> tuple[list[str], str]:
    body, _, comment = line.partition(";")
    return body.split(), (f" ;{comment}" if comment else "")


class _Model:
    def __init__(self, text: str) -> None:
        self.secs = parse_inp(text)
        self._original = set(self.secs)

    def rows(self, sec: str) -> "OrderedDict[str, list[str]]":
        if sec not in self.secs:
            self.secs[sec] = (sec, [], OrderedDict())
        return self.secs[sec][2]

    def toks(self, sec: str, key: str) -> Optional[list[str]]:
        r = self.rows(sec).get(key) if sec in self.secs else None
        return _split_comment(r[0])[0] if r else None

    def set_toks(self, sec: str, key: str, toks: list[str]) -> None:
        rows = self.rows(sec)
        comment = _split_comment(rows[key][0])[1] if key in rows and rows[key] else ""
        rows[key] = ["  ".join(toks) + comment] + (rows[key][1:] if key in rows else [])

    def ids(self) -> set[str]:
        out: set[str] = set()
        for _, _, rows in self.secs.values():
            out.update(k.split(" ")[0] for k in rows)
        return out

    def unique(self, base: str) -> str:
        taken = self.ids()
        if base not in taken:
            return base
        i = 2
        while f"{base}_{i}" in taken:
            i += 1
        return f"{base}_{i}"

    def node_section(self, nid: str) -> Optional[str]:
        return next((s for s in NODE_SECTIONS if s in self.secs and nid in self.secs[s][2]), None)

    def link_section(self, lid: str) -> Optional[str]:
        return next((s for s in LINK_SECTIONS if s in self.secs and lid in self.secs[s][2]), None)

    def invert(self, nid: str) -> Optional[float]:
        sec = self.node_section(nid)
        t = self.toks(sec, nid) if sec else None
        return _num(t[1]) if t and len(t) > 1 else None

    def max_depth(self, nid: str) -> Optional[float]:
        sec = self.node_section(nid)
        t = self.toks(sec, nid) if sec else None
        if not t or sec == "OUTFALLS":
            return None
        return _num(t[2]) if len(t) > 2 else None

    def coord(self, nid: str) -> Optional[tuple[float, float]]:
        t = self.toks("COORDINATES", nid)
        if not t or len(t) < 3:
            return None
        x, y = _num(t[1]), _num(t[2])
        return (x, y) if x is not None and y is not None else None

    def vertices(self, lid: str) -> list[tuple[float, float]]:
        out = []
        for line in self.rows("VERTICES").get(lid, []):
            t = _split_comment(line)[0]
            if len(t) >= 3 and _num(t[1]) is not None and _num(t[2]) is not None:
                out.append((float(t[1]), float(t[2])))
        return out

    def set_vertices(self, lid: str, pts: list[tuple[float, float]]) -> None:
        rows = self.rows("VERTICES")
        if pts:
            rows[lid] = [f"{lid}  {_fmt(x)}  {_fmt(y)}" for x, y in pts]
        else:
            rows.pop(lid, None)

    def text(self) -> str:
        # Sections touched only to look something up are not written out.
        keep = OrderedDict((k, v) for k, v in self.secs.items() if k in self._original or v[2])
        return render_inp(keep)


def _geographic(m: _Model) -> bool:
    pts = [m.coord(k) for k in m.rows("COORDINATES")]
    pts = [p for p in pts if p]
    return bool(pts) and all(abs(x) <= 180 and abs(y) <= 90 for x, y in pts)


def _poly_length(pts: list[tuple[float, float]], geographic: bool, us: bool) -> float:
    total = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        if geographic:
            r = 6371008.8
            p1, p2 = math.radians(y1), math.radians(y2)
            dp, dl = p2 - p1, math.radians(x2 - x1)
            a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
            d = 2 * r * math.asin(math.sqrt(a))
            total += d / 0.3048 if us else d
        else:
            total += math.hypot(x2 - x1, y2 - y1)
    return total


def _us(m: _Model) -> bool:
    t = m.toks("OPTIONS", "FLOW_UNITS")
    return not t or len(t) < 2 or t[1].upper() in ("CFS", "GPM", "MGD")


class NetworkToolsService:
    def _inp(self) -> Path:
        from app.services.project_service import project_service

        inp = getattr(project_service, "_inp_path", None)
        if inp is None:
            raise HTTPException(status_code=404, detail="No project is open")
        return inp

    def _load(self) -> _Model:
        return _Model(self._inp().read_text(encoding="utf-8", errors="replace"))

    def _save(self, m: _Model, label: str) -> None:
        from app.services.edit_history import edit_history
        from app.services.inp_model_service import inp_model_service

        edit_history.set_label(label)
        atomic_write_text(self._inp(), m.text())
        inp_model_service.invalidate()

    # ------------------------------------------------------------- reverse
    def reverse(self, link_ids: list[str]) -> dict[str, Any]:
        m = self._load()
        done = []
        for lid in link_ids:
            sec = m.link_section(lid)
            if not sec:
                raise HTTPException(status_code=404, detail=f"Link not found: {lid}")
            t = m.toks(sec, lid)
            assert t is not None
            t[1], t[2] = t[2], t[1]
            if sec == "CONDUITS" and len(t) > 6:
                t[5], t[6] = t[6], t[5]
            m.set_toks(sec, lid, t)
            m.set_vertices(lid, list(reversed(m.vertices(lid))))
            done.append(lid)
        self._save(m, f"Reverse {len(done)} link{'s' if len(done) != 1 else ''}" if len(done) != 1 else f"Reverse {done[0]}")
        return {"changed": done}

    # --------------------------------------------------------- set lengths
    def set_lengths(self, link_ids: Optional[list[str]] = None) -> dict[str, Any]:
        m = self._load()
        geo = _geographic(m)
        us = _us(m)
        ids = link_ids or list(m.rows("CONDUITS").keys())
        changed: list[dict[str, Any]] = []
        for lid in ids:
            t = m.toks("CONDUITS", lid)
            if not t or len(t) < 4:
                continue
            a, b = m.coord(t[1]), m.coord(t[2])
            if not a or not b:
                continue
            L = _poly_length([a, *m.vertices(lid), b], geo, us)
            if L <= 0:
                continue
            old = _num(t[3])
            t[3] = _fmt(L)
            m.set_toks("CONDUITS", lid, t)
            changed.append({"id": lid, "old": old, "new": round(L, 4)})
        self._save(m, f"Set {len(changed)} conduit length{'s' if len(changed) != 1 else ''} from the map")
        return {"changed": changed, "geographic": geo}

    # ------------------------------------------------------ rims from DEM
    def rims_from_dem(
        self,
        node_ids: Optional[list[str]] = None,
        dem_unit: Optional[str] = None,
        layer_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Set junction and storage rims (max depth = ground − invert) from the project DEM.

        ``dem_unit`` is the DEM's height unit, "m" or "ft"; by default the model's
        own length unit. Nodes whose ground is missing or below the invert are
        skipped and reported, not changed.
        """
        from app.services.gis_service import gis_service

        m = self._load()
        us = _us(m)
        model_unit = "ft" if us else "m"
        unit = (dem_unit or model_unit).lower()
        if unit not in ("m", "ft"):
            raise HTTPException(status_code=400, detail="dem_unit must be m or ft")
        conv = 1.0 if unit == model_unit else (1 / 0.3048 if unit == "m" else 0.3048)

        ids = node_ids or [*m.rows("JUNCTIONS").keys(), *m.rows("STORAGE").keys()]
        todo: list[tuple[str, str, float, float]] = []  # id, section, x, y
        skipped: list[dict[str, Any]] = []
        for nid in ids:
            sec = m.node_section(nid)
            if sec is None:
                skipped.append({"id": nid, "reason": "not found"})
                continue
            if sec not in ("JUNCTIONS", "STORAGE"):
                skipped.append({"id": nid, "reason": "only junctions and storage have a rim"})
                continue
            xy = m.coord(nid)
            if not xy:
                skipped.append({"id": nid, "reason": "no coordinates"})
                continue
            todo.append((nid, sec, xy[0], xy[1]))
        if not todo:
            return {"changed": [], "skipped": skipped, "dem_unit": unit, "model_unit": model_unit}

        zs = gis_service.sample_dem_grid([t[2] for t in todo], [t[3] for t in todo], layer_id=layer_id)
        changed: list[dict[str, Any]] = []
        for (nid, sec, _x, _y), z in zip(todo, zs):
            if z is None:
                skipped.append({"id": nid, "reason": "outside the DEM"})
                continue
            ground = z * conv
            inv = m.invert(nid)
            t = m.toks(sec, nid)
            if inv is None or not t or len(t) < 3:
                skipped.append({"id": nid, "reason": "no invert elevation"})
                continue
            depth = ground - inv
            if depth <= 0:
                skipped.append({"id": nid, "reason": f"ground {ground:.2f} is below the invert {inv:.2f}"})
                continue
            old = _num(t[2])
            t[2] = _fmt(depth)
            m.set_toks(sec, nid, t)
            changed.append({"id": nid, "rim": round(ground, 3), "old_depth": old, "new_depth": round(depth, 3)})
        if changed:
            self._save(m, f"Set {len(changed)} rim{'s' if len(changed) != 1 else ''} from the DEM")
        return {"changed": changed, "skipped": skipped, "dem_unit": unit, "model_unit": model_unit}

    # ------------------------------------------------- interpolate inverts
    def interpolate(self, nodes: list[str], links: list[str], keep_rims: bool = True) -> dict[str, Any]:
        """Set the inverts of the interior junctions of a path by straight-line grade between its ends."""
        if len(nodes) < 3 or len(links) != len(nodes) - 1:
            raise HTTPException(status_code=400, detail="Give a path of at least three nodes and the links between them")
        m = self._load()
        lengths = []
        for lid in links:
            t = m.toks("CONDUITS", lid)
            L = _num(t[3]) if t and len(t) > 3 else None
            if not L or L <= 0:
                raise HTTPException(status_code=400, detail=f"Conduit {lid} has no usable length")
            lengths.append(L)
        z0, z1 = m.invert(nodes[0]), m.invert(nodes[-1])
        if z0 is None or z1 is None:
            raise HTTPException(status_code=400, detail="Both end nodes need an invert elevation")
        total = sum(lengths)
        changed = []
        run = 0.0
        for i, nid in enumerate(nodes[1:-1], start=1):
            run += lengths[i - 1]
            if m.node_section(nid) != "JUNCTIONS":
                continue
            new = z0 + (z1 - z0) * run / total
            t = m.toks("JUNCTIONS", nid)
            assert t is not None
            old = _num(t[1]) or 0.0
            t[1] = _fmt(new)
            if keep_rims and len(t) > 2 and (_num(t[2]) or 0) > 0:
                t[2] = _fmt(max(0.0, (_num(t[2]) or 0) + old - new))
            m.set_toks("JUNCTIONS", nid, t)
            changed.append({"id": nid, "old": old, "new": round(new, 4)})
        self._save(m, f"Interpolate inverts {nodes[0]} → {nodes[-1]}")
        return {"changed": changed}

    # -------------------------------------------------------------- split
    def split(self, link_id: str, fraction: float = 0.5, node_id: Optional[str] = None) -> dict[str, Any]:
        if not 0.02 <= fraction <= 0.98:
            raise HTTPException(status_code=400, detail="Split between 2 % and 98 % of the length")
        m = self._load()
        t = m.toks("CONDUITS", link_id)
        if not t or len(t) < 7:
            raise HTTPException(status_code=400, detail=f"{link_id} is not a conduit")
        frm, to = t[1], t[2]
        a, b = m.coord(frm), m.coord(to)
        if not a or not b:
            raise HTTPException(status_code=400, detail="Both end nodes need coordinates")
        pts = [a, *m.vertices(link_id), b]
        seg = [math.hypot(x2 - x1, y2 - y1) for (x1, y1), (x2, y2) in zip(pts, pts[1:])]
        target = sum(seg) * fraction
        acc = 0.0
        cut_i, cut_pt = 0, a
        for i, d in enumerate(seg):
            if acc + d >= target:
                r = (target - acc) / d if d else 0
                cut_i = i
                cut_pt = (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * r, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * r)
                break
            acc += d
        first_v, second_v = pts[1 : cut_i + 1], pts[cut_i + 1 : -1]

        L = _num(t[3]) or 0.0
        off_in, off_out = _num(t[5]) or 0.0, _num(t[6]) or 0.0
        za, zb = (m.invert(frm) or 0.0) + off_in, (m.invert(to) or 0.0) + off_out
        z = za + (zb - za) * fraction
        rim_a = (m.invert(frm) or 0.0) + (m.max_depth(frm) or 0.0)
        rim_b = (m.invert(to) or 0.0) + (m.max_depth(to) or 0.0)
        rim = rim_a + (rim_b - rim_a) * fraction if m.max_depth(frm) and m.max_depth(to) else z + (m.max_depth(frm) or m.max_depth(to) or 0.0)

        nid = node_id or m.unique(f"{link_id}_J")
        if nid in m.ids():
            raise HTTPException(status_code=409, detail=f"ID already used: {nid}")
        m.rows("JUNCTIONS")[nid] = [f"{nid}  {_fmt(z)}  {_fmt(max(0.0, rim - z))}  0  0  0"]
        m.rows("COORDINATES")[nid] = [f"{nid}  {_fmt(cut_pt[0])}  {_fmt(cut_pt[1])}"]

        new_link = m.unique(f"{link_id}_B")
        t2 = list(t)
        t[2], t[3], t[6] = nid, _fmt(L * fraction), "0"
        t2[0], t2[1], t2[3], t2[5] = new_link, nid, _fmt(L * (1 - fraction)), "0"
        m.set_toks("CONDUITS", link_id, t)
        m.rows("CONDUITS")[new_link] = ["  ".join(t2)]
        for sec in ("XSECTIONS", "LOSSES"):
            row = m.toks(sec, link_id)
            if row:
                m.rows(sec)[new_link] = ["  ".join([new_link, *row[1:]])]
        m.set_vertices(link_id, first_v)
        m.set_vertices(new_link, second_v)
        self._save(m, f"Split {link_id} at {round(fraction * 100)} %")
        return {"node": nid, "links": [link_id, new_link]}

    # -------------------------------------------------------------- merge
    def merge(self, keep: str, remove: str) -> dict[str, Any]:
        if keep == remove:
            raise HTTPException(status_code=400, detail="Pick two different nodes")
        m = self._load()
        if not m.node_section(keep) or not m.node_section(remove):
            raise HTTPException(status_code=404, detail="Both nodes must exist")
        dropped: list[str] = []
        for sec in LINK_SECTIONS:
            for lid in list(m.rows(sec).keys()):
                t = m.toks(sec, lid)
                if not t or len(t) < 3:
                    continue
                t[1] = keep if t[1] == remove else t[1]
                t[2] = keep if t[2] == remove else t[2]
                if t[1] == t[2] == keep:
                    dropped.append(lid)
                    continue
                m.set_toks(sec, lid, t)
        for lid in dropped:
            for sec in LINK_KEYED:
                m.rows(sec).pop(lid, None)
        for sid in list(m.rows("SUBCATCHMENTS").keys()):
            t = m.toks("SUBCATCHMENTS", sid)
            if t and len(t) > 2 and t[2] == remove:
                t[2] = keep
                m.set_toks("SUBCATCHMENTS", sid, t)
        for sec in NODE_KEYED:
            if sec in m.secs:
                rows = m.rows(sec)
                for k in [k for k in rows if k.split(" ")[0] == remove]:
                    rows.pop(k)
        self._save(m, f"Merge {remove} into {keep}")
        return {"kept": keep, "removed": remove, "dropped_links": dropped}


network_tools_service = NetworkToolsService()
