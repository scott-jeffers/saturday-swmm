"""Make an INP parseable by EPA SWMM 5 (PySWMM).

Handles three families of non-EPA content:

* OpenSWMM / Saturday-SWMM ``[2D_*]`` sections (stripped).
* PCSWMM 2D conventions: a subcatchment outlet of ``*`` means "runoff goes
  onto the 2D surface". EPA SWMM rejects it (ERROR 209), so those outlets are
  re-pointed at a single isolated dummy outfall (``SURFACE_OUTFALL_ID``).
* Graphics-only sections (``[POLYGONS]``, ``[VERTICES]``, ``[TAGS]`` …) are
  dropped — they can be hundreds of thousands of lines in PCSWMM exports and
  the engine never reads them.

"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional


# OpenSWMM / Saturday-SWMM 2D sections EPA SWMM5 does not understand.
_OPENSWMM_2D_SECTIONS = frozenset(
    {
        "2D_OPTIONS",
        "2D_VERTICES",
        "2D_TRIANGLES",
        "2D_VERTEX_NODE_MAP",
        "2D_BOUNDARY_CONDITIONS",
        "2D_MESH_FILE",
        "2D_INFILTRATION",
        "2D_ROUGHNESS",
        "2D_RAINFALL",
    }
)

# OpenSWMM-only markers EPA SWMM 5 rejects (ERROR 205 "invalid keyword").
_OPENSWMM_ONLY_SECTIONS = frozenset({"END"})

# Map / GUI sections the SWMM engine ignores.
_GRAPHICS_SECTIONS = frozenset(
    {"POLYGONS", "VERTICES", "SYMBOLS", "LABELS", "BACKDROP", "MAP", "TAGS"}
)

# PCSWMM tag on nodes connected to its 2D mesh.
CONNECT_2D_TAG = "connect2d"

SURFACE_OUTFALL_ID = "EPA_SURFACE_OUTFALL"
SURFACE_OUTLET_TOKENS = frozenset({"*"})

_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$", re.IGNORECASE)


@dataclass
class SanitizeReport:
    removed_sections: list[str] = field(default_factory=list)
    surface_subcatchments: list[str] = field(default_factory=list)
    surcharge_zeroed: int = 0
    added_outfall: Optional[str] = None


def strip_openswmm_2d_sections(text: str) -> tuple[str, list[str]]:
    """Return (sanitized_text, list of removed section names). 2D sections only."""
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    removed: list[str] = []
    skip = False

    for line in lines:
        m = _SECTION_RE.match(line.rstrip("\r\n"))
        if m:
            name = m.group(1).strip().upper()
            if name in _OPENSWMM_2D_SECTIONS:
                skip = True
                if name not in removed:
                    removed.append(name)
                continue
            skip = False
            out.append(line)
            continue
        if skip:
            continue
        out.append(line)

    body = "".join(out)
    if body and not body.endswith("\n"):
        body += "\n"
    return body, removed


def _is_data(line: str) -> bool:
    s = line.strip()
    return bool(s) and not s.startswith(";")


def read_connect2d_nodes(text: str) -> set[str]:
    """Node IDs tagged ``Connect2D`` in a PCSWMM ``[TAGS]`` section."""
    out: set[str] = set()
    in_tags = False
    for line in text.splitlines():
        m = _SECTION_RE.match(line)
        if m:
            in_tags = m.group(1).strip().upper() == "TAGS"
            continue
        if not in_tags or not _is_data(line):
            continue
        toks = line.split()
        if len(toks) >= 3 and toks[0].lower() == "node" and toks[2].lower() == CONNECT_2D_TAG:
            out.add(toks[1])
    return out


def surface_outlet_subcatchments(text: str) -> list[str]:
    """Subcatchments whose outlet is a 2D-surface token (``*``)."""
    out: list[str] = []
    sec = None
    for line in text.splitlines():
        m = _SECTION_RE.match(line)
        if m:
            sec = m.group(1).strip().upper()
            continue
        if sec == "SUBCATCHMENTS" and _is_data(line):
            toks = line.split()
            if len(toks) >= 3 and toks[2] in SURFACE_OUTLET_TOKENS:
                out.append(toks[0])
    return out


def sanitize_for_pyswmm(
    text: str,
    *,
    zero_surcharge_nodes: Optional[Iterable[str]] = None,
    drop_graphics: bool = True,
) -> tuple[str, SanitizeReport]:
    """Return (EPA-SWMM-parseable INP text, report)."""
    report = SanitizeReport()
    zero = set(zero_surcharge_nodes or ())
    drop = set(_OPENSWMM_2D_SECTIONS) | _OPENSWMM_ONLY_SECTIONS
    if drop_graphics:
        drop |= _GRAPHICS_SECTIONS

    out: list[str] = []
    sec: Optional[str] = None
    skip = False
    have_outfalls = False

    for line in text.splitlines(keepends=True):
        m = _SECTION_RE.match(line.rstrip("\r\n"))
        if m:
            sec = m.group(1).strip().upper()
            skip = sec in drop
            if skip:
                if sec not in report.removed_sections:
                    report.removed_sections.append(sec)
                continue
            out.append(line)
            if sec == "OUTFALLS":
                have_outfalls = True
            continue
        if skip:
            continue
        if sec == "SUBCATCHMENTS" and _is_data(line):
            toks = line.split()
            if len(toks) >= 3 and toks[2] in SURFACE_OUTLET_TOKENS:
                report.surface_subcatchments.append(toks[0])
                toks[2] = SURFACE_OUTFALL_ID
                line = "  ".join(toks) + "\n"
        elif sec == "JUNCTIONS" and zero and _is_data(line):
            toks = line.split()
            # Name Elev MaxDepth InitDepth SurDepth Aponded
            if toks[0] in zero and len(toks) >= 5:
                try:
                    if float(toks[4]) != 0.0:
                        toks[4] = "0"
                        report.surcharge_zeroed += 1
                        line = "  ".join(toks) + "\n"
                except ValueError:
                    pass
        out.append(line)

    if report.surface_subcatchments:
        # Isolated free outfall that receives "*" runoff. Elevation is irrelevant (no links).
        outfall_line = f"{SURFACE_OUTFALL_ID}  0  FREE  NO\n"
        if have_outfalls:
            idx = next(
                i for i, ln in enumerate(out)
                if _SECTION_RE.match(ln.rstrip("\r\n"))
                and _SECTION_RE.match(ln.rstrip("\r\n")).group(1).strip().upper() == "OUTFALLS"
            )
            out.insert(idx + 1, outfall_line)
        else:
            out.append("\n[OUTFALLS]\n" + outfall_line)
        report.added_outfall = SURFACE_OUTFALL_ID

    body = "".join(out)
    if body and not body.endswith("\n"):
        body += "\n"
    return body, report
