"""Completed runs are archived per engine/scenario and can be compared."""

from __future__ import annotations

import re
import shutil
import time
from pathlib import Path

from fastapi.testclient import TestClient

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}


def _run(c: TestClient) -> None:
    assert c.post("/api/runs", json={"simulation_engine": "pyswmm"}, headers=H).status_code == 200
    for _ in range(300):
        st = c.get("/api/runs/current").json()
        if st["status"] != "running":
            break
        time.sleep(0.05)
    assert st["status"] == "completed", st
    c.get("/api/runs/current")  # status poll after completion triggers the archive


def test_archive_and_compare(tmp_path: Path):
    from app.main import app

    proj = tmp_path / "proj"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200

    _run(c)
    runs = c.get("/api/runs/archive").json()["runs"]
    assert len(runs) == 1 and runs[0]["engine"] == "pyswmm" and runs[0]["scenario_name"] == "Base"
    first = runs[0]["id"]
    assert (proj / "runs" / first / "model.out").is_file()

    # double the rainfall and run again
    inp = proj / "model.inp"
    text = inp.read_text()
    text = re.sub(r"^(DESIGN_2YR\s+\S+\s+)([\d.]+)", lambda m: f"{m.group(1)}{float(m.group(2)) * 3:.3f}", text, flags=re.M)
    inp.write_text(text)
    _run(c)
    runs = c.get("/api/runs/archive").json()["runs"]
    assert len(runs) == 2
    cmp = c.get("/api/runs/compare", params={"a": first, "b": runs[0]["id"]}).json()
    keys = {s["key"]: s for s in cmp["summary"]}
    assert keys["flood_volume"]["b"] >= keys["flood_volume"]["a"]
    link = next(t for t in cmp["tables"] if t["title"] == "Link Flow Summary")
    assert link["rows"][0]["values"][0]["delta"] > 0

    s = c.get(f"/api/runs/archive/{first}/series/node/J1").json()
    assert len(s["values"]) > 0

    # label, pin, delete; bad ids rejected
    assert c.patch(f"/api/runs/archive/{first}", json={"label": "Existing", "pinned": True}, headers=H).json()["runs"][-1]["label"] == "Existing"
    assert c.delete("/api/runs/archive/..", headers=H).status_code in (400, 404, 405)
    assert c.delete(f"/api/runs/archive/{first}", headers=H).status_code == 200
    assert len(c.get("/api/runs/archive").json()["runs"]) == 1
