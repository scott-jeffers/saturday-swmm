"""Snapshots: save, restore (undoable), auto-snapshot de-duplication."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}


def test_snapshot_restore_and_undo(tmp_path: Path):
    from app.main import app
    from app.services.snapshot_service import snapshot_service

    proj = tmp_path / "p"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    inp = proj / "model.inp"
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
    original = inp.read_text()

    snap = c.post("/api/snapshots", json={"label": "Original"}, headers=H).json()
    assert snap["label"] == "Original"
    assert c.patch("/api/model/objects/node/J1", json={"max_depth": 12}, headers=H).status_code == 200
    edited = inp.read_text()
    assert edited != original

    # auto snapshots skip when nothing changed since the latest one
    a1 = snapshot_service.create(auto=True)
    a2 = snapshot_service.create(auto=True)
    assert a1["id"] == a2["id"]

    r = c.post(f"/api/snapshots/{snap['id']}/restore", headers=H)
    assert r.status_code == 200
    assert inp.read_text() == original
    assert c.get("/api/edits").json()["undo"][0].startswith("Restore snapshot")
    assert c.post("/api/edits/undo", headers=H).status_code == 200
    assert inp.read_text() == edited

    names = [s["label"] for s in c.get("/api/snapshots").json()["snapshots"]]
    assert "Original" in names
    assert c.get(f"/api/snapshots/{snap['id']}/text").text == original
    assert c.delete(f"/api/snapshots/{snap['id']}", headers=H).status_code == 200
    assert c.get("/api/snapshots/bad/text").status_code == 400
