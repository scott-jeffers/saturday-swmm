"""End-to-end check of a built portable folder (run with its bundled python).

Starts the packaged app, opens a copy of the sample model, runs it with
OpenSWMM and EPA SWMM 5, checks both finish, then stops the app.
Usage: python\\python.exe smoke_test.py <portable-folder>
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PORT = 8799
BASE = f"http://127.0.0.1:{PORT}"
HDR = {"X-Saturday-SWMM": "1", "Content-Type": "application/json"}


def call(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    py = root / "python" / "python.exe"
    proc = subprocess.Popen([str(py), "-m", "app.launcher", "--no-browser", "--port", str(PORT)], cwd=root)
    try:
        for _ in range(120):
            try:
                info = call("GET", "/api/app")
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise SystemExit("server did not start")
        print("app", info["version"], [(e["id"], e["available"]) for e in info["engines"]])
        assert all(e["available"] for e in info["engines"][:2]), "an engine is unavailable"
        with urllib.request.urlopen(BASE + "/", timeout=10) as r:
            assert b"<div id=\"root\">" in r.read(), "UI not served"
        names = [e["name"] for e in call("GET", "/api/app/examples")]
        assert "Sample model" in names and "Bellinge" in names, names

        work = Path(tempfile.mkdtemp())
        shutil.copy(root / "examples" / "sample.inp", work / "sample.inp")
        call("POST", "/api/projects/open", {"path": str(work)})
        for engine in ("openswmm", "pyswmm"):
            call("POST", "/api/runs", {"simulation_engine": engine})
            for _ in range(240):
                st = call("GET", "/api/runs/current")
                if st["status"] != "running":
                    break
                time.sleep(0.5)
            print(engine, st["status"], st.get("message"))
            assert st.get("engine") == engine, f"status is from {st.get('engine')}, expected {engine}"
            assert st["status"] == "completed", st.get("error")
            meta = call("GET", "/api/out/metadata")
            assert meta, "no results"
        print("smoke test passed")
        return 0
    finally:
        try:
            call("POST", "/api/app/shutdown")
        except Exception:
            pass
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
