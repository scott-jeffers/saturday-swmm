"""Every model edit can be undone and redone, whatever endpoint made it."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}


def test_undo_redo_across_kinds_of_edit(tmp_path: Path):
    from app.main import app

    proj = tmp_path / "p"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    inp = proj / "model.inp"
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
    original = inp.read_text()
    assert c.get("/api/edits").json() == {"undo": [], "redo": []}

    # 1. inspector edit
    assert c.patch("/api/model/objects/node/J1", json={"max_depth": 12}, headers=H).status_code == 200
    # 2. section table edit
    sec = c.get("/api/model/sections/CURVES").json()
    assert c.put("/api/model/sections/CURVES", json={"rows": [*sec["rows"], {"values": ["C1", "STORAGE", "0", "10"], "comment": ""}]}, headers=H).status_code == 200
    # 3. delete with cascade
    assert c.delete("/api/model/objects/link/C7", params={"cascade": "true"}, headers=H).status_code == 200
    edited = inp.read_text()
    st = c.get("/api/edits").json()
    assert st["undo"][0] == "Delete link C7" and len(st["undo"]) == 3

    for _ in range(3):
        assert c.post("/api/edits/undo", headers=H).status_code == 200
    assert inp.read_text() == original
    assert c.post("/api/edits/undo", headers=H).status_code == 400
    for _ in range(3):
        assert c.post("/api/edits/redo", headers=H).status_code == 200
    assert inp.read_text() == edited
    # the model the app serves follows the file
    assert c.get("/api/model/objects/link/C7").status_code == 404

    # a new edit clears redo
    c.post("/api/edits/undo", headers=H)
    c.patch("/api/model/objects/node/J2", json={"max_depth": 9}, headers=H)
    assert c.get("/api/edits").json()["redo"] == []

    # outside change: history refuses rather than overwriting it
    inp.write_text(inp.read_text() + "\n")
    r = c.post("/api/edits/undo", headers=H)
    assert r.status_code == 409


def test_bulk_edits_are_one_step(tmp_path: Path):
    from app.main import app

    proj = tmp_path / "p"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
    items = [{"object_type": "node", "id": n, "patch": {"max_depth": 11}} for n in ("J1", "J2", "J3")]
    r = c.post("/api/model/objects/bulk-patch", json={"items": items}, headers=H).json()
    assert r["changed"] == ["J1", "J2", "J3"]
    r = c.post("/api/model/objects/bulk-delete", json={"items": [{"object_type": "link", "id": "C1"}, {"object_type": "node", "id": "J7"}]}, headers=H).json()
    assert {d["id"] for d in r["deleted"]} == {"C1", "J7"}
    assert c.get("/api/edits").json()["undo"][:2] == ["Delete 2 objects", "Change max depth of 3 nodes"]
    c.post("/api/edits/undo", headers=H)
    assert c.get("/api/model/objects/node/J7").status_code == 200
