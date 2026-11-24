"""Field-level inheritance between a parent scenario and its child.

A child's own changes ("overrides") are what differs between its .inp and the
parent as it was when the child last took the parent's changes (the
``.parent.inp`` snapshot). Nothing else is stored, so a child stays a plain,
complete SWMM file.

When the parent changes, :func:`rebuild` builds the child again from the
parent's new text plus the child's overrides, field by field:

* a field the child never changed takes the parent's new value;
* a field the child changed keeps the child's value; if the parent changed it
  too, it is reported back as "parent changed this";
* objects the parent added appear in the child; objects the child added or
  removed stay added or removed;
* objects made of several lines (time series, curves, patterns, controls)
  are inherited as a whole.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Any, Optional

from app.services.scenario_service_parse import WHOLE_SECTIONS, Section, parse_inp, render_inp

# Field names per section (after the ID), as the inspector names them.
SECTION_FIELDS: dict[str, list[tuple[str, str]]] = {
    "JUNCTIONS": [("elevation", "Invert elevation"), ("max_depth", "Max depth"), ("init_depth", "Initial depth"), ("sur_depth", "Surcharge depth"), ("aponded", "Ponded area")],
    "OUTFALLS": [("elevation", "Invert elevation"), ("type", "Outfall type"), ("stage_data", "Stage / curve / series"), ("gated", "Flap gate"), ("route_to", "Route to")],
    "STORAGE": [("elevation", "Invert elevation"), ("max_depth", "Max depth"), ("init_depth", "Initial depth"), ("shape", "Storage curve"), ("curve", "Curve name"), ("coeff_b", "Coeff B"), ("coeff_c", "Coeff C"), ("sur_depth", "Surcharge depth"), ("fevap", "Evap. factor")],
    "DIVIDERS": [("elevation", "Invert elevation"), ("diverted", "Diverted link"), ("divider_type", "Divider type")],
    "CONDUITS": [("from_node", "From node"), ("to_node", "To node"), ("length", "Length"), ("roughness", "Manning's N"), ("in_offset", "Inlet offset"), ("out_offset", "Outlet offset"), ("init_flow", "Initial flow"), ("max_flow", "Max flow")],
    "PUMPS": [("from_node", "From node"), ("to_node", "To node"), ("pump_curve", "Pump curve"), ("status", "Initial status"), ("startup", "Startup depth"), ("shutoff", "Shutoff depth")],
    "ORIFICES": [("from_node", "From node"), ("to_node", "To node"), ("orifice_type", "Orifice type"), ("offset", "Offset"), ("qcoeff", "Discharge coeff."), ("gated", "Flap gate"), ("close_time", "Close time")],
    "WEIRS": [("from_node", "From node"), ("to_node", "To node"), ("weir_type", "Weir type"), ("crest_height", "Crest height"), ("qcoeff", "Discharge coeff."), ("gated", "Flap gate"), ("end_con", "End contractions"), ("end_coeff", "End coeff.")],
    "OUTLETS": [("from_node", "From node"), ("to_node", "To node"), ("offset", "Offset"), ("outlet_type", "Rating curve"), ("qcoeff_or_curve", "Q coeff / curve"), ("qexpon", "Q exponent"), ("gated", "Flap gate")],
    "XSECTIONS": [("shape", "Cross-section shape"), ("geom1", "Diameter or height"), ("geom2", "Width (geom2)"), ("geom3", "Geom3"), ("geom4", "Geom4"), ("barrels", "Barrels"), ("culvert", "Culvert code")],
    "SUBCATCHMENTS": [("raingage", "Rain gage"), ("outlet", "Outlet"), ("area", "Area"), ("pct_imperv", "% Impervious"), ("width", "Width"), ("slope", "% Slope"), ("curb_len", "Curb length"), ("snow_pack", "Snow pack")],
    "SUBAREAS": [("n_imperv", "N-Imperv"), ("n_perv", "N-Perv"), ("s_imperv", "Dstore-Imperv"), ("s_perv", "Dstore-Perv"), ("pct_zero", "% Zero-Imperv"), ("subarea_route_to", "Subarea route to"), ("pct_routed", "% Routed")],
    "COORDINATES": [("x", "X"), ("y", "Y")],
    "OPTIONS": [("value", "Value")],
    "RAINGAGES": [("format", "Format"), ("interval", "Interval"), ("scf", "Snow catch factor"), ("source", "Source"), ("data", "Data"), ("station", "Station"), ("units", "Units")],
}

# Section → the map object type its IDs are.
OBJECT_OF_SECTION = {
    **{k: "node" for k in ("JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS", "COORDINATES", "INFLOWS", "DWF", "RDII", "TREATMENT")},
    **{k: "link" for k in ("CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS", "XSECTIONS", "LOSSES", "VERTICES")},
    **{k: "subcatchment" for k in ("SUBCATCHMENTS", "SUBAREAS", "INFILTRATION", "POLYGONS", "LID_USAGE", "COVERAGES", "LOADINGS", "GROUNDWATER")},
}


def field_name(section: str, index: int) -> tuple[str, str]:
    """(key, label) of field ``index`` (0 = the first value after the ID)."""
    names = SECTION_FIELDS.get(section.upper())
    if names and 0 <= index < len(names):
        return names[index]
    return (f"field{index + 1}", f"Value {index + 1}")


def _tokens(line: str) -> list[str]:
    from app.services.inp_model_service import _tokenize

    return _tokenize(line)


def _num_eq(a: Optional[str], b: Optional[str]) -> bool:
    if a == b:
        return True
    if a is None or b is None:
        return False
    try:
        return float(a) == float(b)
    except ValueError:
        return a.upper() == b.upper() if a.isalpha() and b.isalpha() else False


def _lines_same(a: list[str], b: list[str]) -> bool:
    ta, tb = [_tokens(x) for x in a], [_tokens(x) for x in b]
    if len(ta) != len(tb):
        return False
    for x, y in zip(ta, tb):
        if len(x) != len(y) or not all(_num_eq(p, q) for p, q in zip(x, y)):
            return False
    return True


def _single(section: str, rows: Optional[list[str]]) -> bool:
    return rows is not None and len(rows) == 1 and section.upper() not in WHOLE_SECTIONS


def _quote(tok: str) -> str:
    return f'"{tok}"' if (" " in tok or tok == "") else tok


def _line(tokens: list[str]) -> str:
    # The ID padded like SWMM's own files, the rest space-separated.
    head, rest = tokens[0], tokens[1:]
    return (_quote(head).ljust(16) + " " + " ".join(_quote(t) for t in rest)).rstrip()


def field_changes(section: str, s: list[str], c: list[str]) -> Optional[list[int]]:
    """Field indexes (after the ID) where ``c`` differs from ``s``; None = compare as a whole."""
    if not (_single(section, s) and _single(section, c)):
        return None
    ts, tc = _tokens(s[0])[1:], _tokens(c[0])[1:]
    n = max(len(ts), len(tc))
    return [i for i in range(n) if not _num_eq(ts[i] if i < len(ts) else None, tc[i] if i < len(tc) else None)]


def rebuild(snapshot: str, parent: str, child: str) -> tuple[str, list[dict[str, Any]]]:
    """The child again: the parent's new text plus the child's own changes.

    Returns the new child text and the places where the parent changed a value
    the child had changed too (the child's value is kept).
    """
    S, P, C = parse_inp(snapshot), parse_inp(parent), parse_inp(child)
    flags: list[dict[str, Any]] = []
    out: "OrderedDict[str, Section]" = OrderedDict()

    for sec in list(P.keys()) + [k for k in C if k not in P]:
        pname, pheader, prows = P.get(sec) or C[sec]
        srows = S[sec][2] if sec in S else OrderedDict()
        crows = C[sec][2] if sec in C else OrderedDict()
        if sec not in P:
            # A section only the child has (it added it).
            out[sec] = C[sec]
            continue
        rows: "OrderedDict[str, list[str]]" = OrderedDict()
        for key, p in prows.items():
            s, c = srows.get(key), crows.get(key)
            if s is None and c is None:
                rows[key] = p  # parent added it
            elif s is None:
                rows[key] = c  # both added the same ID: the child's stays
            elif c is None:
                continue  # the child removed it
            else:
                rows[key] = _merge_object(pname, key, s, c, p, flags)
        # Objects the child added, in the child's order.
        for key, c in crows.items():
            if key not in rows and key not in srows and key not in prows:
                rows[key] = c
        # Objects the parent removed: gone from the child too (its changes to them go with them).
        for key, s in srows.items():
            if key not in prows and key in crows and not _lines_same(crows[key], s):
                flags.append({"section": pname, "id": key, "field": None, "label": "Removed in the parent", "kind": "removed_in_parent"})
        out[sec] = (pname, list(pheader), rows)
    return render_inp(out), flags


def _merge_object(section: str, key: str, s: list[str], c: list[str], p: list[str], flags: list[dict[str, Any]]) -> list[str]:
    changed = field_changes(section, s, c)
    if changed is None or not _single(section, p):
        # Several lines (a time series, a curve...) or a shape change: inherited as a whole.
        if _lines_same(c, s):
            return p
        if not _lines_same(p, s) and not _lines_same(p, c):
            flags.append({"section": section, "id": key, "field": None, "label": "Whole object", "kind": "parent_changed"})
        return c
    if not changed:
        return p
    ts, tc, tp = _tokens(s[0]), _tokens(c[0]), _tokens(p[0])
    vals = list(tp)
    for i in changed:
        j = i + 1  # past the ID
        cv = tc[j] if j < len(tc) else None
        sv = ts[j] if j < len(ts) else None
        pv = tp[j] if j < len(tp) else None
        if not _num_eq(pv, sv) and not _num_eq(pv, cv):
            k, label = field_name(section, i)
            flags.append({"section": section, "id": key, "field": i, "key": k, "label": label, "kind": "parent_changed", "parent_old": sv, "parent_new": pv, "mine": cv})
        while len(vals) <= j:
            vals.append("0")
        if cv is None:
            del vals[j:]
        else:
            vals[j] = cv
    return [_line(vals)]


def overrides(snapshot: str, child: str) -> list[dict[str, Any]]:
    """What the child changed from its parent, one entry per field (or object)."""
    S, C = parse_inp(snapshot), parse_inp(child)
    out: list[dict[str, Any]] = []
    for sec in list(C.keys()) + [k for k in S if k not in C]:
        name = (C.get(sec) or S[sec])[0]
        srows = S[sec][2] if sec in S else OrderedDict()
        crows = C[sec][2] if sec in C else OrderedDict()
        obj = OBJECT_OF_SECTION.get(sec)
        for key, c in crows.items():
            s = srows.get(key)
            if s is None:
                out.append({"section": name, "id": key, "object": obj, "change": "added", "field": None})
                continue
            idx = field_changes(name, s, c)
            if idx is None:
                if not _lines_same(s, c):
                    out.append({"section": name, "id": key, "object": obj, "change": "modified", "field": None, "label": "Whole object", "parent": [x.strip() for x in s][:20], "value": [x.strip() for x in c][:20]})
                continue
            ts, tc = _tokens(s[0]), _tokens(c[0])
            for i in idx:
                k, label = field_name(name, i)
                out.append({
                    "section": name, "id": key, "object": obj, "change": "modified", "field": i, "key": k, "label": label,
                    "parent": ts[i + 1] if i + 1 < len(ts) else None,
                    "value": tc[i + 1] if i + 1 < len(tc) else None,
                })
        for key in srows:
            if key not in crows:
                out.append({"section": name, "id": key, "object": obj, "change": "removed", "field": None})
    return out


def set_field(text: str, section: str, key: str, field: Optional[int], value: Any) -> str:
    """Set one field of one object (``field`` None: ``value`` = the object's whole lines, or None to remove it)."""
    secs = parse_inp(text)
    up = section.upper()
    if up not in secs:
        if field is not None or value is None:
            return text
        secs[up] = (section, [], OrderedDict())
    name, header, rows = secs[up]
    if field is None:
        if value is None:
            rows.pop(key, None)
        else:
            rows[key] = list(value)
        return render_inp(secs)
    cur = rows.get(key)
    if not cur or len(cur) != 1:
        return text
    toks = _tokens(cur[0])
    j = field + 1
    while len(toks) <= j:
        toks.append("0")
    if value is None:
        del toks[j:]
    else:
        toks[j] = str(value)
    rows[key] = [_line(toks)]
    return render_inp(secs)


def object_lines(text: str, section: str, key: str) -> Optional[list[str]]:
    secs = parse_inp(text)
    sec = secs.get(section.upper())
    return list(sec[2][key]) if sec and key in sec[2] else None


def field_value(text: str, section: str, key: str, field: int) -> Optional[str]:
    lines = object_lines(text, section, key)
    if not lines or len(lines) != 1:
        return None
    toks = _tokens(lines[0])
    return toks[field + 1] if field + 1 < len(toks) else None


# Sections whose IDs other sections refer to: a rename there is followed everywhere.
_NAMED = ("JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS", "CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS", "SUBCATCHMENTS", "RAINGAGES")


def detect_renames(before: str, after: str) -> dict[str, str]:
    """IDs renamed between two versions of a model: an object that went and one that came with the same values."""
    B, A = parse_inp(before), parse_inp(after)
    out: dict[str, str] = {}
    for sec in _NAMED:
        if sec not in B or sec not in A:
            continue
        gone = {k: v for k, v in B[sec][2].items() if k not in A[sec][2]}
        came = {k: v for k, v in A[sec][2].items() if k not in B[sec][2]}
        if not gone or not came or len(gone) > 50:
            continue
        for old, ol in gone.items():
            rest = [_tokens(x)[1:] for x in ol]
            match = [new for new, nl in came.items() if [_tokens(x)[1:] for x in nl] == rest and new not in out.values()]
            if len(match) == 1:
                out[old] = match[0]
    return out


def rename_ids(text: str, renames: dict[str, str]) -> str:
    """Rename whole tokens (IDs) everywhere in a model's text."""
    for old, new in renames.items():
        text = re.sub(rf"(?<![^\s\"]){re.escape(old)}(?![^\s\"])", new, text)
    return text
