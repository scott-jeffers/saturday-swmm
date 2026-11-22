"""Bundle the backend for the online viewer, where it runs in Pyodide.

    python scripts/build_browser_backend.py

Writes frontend/public/pyodide/:
  backend.zip     backend/app (Python sources only)
  wheels/*.whl    pure-Python wheels Pyodide doesn't ship (FastAPI, Starlette)
  manifest.json   what's in the bundle, a hash of the sources (checked by
                  backend/tests/test_browser_backend.py) and the Pyodide version

Pyodide itself and its own packages (pydantic, anyio, …) load from the
jsDelivr CDN at the pinned version.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "pyodide"
PYODIDE = "0.27.7"
# Pure-Python wheels matching Pyodide 0.27's pydantic 2.10.
WHEELS = ["fastapi==0.115.12", "starlette==0.46.2"]
# Pyodide packages loaded from its CDN before the wheels.
PACKAGES = ["pydantic", "anyio", "sniffio", "idna", "typing-extensions", "micropip"]


def sources_hash() -> str:
    files = sorted(p for p in (ROOT / "backend/app").rglob("*.py") if "__pycache__" not in p.parts)
    h = hashlib.sha256()
    for p in files:
        h.update(str(p.relative_to(ROOT / "backend")).replace("\\", "/").encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in (ROOT / "backend/app").rglob("*.py") if "__pycache__" not in p.parts)
    zpath = OUT / "backend.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            info = zipfile.ZipInfo(str(p.relative_to(ROOT / "backend")).replace("\\", "/"), date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, p.read_bytes())
    wdir = OUT / "wheels"
    if not wdir.is_dir() or "--wheels" in sys.argv:
        shutil.rmtree(wdir, ignore_errors=True)
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, "-m", "pip", "download", "--no-deps", "-q", "-d", tmp, *WHEELS], check=True)
            wdir.mkdir()
            for w in Path(tmp).glob("*.whl"):
                shutil.copy(w, wdir / w.name)
    manifest = {
        "pyodide": PYODIDE,
        "packages": PACKAGES,
        "wheels": sorted(w.name for w in wdir.glob("*.whl")),
        "sources": sources_hash(),
        "bytes": zpath.stat().st_size,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"backend.zip {zpath.stat().st_size // 1024} KB, {len(files)} files; wheels: {', '.join(manifest['wheels'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
