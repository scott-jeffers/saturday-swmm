"""Live, field-level inheritance across a three-level scenario tree."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

INP = """[TITLE]
Test

[OPTIONS]
FLOW_UNITS CFS
ROUTING DYNWAVE

[JUNCTIONS]
J1 10 5 0 0 0
J2 9 5 0 0 0

[OUTFALLS]
O1 8 FREE NO

[CONDUITS]
C1 J1 J2 100 0.013 0 0 0 0
C2 J2 O1 100 0.013 0 0 0 0

[XSECTIONS]
C1 CIRCULAR 1 0 0 0 1
C2 CIRCULAR 1 0 0 0 1

[COORDINATES]
J1 0 0
J2 100 0
O1 200 0
"""
H = {"X-Saturday-SWMM": "1"}


def row(path: Path, sec: str, oid: str) -> list[str]:
    text = path.read_text()
    part = text.split(f"[{sec}]")[1].split("[")[0]
    for ln in part.splitlines():
        t = ln.split()
        if t and t[0] == oid:
            return [f"{float(x):g}" if _num(x) else x for x in t]
    return []


def _num(x: str) -> bool:
    try:
        float(x)
        return True
    except ValueError:
        return False


@pytest.fixture()
def tree(tmp_path: Path):
    (tmp_path / "m.inp").write_text(INP, encoding="utf-8")
    c = TestClient(app, headers=H)
    assert c.post("/api/projects/open", json={"path": str(tmp_path)}).status_code == 200
    a = c.post("/api/scenarios", json={"name": "Growth", "parent": "base"}).json()
    ga = next(s for s in a["scenarios"] if s["name"] == "Growth")
    b = c.post("/api/scenarios", json={"name": "Option B", "parent": ga["id"]}).json()
    gb = next(s for s in b["scenarios"] if s["name"] == "Option B")
    return c, tmp_path, ga, gb


def activate(c: TestClient, sid: str) -> None:
    assert c.put("/api/scenarios/active", json={"id": sid}).status_code == 200


def test_base_edits_reach_grandchildren_but_not_overridden_fields(tree) -> None:
    c, root, ga, gb = tree
    # Option B changes C1's roughness.
    activate(c, gb["id"])
    assert c.patch("/api/model/objects/link/C1", json={"roughness": 0.02}).status_code == 200
    # Base fixes C1's length (same row) and changes C2's roughness.
    activate(c, "base")
    assert c.patch("/api/model/objects/link/C1", json={"length": 150}).status_code == 200
    assert c.patch("/api/model/objects/link/C2", json={"roughness": 0.011}).status_code == 200
    b = root / gb["inp"]
    g = root / ga["inp"]
    assert row(g, "CONDUITS", "C1")[3] == "150" and row(g, "CONDUITS", "C2")[4] == "0.011"
    # Grandchild: the length fix arrives, its own roughness stays.
    assert row(b, "CONDUITS", "C1")[3] == "150"
    assert row(b, "CONDUITS", "C1")[4] == "0.02"
    assert row(b, "CONDUITS", "C2")[4] == "0.011"
    inh = c.get(f"/api/scenarios/{gb['id']}/inheritance").json()
    assert [(x["id"], x["key"]) for x in inh["changes"]] == [("C1", "roughness")]
    assert inh["flags"] == []


def test_parent_changing_an_overridden_field_is_flagged_and_reset_relinks(tree) -> None:
    c, root, ga, gb = tree
    activate(c, gb["id"])
    c.patch("/api/model/objects/link/C1", json={"roughness": 0.02})
    activate(c, "base")
    c.patch("/api/model/objects/link/C1", json={"roughness": 0.015})
    inh = c.get(f"/api/scenarios/{gb['id']}/inheritance").json()
    assert inh["flags"][0]["key"] == "roughness" and inh["flags"][0]["parent_new"] == "0.015" and inh["flags"][0]["mine"] == "0.02"
    r = c.post(f"/api/scenarios/{gb['id']}/reset", json={"items": [{"section": "CONDUITS", "id": "C1", "field": 3}]}).json()
    assert r["changes"] == [] and r["flags"] == []
    assert row(root / gb["inp"], "CONDUITS", "C1")[4] == "0.015"
    # Re-linked: the next Base change arrives.
    c.patch("/api/model/objects/link/C1", json={"roughness": 0.012})
    assert row(root / gb["inp"], "CONDUITS", "C1")[4] == "0.012"


def test_added_removed_objects_and_undo(tree) -> None:
    c, root, ga, gb = tree
    activate(c, ga["id"])
    assert c.delete("/api/model/objects/link/C2").status_code == 200
    activate(c, "base")
    c.patch("/api/model/objects/node/J2", json={"max_depth": 7})
    g, b = root / ga["inp"], root / gb["inp"]
    assert row(g, "CONDUITS", "C2") == [] and row(g, "JUNCTIONS", "J2")[2] == "7"
    assert row(b, "CONDUITS", "C2") == [] and row(b, "JUNCTIONS", "J2")[2] == "7"
    # Undo in Base goes down too.
    assert c.post("/api/edits/undo").status_code == 200
    assert row(b, "JUNCTIONS", "J2")[2] == "5"


def test_lock_push_reparent_make_base(tree) -> None:
    c, root, ga, gb = tree
    c.post(f"/api/scenarios/{gb['id']}/lock", json={"locked": True})
    activate(c, gb["id"])
    r = c.patch("/api/model/objects/link/C1", json={"roughness": 0.03})
    assert r.status_code == 423 and "locked" in r.json()["detail"]["message"]
    activate(c, "base")
    c.patch("/api/model/objects/link/C2", json={"length": 222})
    b = root / gb["inp"]
    assert row(b, "CONDUITS", "C2")[3] == "100"  # locked: waits
    assert next(s for s in c.get("/api/scenarios").json()["scenarios"] if s["id"] == gb["id"])["behind"] > 0
    c.post(f"/api/scenarios/{gb['id']}/lock", json={"locked": False})
    assert row(b, "CONDUITS", "C2")[3] == "222"  # unlocked: catches up
    # Push a change from Option B up to Growth.
    activate(c, gb["id"])
    c.patch("/api/model/objects/link/C1", json={"roughness": 0.025})
    c.post(f"/api/scenarios/{gb['id']}/push", json={"items": [{"section": "CONDUITS", "id": "C1", "field": 3}]})
    assert row(root / ga["inp"], "CONDUITS", "C1")[4] == "0.025"
    assert c.get(f"/api/scenarios/{gb['id']}/inheritance").json()["changes"] == []
    # Reparent Option B under Base: its own change moves with it, the rest now comes from Base.
    activate(c, gb["id"])
    c.patch("/api/model/objects/link/C2", json={"length": 333})
    c.post(f"/api/scenarios/{gb['id']}/reparent", json={"parent": "base"})
    assert [x["key"] for x in c.get(f"/api/scenarios/{gb['id']}/inheritance").json()["changes"]] == ["length"]
    assert row(b, "CONDUITS", "C1")[4] == row(root / "m.inp", "CONDUITS", "C1")[4]
    assert row(b, "CONDUITS", "C2")[3] == "333"
    # Make Growth the Base: Option B (now under Base) picks up Growth's roughness.
    c.post(f"/api/scenarios/{ga['id']}/make-base")
    assert row(root / "m.inp", "CONDUITS", "C1")[4] == "0.025"
    assert row(b, "CONDUITS", "C1")[4] == "0.025" and row(b, "CONDUITS", "C2")[3] == "333"


def test_external_edit_to_base_is_picked_up(tree) -> None:
    c, root, ga, gb = tree
    p = root / "m.inp"
    p.write_text(p.read_text().replace("J1 10 5 0 0 0", "J1 11 5 0 0 0"))
    c.get("/api/scenarios")
    assert row(root / gb["inp"], "JUNCTIONS", "J1")[1] == "11"


def test_rename_in_parent_keeps_child_change(tree) -> None:
    c, root, ga, gb = tree
    activate(c, ga["id"])
    c.patch("/api/model/objects/link/C1", json={"roughness": 0.02})
    base = root / "m.inp"
    base.write_text(base.read_text().replace("C1 J1 J2", "PIPE1 J1 J2").replace("C1 CIRCULAR", "PIPE1 CIRCULAR"))
    c.get("/api/scenarios")
    g = root / ga["inp"]
    assert row(g, "CONDUITS", "PIPE1")[4] == "0.02" and row(g, "CONDUITS", "C1") == []


def test_removed_elements_have_ghost_shapes(tree) -> None:
    c, root, ga, gb = tree
    activate(c, ga["id"])
    assert c.delete("/api/model/objects/link/C2").status_code == 200
    fc = c.get(f"/api/scenarios/{ga['id']}/removed-geojson").json()
    assert [f["properties"]["id"] for f in fc["features"]] == ["C2"]
