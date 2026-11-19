"""Professional editing tools on the INP text: every section as a table,
all [OPTIONS], and a pre-run model check.

Section editing replaces a section's data rows and keeps its header
comments, so files written by EPA SWMM or PCSWMM stay readable in those tools.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.fs_utils import atomic_write_text
from app.services.inp_model_service import _is_comment, _quote_if_needed, _token_spans, _tokenize, _unquote

_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")

# Column names per section (EPA SWMM 5.2 input file format). Rows may have
# fewer or more fields than listed; extra fields get generic names.
COLUMNS: dict[str, list[str]] = {
    "TITLE": [],
    "OPTIONS": ["Option", "Value"],
    "REPORT": ["Option", "Value"],
    "FILES": ["Action", "File type", "File name"],
    "RAINGAGES": ["Name", "Format", "Interval", "SCF", "Source", "Source name / file", "Station", "Units"],
    "EVAPORATION": ["Type", "Parameters"],
    "TEMPERATURE": ["Type", "Parameters"],
    "ADJUSTMENTS": ["Type", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "SUBCATCHMENTS": ["Name", "Rain gage", "Outlet", "Area", "% Imperv", "Width", "% Slope", "Curb length", "Snow pack"],
    "SUBAREAS": ["Subcatchment", "N-Imperv", "N-Perv", "S-Imperv", "S-Perv", "% Zero", "Route to", "% Routed"],
    "INFILTRATION": ["Subcatchment", "Param 1", "Param 2", "Param 3", "Param 4", "Param 5", "Method"],
    "LID_CONTROLS": ["Name", "Type / layer", "Parameters"],
    "LID_USAGE": ["Subcatchment", "LID process", "Number", "Area", "Width", "Init. sat. %", "From imperv %", "To pervious", "Report file", "Drain to", "From pervious %"],
    "AQUIFERS": ["Name", "Porosity", "Wilting pt", "Field cap", "Ksat", "K slope", "Tension slope", "ET fraction", "Seepage", "Bottom elev", "Water table", "Unsat. moisture", "Upper evap pattern"],
    "GROUNDWATER": ["Subcatchment", "Aquifer", "Node", "Surface elev", "A1", "B1", "A2", "B2", "A3", "Surface depth", "Threshold elev", "Bottom elev", "Water table", "Unsat. moisture"],
    "GWF": ["Subcatchment", "Flow type", "Expression"],
    "SNOWPACKS": ["Name", "Surface", "Parameters"],
    "JUNCTIONS": ["Name", "Invert elev", "Max depth", "Initial depth", "Surcharge depth", "Ponded area"],
    "OUTFALLS": ["Name", "Invert elev", "Type", "Stage data", "Gated", "Route to"],
    "DIVIDERS": ["Name", "Invert elev", "Diverted link", "Type", "Parameters"],
    "STORAGE": ["Name", "Invert elev", "Max depth", "Initial depth", "Shape", "Curve / A", "B", "C", "Surcharge depth", "Evap. factor", "Seepage"],
    "CONDUITS": ["Name", "From node", "To node", "Length", "Roughness", "Inlet offset", "Outlet offset", "Initial flow", "Max flow"],
    "PUMPS": ["Name", "From node", "To node", "Pump curve", "Status", "Startup depth", "Shutoff depth"],
    "ORIFICES": ["Name", "From node", "To node", "Type", "Offset", "Discharge coeff.", "Gated", "Close time"],
    "WEIRS": ["Name", "From node", "To node", "Type", "Crest height", "Discharge coeff.", "Gated", "End contractions", "End coeff.", "Surcharge", "Road width", "Road surface", "Coeff. curve"],
    "OUTLETS": ["Name", "From node", "To node", "Offset", "Type", "Coeff. / curve", "Exponent", "Gated"],
    "XSECTIONS": ["Link", "Shape", "Geom1", "Geom2", "Geom3", "Geom4", "Barrels", "Culvert code"],
    "TRANSECTS": [],
    "STREETS": ["Name", "Tcrown", "Hcurb", "Sx", "nRoad", "a", "W", "Sides", "Tback", "Sback", "nBack"],
    "INLETS": ["Name", "Type", "Parameters"],
    "INLET_USAGE": ["Conduit", "Inlet", "Node", "Number", "% Clogged", "Max flow", "hDStore", "wDStore", "Placement"],
    "LOSSES": ["Link", "Entry loss", "Exit loss", "Average loss", "Flap gate", "Seepage"],
    "CONTROLS": [],
    "POLLUTANTS": ["Name", "Units", "Rain conc.", "GW conc.", "RDII conc.", "Decay coeff.", "Snow only", "Co-pollutant", "Co-fraction", "DWF conc.", "Init. conc."],
    "LANDUSES": ["Name", "Sweep interval", "Availability", "Last swept"],
    "COVERAGES": ["Subcatchment", "Land use", "Percent"],
    "LOADINGS": ["Subcatchment", "Pollutant", "Buildup"],
    "BUILDUP": ["Land use", "Pollutant", "Function", "C1", "C2", "C3", "Per unit"],
    "WASHOFF": ["Land use", "Pollutant", "Function", "C1", "C2", "Sweep removal", "BMP removal"],
    "TREATMENT": ["Node", "Pollutant", "Expression"],
    "INFLOWS": ["Node", "Constituent", "Time series", "Type", "Mfactor", "Sfactor", "Baseline", "Pattern"],
    "DWF": ["Node", "Constituent", "Average value", "Pattern 1", "Pattern 2", "Pattern 3", "Pattern 4"],
    "RDII": ["Node", "Unit hydrograph", "Sewer area"],
    "HYDROGRAPHS": ["Name", "Month / gage", "Response", "R", "T", "K", "Dmax", "Drecov", "Dinit"],
    "CURVES": ["Name", "Type / X", "X / Y", "Y"],
    "TIMESERIES": ["Name", "Date / time", "Time / value", "Value"],
    "PATTERNS": ["Name", "Type / factors", "Factors"],
    "MAP": ["Key", "Values"],
    "COORDINATES": ["Node", "X", "Y"],
    "VERTICES": ["Link", "X", "Y"],
    "POLYGONS": ["Subcatchment", "X", "Y"],
    "SYMBOLS": ["Gage", "X", "Y"],
    "LABELS": ["X", "Y", "Label", "Anchor", "Font", "Size", "Bold", "Italic"],
    "BACKDROP": ["Key", "Values"],
    "TAGS": ["Object type", "Name", "Tag"],
}
# Sections edited as free text (multi-line records).
TEXT_SECTIONS = {"TITLE", "CONTROLS", "TRANSECTS"}

# [OPTIONS] keys with their allowed values (None = free value), grouped as in
# EPA SWMM's Simulation Options dialog.
OPTION_GROUPS: list[tuple[str, list[tuple[str, Optional[list[str]], str]]]] = [
    ("General", [
        ("FLOW_UNITS", ["CFS", "GPM", "MGD", "CMS", "LPS", "MLD"], "Flow units (US or SI)"),
        ("INFILTRATION", ["HORTON", "MODIFIED_HORTON", "GREEN_AMPT", "MODIFIED_GREEN_AMPT", "CURVE_NUMBER"], "Infiltration model"),
        ("FLOW_ROUTING", ["STEADY", "KINWAVE", "DYNWAVE"], "Routing model"),
        ("LINK_OFFSETS", ["DEPTH", "ELEVATION"], "Link offsets measured as"),
        ("MIN_SLOPE", None, "Minimum conduit slope (%)"),
        ("ALLOW_PONDING", ["YES", "NO"], "Allow ponding at nodes"),
        ("SKIP_STEADY_STATE", ["YES", "NO"], "Skip steady-state periods"),
        ("IGNORE_RAINFALL", ["YES", "NO"], "Ignore rainfall/runoff"),
        ("IGNORE_SNOWMELT", ["YES", "NO"], "Ignore snowmelt"),
        ("IGNORE_GROUNDWATER", ["YES", "NO"], "Ignore groundwater"),
        ("IGNORE_RDII", ["YES", "NO"], "Ignore RDII"),
        ("IGNORE_ROUTING", ["YES", "NO"], "Ignore flow routing"),
        ("IGNORE_QUALITY", ["YES", "NO"], "Ignore water quality"),
    ]),
    ("Dates", [
        ("START_DATE", None, "Start date (MM/DD/YYYY)"),
        ("START_TIME", None, "Start time (HH:MM:SS)"),
        ("REPORT_START_DATE", None, "Report start date"),
        ("REPORT_START_TIME", None, "Report start time"),
        ("END_DATE", None, "End date"),
        ("END_TIME", None, "End time"),
        ("SWEEP_START", None, "Street sweeping starts (MM/DD)"),
        ("SWEEP_END", None, "Street sweeping ends (MM/DD)"),
        ("DRY_DAYS", None, "Antecedent dry days"),
    ]),
    ("Time steps", [
        ("REPORT_STEP", None, "Reporting step (HH:MM:SS)"),
        ("WET_STEP", None, "Runoff wet step"),
        ("DRY_STEP", None, "Runoff dry step"),
        ("ROUTING_STEP", None, "Routing step (seconds or HH:MM:SS)"),
        ("RULE_STEP", None, "Control rule step"),
        ("SYS_FLOW_TOL", None, "Steady-state system flow tolerance (%)"),
        ("LAT_FLOW_TOL", None, "Steady-state lateral flow tolerance (%)"),
    ]),
    ("Dynamic wave", [
        ("INERTIAL_DAMPING", ["NONE", "PARTIAL", "FULL"], "Inertial terms"),
        ("NORMAL_FLOW_LIMITED", ["SLOPE", "FROUDE", "BOTH"], "Normal flow limitation"),
        ("FORCE_MAIN_EQUATION", ["H-W", "D-W"], "Force main equation"),
        ("SURCHARGE_METHOD", ["EXTRAN", "SLOT"], "Surcharge method"),
        ("VARIABLE_STEP", None, "Variable step safety factor"),
        ("LENGTHENING_STEP", None, "Conduit lengthening step (s)"),
        ("MIN_SURFAREA", None, "Minimum nodal surface area"),
        ("MAX_TRIALS", None, "Maximum trials per step"),
        ("HEAD_TOLERANCE", None, "Head convergence tolerance"),
        ("MINIMUM_STEP", None, "Minimum variable step (s)"),
        ("THREADS", None, "Threads (0 = all cores)"),
    ]),
]
_OPTION_KEYS = {k for _, items in OPTION_GROUPS for k, _, _ in items}


# ------------------------------------------------------------- utilities
def _inp() -> Path:
    from app.services.project_service import project_service

    return project_service.require_inp()


def _read() -> str:
    return _inp().read_text(encoding="utf-8", errors="replace")


def _write(text: str) -> None:
    from app.services.inp_model_service import inp_model_service

    atomic_write_text(_inp(), text)
    inp_model_service.invalidate()


def _span(lines: list[str], name: str) -> Optional[tuple[int, int]]:
    """(header line index, end index exclusive) of a section, or None."""
    start = None
    for i, ln in enumerate(lines):
        m = _SECTION_RE.match(ln.rstrip("\r\n"))
        if m:
            if start is not None:
                return start, i
            if m.group(1).strip().upper() == name.upper():
                start = i
    return (start, len(lines)) if start is not None else None


def _newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def _format_row(values: list[str], widths: list[int]) -> str:
    vals = [_quote_if_needed(str(v)) if str(v) != "" else '""' for v in values]
    while vals and vals[-1] == '""':
        vals.pop()
    out = []
    for i, v in enumerate(vals):
        w = widths[i] if i < len(widths) else 0
        out.append(v.ljust(w) if i < len(vals) - 1 else v)
    return " ".join(out).rstrip()


# --------------------------------------------------------------- sections
def list_sections() -> dict[str, Any]:
    text = _read()
    present: list[dict[str, Any]] = []
    cur = None
    counts: dict[str, int] = defaultdict(int)
    names: dict[str, str] = {}
    for ln in text.splitlines():
        m = _SECTION_RE.match(ln)
        if m:
            cur = m.group(1).strip()
            names.setdefault(cur.upper(), cur)
            counts.setdefault(cur.upper(), 0)
            continue
        if cur and not _is_comment(ln):
            counts[cur.upper()] += 1
    for up, n in counts.items():
        present.append({"name": names[up], "rows": n, "known": up in COLUMNS, "text": up in TEXT_SECTIONS})
    missing = [k for k in COLUMNS if k not in counts]
    return {"sections": present, "available": missing}


def get_section(name: str) -> dict[str, Any]:
    up = name.upper()
    text = _read()
    lines = text.splitlines()
    sp = _span(lines, up)
    body = lines[sp[0] + 1 : sp[1]] if sp else []
    if up in TEXT_SECTIONS:
        data = [ln for ln in body]
        while data and not data[-1].strip():
            data.pop()
        return {"name": name, "kind": "text", "text": "\n".join(data)}
    rows = []
    width = 0
    for ln in body:
        if _is_comment(ln):
            continue
        spans, end = _token_spans(ln)
        vals = [_unquote(ln[a:b]) for a, b in spans]
        comment = ln[end:].lstrip(";").strip() if end < len(ln) else ""
        rows.append({"values": vals, "comment": comment})
        width = max(width, len(vals))
    cols = list(COLUMNS.get(up, []))
    while len(cols) < width:
        cols.append(f"Field {len(cols) + 1}")
    return {"name": name, "kind": "table", "columns": cols, "rows": rows}


def put_section(name: str, rows: Optional[list[dict[str, Any]]] = None, text_body: Optional[str] = None) -> dict[str, Any]:
    up = name.upper()
    if not re.match(r"^[A-Za-z0-9_]+$", name):
        raise HTTPException(status_code=400, detail="Invalid section name")
    text = _read()
    nl = _newline(text)
    lines = text.splitlines()
    sp = _span(lines, up)
    if up in TEXT_SECTIONS or text_body is not None:
        new_body = (text_body or "").replace("\r\n", "\n").split("\n")
        header: list[str] = []
    else:
        vals = [[str(v) for v in (r.get("values") or [])] for r in (rows or [])]
        vals = [v for v in vals if any(x.strip() for x in v)]
        widths = [max((len(_quote_if_needed(r[i])) for r in vals if i < len(r)), default=0) + 2 for i in range(max((len(r) for r in vals), default=0))]
        # keep the section's own column header comments (";;Name ...")
        header = []
        if sp:
            for ln in lines[sp[0] + 1 : sp[1]]:
                if ln.strip().startswith(";;"):
                    header.append(ln)
                elif ln.strip() and not ln.strip().startswith(";"):
                    break
        if not header and COLUMNS.get(up):
            header = [";;" + " ".join(c.ljust(widths[i] - 2 if i < len(widths) else len(c)) for i, c in enumerate(COLUMNS[up]))]
        new_body = []
        for r, v in zip(rows or [], [[str(x) for x in (r.get("values") or [])] for r in rows or []]):
            if not any(x.strip() for x in v):
                continue
            line = _format_row(v, widths)
            if r.get("comment"):
                line += f"  ;{r['comment']}"
            new_body.append(line)
    block = [*header, *new_body, ""]
    if sp:
        lines[sp[0] + 1 : sp[1]] = block
    else:
        # insert before map/geometry sections so the file reads like EPA SWMM's
        at = len(lines)
        for marker in ("MAP", "COORDINATES", "VERTICES", "POLYGONS", "SYMBOLS", "LABELS", "BACKDROP"):
            s2 = _span(lines, marker)
            if s2:
                at = min(at, s2[0])
        lines[at:at] = [f"[{up}]", *block]
    _write(nl.join(lines).rstrip() + nl)
    return get_section(name)


# ---------------------------------------------------------------- options
def get_options() -> dict[str, Any]:
    sec = get_section("OPTIONS")
    values = {r["values"][0].upper(): " ".join(r["values"][1:]) for r in sec.get("rows", []) if r["values"]}
    groups = [
        {"name": g, "options": [{"key": k, "label": label, "choices": ch, "value": values.get(k, "")} for k, ch, label in items]}
        for g, items in OPTION_GROUPS
    ]
    other = {k: v for k, v in values.items() if k not in _OPTION_KEYS}
    return {"groups": groups, "other": other}


def put_options(new_values: dict[str, str]) -> dict[str, Any]:
    sec = get_section("OPTIONS")
    rows = [r["values"] for r in sec.get("rows", []) if r["values"]]
    by_key = {r[0].upper(): i for i, r in enumerate(rows)}
    for k, v in new_values.items():
        key = k.strip().upper()
        if not re.match(r"^[A-Z0-9_]+$", key):
            raise HTTPException(status_code=400, detail=f"Invalid option name: {k}")
        val = str(v).strip()
        if key in by_key:
            if val:
                rows[by_key[key]] = [key, *val.split()]
            else:
                rows[by_key[key]] = []
        elif val:
            rows.append([key, *val.split()])
    put_section("OPTIONS", [{"values": r} for r in rows if r])
    return get_options()


# ------------------------------------------------------------ model check
def check_model() -> dict[str, Any]:
    from app.services.inp_model_service import inp_model_service

    inp = _inp()
    model = inp_model_service.load(inp)
    issues: list[dict[str, Any]] = []

    def add(sev: str, msg: str, kind: Optional[str] = None, oid: Optional[str] = None):
        issues.append({"severity": sev, "message": msg, "object_type": kind, "id": oid})

    nodes = model.all_nodes()
    links = model.all_links()
    # duplicate IDs across sections
    seen: dict[str, str] = {}
    for sec, store, kind in (
        ("JUNCTIONS", model.junctions, "node"), ("OUTFALLS", model.outfalls, "node"), ("STORAGE", model.storage, "node"),
        ("CONDUITS", model.conduits, "link"), ("PUMPS", model.pumps, "link"), ("ORIFICES", model.orifices, "link"),
        ("WEIRS", model.weirs, "link"), ("OUTLETS", model.outlets, "link"), ("SUBCATCHMENTS", model.subcatchments, "subcatchment"),
    ):
        for oid in store:
            if oid in seen and seen[oid] != sec:
                add("error", f"{oid} is used in both [{seen[oid]}] and [{sec}]; SWMM names must be unique.", kind, oid)
            seen.setdefault(oid, sec)
    counts: dict[str, int] = defaultdict(int)
    for sec in ("JUNCTIONS", "CONDUITS", "SUBCATCHMENTS", "OUTFALLS", "STORAGE"):
        for _, raw in model.sections.get(sec, []):
            if not _is_comment(raw):
                t = _tokenize(raw)
                if t:
                    counts[f"{sec}:{t[0]}"] += 1
    for key, n in counts.items():
        if n > 1:
            sec, oid = key.split(":", 1)
            add("error", f"{oid} is defined {n} times in [{sec}].", None, oid)

    connected: dict[str, list[str]] = defaultdict(list)
    for lid, a in links.items():
        for end in ("from_node", "to_node"):
            nid = a.get(end)
            if nid not in nodes:
                add("error", f"Link {lid} refers to node {nid}, which doesn't exist.", "link", lid)
            else:
                connected[nid].append(lid)
        if a.get("link_kind") == "conduit" and lid not in model.xsections:
            add("error", f"Conduit {lid} has no cross-section in [XSECTIONS].", "link", lid)
    for nid, a in nodes.items():
        if not connected.get(nid):
            add("warning", f"Node {nid} isn't connected to any link.", "node", nid)
        if nid not in model.coordinates:
            add("info", f"Node {nid} has no map coordinates.", "node", nid)

    surface = [sid for sid, sc in model.subcatchments.items() if sc.get("outlet") == "*"]
    if surface:
        try:
            from app.services.project_service import project_service

            engine = project_service.get_simulation_engine()
        except Exception:
            engine = "openswmm"
        if engine == "openswmm":
            add(
                "error",
                f"{len(surface)} subcatchment(s) drain to '*', PCSWMM's 2D surface. OpenSWMM 6 does not accept '*' "
                "outlets, even with a 2D mesh. Run with EPA SWMM 5.2 (Settings > Engine > Automatic), or point "
                "these subcatchments at a node.",
                "subcatchment",
                surface[0],
            )
        elif engine == "pyswmm":
            add(
                "warning",
                f"{len(surface)} subcatchment(s) drain to '*', PCSWMM's 2D surface. EPA SWMM 5.2 sends that runoff "
                "to a surface outfall, so it leaves the model instead of reaching the pipes.",
                "subcatchment",
                surface[0],
            )

    gages = {(_tokenize(r) or [""])[0] for _, r in model.sections.get("RAINGAGES", []) if not _is_comment(r)}
    for sid, sc in model.subcatchments.items():
        out = sc.get("outlet")
        if out not in nodes and out not in model.subcatchments and out != "*":
            add("error", f"Subcatchment {sid} drains to {out}, which doesn't exist.", "subcatchment", sid)
        if sc.get("raingage") and sc["raingage"] not in gages:
            add("error", f"Subcatchment {sid} uses rain gage {sc['raingage']}, which doesn't exist.", "subcatchment", sid)
        if (sc.get("area") or 0) <= 0:
            add("warning", f"Subcatchment {sid} has zero area.", "subcatchment", sid)

    # conduit geometry: adverse slope, offsets above node depth, zero length
    offsets_elev = any(
        (_tokenize(r)[:2] == ["LINK_OFFSETS", "ELEVATION"]) for _, r in model.sections.get("OPTIONS", []) if not _is_comment(r)
    )
    for lid, c in model.conduits.items():
        up, dn = nodes.get(c.get("from_node")), nodes.get(c.get("to_node"))
        if not up or not dn:
            continue
        try:
            in_off = float(c.get("in_offset") or 0)
            out_off = float(c.get("out_offset") or 0)
            length = float(c.get("length") or 0)
        except (TypeError, ValueError):
            continue
        if length <= 0:
            add("error", f"Conduit {lid} has zero length.", "link", lid)
            continue
        z_up = in_off if offsets_elev else (up.get("elevation") or 0) + in_off
        z_dn = out_off if offsets_elev else (dn.get("elevation") or 0) + out_off
        if z_up < z_dn - 1e-9:
            add("warning", f"Conduit {lid} slopes uphill ({z_up:.2f} → {z_dn:.2f}). Check its invert elevations or direction.", "link", lid)
        if not offsets_elev:
            for nd, off, nid in ((up, in_off, c.get("from_node")), (dn, out_off, c.get("to_node"))):
                md = nd.get("max_depth") or 0
                if md and off > md:
                    add("warning", f"Conduit {lid} enters node {nid} above its rim (offset {off} > max depth {md}).", "link", lid)

    # every node should reach an outfall
    downstream: dict[str, list[str]] = defaultdict(list)
    for lid, a in links.items():
        downstream[a.get("to_node")].append(a.get("from_node"))
    reach: set[str] = set(model.outfalls)
    q = deque(model.outfalls)
    while q:
        n = q.popleft()
        for up in downstream.get(n, []):
            if up not in reach:
                reach.add(up)
                q.append(up)
    if model.outfalls:
        cut = [n for n in nodes if n not in reach and connected.get(n)]
        if cut:
            shown = ", ".join(cut[:10]) + (" …" if len(cut) > 10 else "")
            add("warning", f"{len(cut)} node(s) have no path to an outfall: {shown}", "node", cut[0])
    elif nodes:
        add("error", "The model has no outfall.", None, None)

    order = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: order[i["severity"]])
    return {
        "errors": sum(i["severity"] == "error" for i in issues),
        "warnings": sum(i["severity"] == "warning" for i in issues),
        "issues": issues[:500],
    }
