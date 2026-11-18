"""Read the SWMM status report (.rpt) into structured data.

Works for EPA SWMM 5 and OpenSWMM 6 reports (same layout). Gives the run
summary modellers check first (continuity errors, flooding, surcharge,
warnings and errors) and every "... Summary" table as columns + rows so the
UI can sort them and link rows to map objects.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

# Column names for the standard summary tables (data rows split on whitespace).
COLUMNS: dict[str, list[str]] = {
    "Subcatchment Runoff Summary": [
        "Subcatchment", "Total Precip", "Total Runon", "Total Evap", "Total Infil",
        "Imperv Runoff", "Perv Runoff", "Total Runoff", "Total Runoff Volume",
        "Peak Runoff", "Runoff Coeff",
    ],
    "Node Depth Summary": [
        "Node", "Type", "Average Depth", "Maximum Depth", "Maximum HGL",
        "Days", "Time of Max", "Reported Max Depth",
    ],
    "Node Inflow Summary": [
        "Node", "Type", "Max Lateral Inflow", "Max Total Inflow", "Days", "Time of Max",
        "Lateral Inflow Volume", "Total Inflow Volume", "Flow Balance Error",
    ],
    "Node Surcharge Summary": [
        "Node", "Type", "Hours Surcharged", "Max Height Above Crown", "Min Depth Below Rim",
    ],
    "Node Flooding Summary": [
        "Node", "Hours Flooded", "Max Rate", "Days", "Time of Max",
        "Total Flood Volume", "Max Ponded Depth",
    ],
    "Storage Volume Summary": [
        "Storage Unit", "Average Volume", "Avg Pcnt Full", "Evap Pcnt Loss", "Exfil Pcnt Loss",
        "Maximum Volume", "Max Pcnt Full", "Days", "Time of Max", "Maximum Outflow",
    ],
    "Outfall Loading Summary": ["Outfall Node", "Flow Freq", "Avg Flow", "Max Flow", "Total Volume"],
    "Link Flow Summary": [
        "Link", "Type", "Maximum Flow", "Days", "Time of Max", "Maximum Velocity",
        "Max/Full Flow", "Max/Full Depth",
    ],
    "Conduit Surcharge Summary": [
        "Conduit", "Hours Full Both Ends", "Hours Full Upstream", "Hours Full Dnstream",
        "Hours Above Full Normal Flow", "Hours Capacity Limited",
    ],
    "Pumping Summary": [
        "Pump", "Percent Utilized", "Number of Start-Ups", "Min Flow", "Avg Flow", "Max Flow",
        "Total Volume", "Power Usage", "% Time Off Pump Curve Low", "% Time Off Pump Curve High",
    ],
}

# Which map object each table's first column names.
OBJECT_KIND = {
    "Subcatchment Runoff Summary": "subcatchment",
    "Node Depth Summary": "node",
    "Node Inflow Summary": "node",
    "Node Surcharge Summary": "node",
    "Node Flooding Summary": "node",
    "Storage Volume Summary": "node",
    "Outfall Loading Summary": "node",
    "Link Flow Summary": "link",
    "Conduit Surcharge Summary": "link",
    "Pumping Summary": "link",
}

_STAR = re.compile(r"^\s*\*{5,}\s*$")
_DASH = re.compile(r"^\s*-{10,}\s*$")
_UNIT = re.compile(
    r"^(Feet|Meters|in|mm|CFS|CMS|LPS|MGD|GPM|MLD|ft/sec|m/sec|10\^6 (gal|ltr)|Percent|kW-hr|"
    r"1000 ft3|1000 m3|acre-feet|hectare-m)$"
)
_NUM = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


def _num(tok: str) -> Any:
    return float(tok) if _NUM.match(tok) else tok


def _sections(lines: list[str]) -> dict[str, list[str]]:
    """Split the report at its ``*****\\nTitle\\n*****`` banners."""
    out: dict[str, list[str]] = {}
    i, n = 0, len(lines)
    title: Optional[str] = None
    buf: list[str] = []
    while i < n:
        if _STAR.match(lines[i]) and i + 2 < n and _STAR.match(lines[i + 2]):
            if title:
                out[title] = buf
            title, buf = lines[i + 1].strip(), []
            i += 3
            continue
        # continuity blocks: "****  Volume  Depth" / "Runoff Quantity Continuity ..." / "****"
        if lines[i].strip().startswith("*****") and i + 2 < n and lines[i + 2].strip().startswith("*****"):
            if title:
                out[title] = buf
            title, buf = re.split(r"\s{2,}", lines[i + 1].strip())[0], []
            i += 3
            continue
        buf.append(lines[i])
        i += 1
    if title:
        out[title] = buf
    return out


def _table(title: str, body: list[str]) -> Optional[dict[str, Any]]:
    dashes = [k for k, ln in enumerate(body) if _DASH.match(ln)]
    if len(dashes) < 2:
        return None
    head = body[dashes[0] + 1 : dashes[1]]
    units_line = head[-1] if head else ""
    rows: list[list[Any]] = []
    for ln in body[dashes[1] + 1 :]:
        if not ln.strip():
            if rows:
                break
            continue
        if _DASH.match(ln):
            break  # e.g. the System total under Outfall Loading
        toks = ln.split()
        rows.append([_num(t) for t in toks])
    cols = COLUMNS.get(title) or [f"Col {k + 1}" for k in range(max((len(r) for r in rows), default=0))]
    rows = [r + [None] * (len(cols) - len(r)) if len(r) < len(cols) else r[: len(cols)] for r in rows]
    utoks = units_line.split()
    merged: list[str] = []
    for t in utoks:
        if merged and merged[-1] == "10^6":
            merged[-1] = f"10^6 {t}"
        else:
            merged.append(t)
    units = [u if _UNIT.match(u) else "" for u in merged] if len(merged) == len(cols) else [""] * len(cols)
    units[0] = ""
    return {"title": title, "object": OBJECT_KIND.get(title), "columns": cols, "units": units, "rows": rows}


def _continuity(body: list[str]) -> Optional[float]:
    for ln in body:
        if "Continuity Error" in ln:
            m = re.search(r"([-+]?\d+\.\d+)\s*$", ln)
            if m:
                return float(m.group(1))
    return None


def parse_report(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    secs = _sections(lines)
    tables = {t: tb for t, body in secs.items() if t in COLUMNS and (tb := _table(t, body))}

    warnings = [ln.strip() for ln in lines if re.match(r"^\s*WARNING\b", ln)]
    errors = [ln.strip() for ln in lines if re.match(r"^\s*ERROR\b", ln)]
    engine = next((ln.strip() for ln in lines[:6] if "VERSION" in ln.upper()), None)

    flood = tables.get("Node Flooding Summary")
    flooded = flood["rows"] if flood else []
    vol_idx = 5
    flood_volume = sum(r[vol_idx] for r in flooded if isinstance(r[vol_idx], float)) if flooded else 0.0
    flood_units = (flood["units"][vol_idx] if flood else "") or ""
    surch = tables.get("Node Surcharge Summary")
    csurch = tables.get("Conduit Surcharge Summary")
    elapsed = next((ln.split(":", 1)[1].strip() for ln in lines if "Total elapsed time" in ln), None)

    return {
        "engine": engine,
        "runoff_continuity_pct": _continuity(secs.get("Runoff Quantity Continuity", [])),
        "routing_continuity_pct": _continuity(secs.get("Flow Routing Continuity", [])),
        "flooded_nodes": len(flooded),
        "flood_volume": round(flood_volume, 4),
        "flood_volume_units": flood_units,
        "surcharged_nodes": len(surch["rows"]) if surch else 0,
        "surcharged_conduits": len(csurch["rows"]) if csurch else 0,
        "warnings": warnings[:200],
        "errors": errors[:200],
        "elapsed": elapsed,
        "highest_continuity_errors": [
            ln.strip() for ln in secs.get("Highest Continuity Errors", []) if ln.strip()
        ][:10],
        "tables": list(tables.values()),
    }


def summarize_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"available": False}
    data = parse_report(path.read_text(encoding="utf-8", errors="replace"))
    data["available"] = True
    return data
