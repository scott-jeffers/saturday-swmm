"""Per-unit LID report files, so Graphs can chart each LID unit over time.

SWMM writes a time series for an LID unit only when its [LID_USAGE] row names a
report file. Before each run we give every row that has none a file in a
hidden folder next to the model (``.<model>.lid/``), in the copy of the input
the engine runs; the model itself is not changed. Report files a model names
itself are left alone and read from where the model puts them.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

# A report beyond this is skipped (very long continuous runs at fine steps).
MAX_REPORT_BYTES = 40 * 1024 * 1024


def report_dir(inp_path: Path) -> Path:
    return inp_path.with_name(f".{inp_path.stem}.lid")


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s)[:60] or "x"


def _rows(text: str) -> list[tuple[int, list[str]]]:
    """(line index, tokens) for each data row of [LID_USAGE]."""
    out: list[tuple[int, list[str]]] = []
    section = ""
    for i, ln in enumerate(text.splitlines()):
        s = ln.strip()
        if s.startswith("[") and s.endswith("]"):
            section = s[1:-1].strip().upper()
            continue
        if section != "LID_USAGE" or not s or s.startswith(";"):
            continue
        body = s.split(";", 1)[0]
        tokens = re.findall(r'"[^"]*"|\S+', body)
        if len(tokens) >= 4:
            out.append((i, tokens))
    return out


def _own_file(tokens: list[str]) -> str | None:
    if len(tokens) >= 9:
        f = tokens[8].strip('"')
        if f and f != "*":
            return f
    return None


def _default_file(inp_path: Path, n: int, tokens: list[str]) -> Path:
    return report_dir(inp_path) / f"{n:03d}__{_safe(tokens[0])}__{_safe(tokens[1])}.txt"


def with_lid_reports(text: str, inp_path: Path) -> tuple[str, bool]:
    """Return ``text`` with a report file on every LID_USAGE row lacking one."""
    rows = _rows(text)
    if not rows:
        return text, False
    lines = text.splitlines(keepends=True)
    folder = report_dir(inp_path)
    folder.mkdir(parents=True, exist_ok=True)
    # Stale reports from an earlier run (or units since removed) would mislead.
    for old in folder.glob("*.txt"):
        try:
            old.unlink()
        except OSError:
            pass
    changed = False
    for n, (i, tokens) in enumerate(rows):
        if _own_file(tokens):
            continue
        t = list(tokens[:8])
        while len(t) < 8:
            t.append("0")
        t.append(f'"{_default_file(inp_path, n, tokens)}"')
        end = "\n" if lines[i].endswith("\n") else ""
        lines[i] = " ".join(t) + end
        changed = True
    return "".join(lines), changed


def prepare_run_inp(inp_path: Path) -> Path:
    """The input the engine should run: a hidden copy with LID report files
    added when the model has LID units, otherwise the model itself."""
    from app.services.fs_utils import atomic_write_text

    text = inp_path.read_text(encoding="utf-8", errors="replace")
    body, changed = with_lid_reports(text, inp_path)
    if not changed:
        return inp_path
    target = inp_path.with_name(f".{inp_path.stem}.run.inp")
    atomic_write_text(target, body)
    return target


def reports(inp_path: Path) -> list[dict[str, Any]]:
    """Every LID unit's report text, in [LID_USAGE] order."""
    if not inp_path.is_file():
        return []
    text = inp_path.read_text(encoding="utf-8", errors="replace")
    out: list[dict[str, Any]] = []
    for n, (_i, tokens) in enumerate(_rows(text)):
        own = _own_file(tokens)
        path = Path(own) if own else _default_file(inp_path, n, tokens)
        if own and not path.is_absolute():
            path = inp_path.parent / path
        item: dict[str, Any] = {"subcatchment": tokens[0], "lid": tokens[1], "file": path.name, "text": None, "note": None}
        try:
            size = path.stat().st_size
        except OSError:
            item["note"] = "no report yet: run the model"
            out.append(item)
            continue
        if size > MAX_REPORT_BYTES:
            item["note"] = f"report too large to chart ({size // (1024 * 1024)} MB)"
        else:
            item["text"] = path.read_text(encoding="utf-8", errors="replace")
        out.append(item)
    return out
