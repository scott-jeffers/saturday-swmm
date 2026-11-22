"""The in-browser backend (app.browser): the same code, dispatched without threads."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

from app.browser import call

ROOT = Path(__file__).resolve().parents[2]
INP = "[OPTIONS]\nFLOW_UNITS CFS\n\n[JUNCTIONS]\n;;Name Elev MaxDepth\nJ1 10 5\nJ2 9 5\n\n[OUTFALLS]\nO1 8 FREE\n\n[CONDUITS]\nC1 J1 J2 100 0.013 0 0\nC2 J2 O1 100 0.013 0 0\n\n[XSECTIONS]\nC1 CIRCULAR 1 0 0 0 1\nC2 CIRCULAR 1 0 0 0 1\n\n[COORDINATES]\nJ1 0 0\nJ2 100 0\nO1 200 0\n"


def _call(method: str, path: str, body: object | None = None, query: str = "") -> tuple[int, object]:
    st, text, ctype = asyncio.run(call(method, path, query, None if body is None else json.dumps(body)))
    return st, json.loads(text) if "json" in ctype else text


def test_edit_undo_through_the_bridge(tmp_path: Path) -> None:
    (tmp_path / "m.inp").write_text(INP, encoding="utf-8")
    st, info = _call("POST", "/api/projects/open", {"path": str(tmp_path)})
    assert st == 200 and info["inp_name"] == "m.inp"
    st, obj = _call("GET", "/api/model/objects/node/J1")
    assert st == 200 and obj["attributes"]["elevation"] == 10
    st, _ = _call("PATCH", "/api/model/objects/node/J1", {"elevation": 12.5})
    assert st == 200
    assert "12.5" in (tmp_path / "m.inp").read_text(encoding="utf-8")
    st, _ = _call("POST", "/api/edits/undo")
    assert st == 200
    st, obj = _call("GET", "/api/model/objects/node/J1")
    assert obj["attributes"]["elevation"] == 10
    st, err = _call("GET", "/api/runs/current")
    assert st == 404  # not served in the browser


def test_bundle_is_current() -> None:
    """frontend/public/pyodide/backend.zip must be rebuilt when the backend changes
    (python scripts/build_browser_backend.py)."""
    manifest = json.loads((ROOT / "frontend/public/pyodide/manifest.json").read_text(encoding="utf-8"))
    files = sorted(p for p in (ROOT / "backend/app").rglob("*.py") if "__pycache__" not in p.parts)
    h = hashlib.sha256()
    for p in files:
        h.update(str(p.relative_to(ROOT / "backend")).replace("\\", "/").encode())
        h.update(p.read_bytes())
    assert manifest["sources"] == h.hexdigest(), "run: python scripts/build_browser_backend.py"
