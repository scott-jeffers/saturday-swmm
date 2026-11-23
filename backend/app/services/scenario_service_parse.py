"""Reading an .inp into sections of objects (rows keyed by ID), and writing it back.

Shared by scenarios (diffs, merges, inheritance).
"""

from __future__ import annotations

import re
from collections import OrderedDict
from typing import Optional

# Sections compared as one block (multi-line records or free text).
WHOLE_SECTIONS = {"TITLE", "CONTROLS", "TRANSECTS", "MAP", "BACKDROP"}
# Sections whose rows are keyed by the first two tokens.
TWO_TOKEN_KEYS = {"TAGS", "INFLOWS", "DWF", "LID_USAGE", "LOADINGS", "BUILDUP", "WASHOFF", "TREATMENT", "COVERAGES"}

_SECTION_RE = re.compile(r"^\s*\[([^\]]+)\]\s*$")


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


