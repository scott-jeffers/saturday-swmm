"""Network tools: reverse, lengths, interpolate, split, merge — each one undo step."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}


def _open(tmp_path: Path):
    from app.main import app

    proj = tmp_path / "p"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
    return c, proj / "model.inp"


def _link(c, lid):
    return c.get(f"/api/model/objects/link/{lid}").json()["attributes"]


def _node(c, nid):
    return c.get(f"/api/model/objects/node/{nid}").json()["attributes"]


def test_reverse_and_undo(tmp_path: Path):
    c, inp = _open(tmp_path)
    before = inp.read_text()
    a = _link(c, "C1")
    r = c.post("/api/model/tools/reverse", json={"links": ["C1"]}, headers=H)
    assert r.status_code == 200, r.text
    b = _link(c, "C1")
    assert (b["from_node"], b["to_node"]) == (a["to_node"], a["from_node"])
    assert c.get("/api/edits").json()["undo"][0] == "Reverse C1"
    c.post("/api/edits/undo", headers=H)
    assert inp.read_text() == before


def test_lengths_split_merge_interpolate(tmp_path: Path):
    c, inp = _open(tmp_path)
    r = c.post("/api/model/tools/lengths", json={"links": ["C1"]}, headers=H).json()
    assert r["changed"] and r["changed"][0]["new"] > 0
    L = float(_link(c, "C1")["length"])

    s = c.post("/api/model/tools/split", json={"link": "C1", "fraction": 0.5}, headers=H)
    assert s.status_code == 200, s.text
    s = s.json()
    nid, (l1, l2) = s["node"], s["links"]
    a1, a2 = _link(c, l1), _link(c, l2)
    assert a1["to_node"] == nid and a2["from_node"] == nid
    assert abs(float(a1["length"]) + float(a2["length"]) - L) < 1e-3
    z_from = float(_node(c, a1["from_node"])["elevation"])
    z_to = float(_node(c, a2["to_node"])["elevation"])
    assert abs(float(_node(c, nid)["elevation"]) - (z_from + z_to) / 2) < 1e-3
    # SWMM still accepts the model
    assert c.get("/api/model/check").json()["errors"] == 0

    # interpolate across the split path: raise the middle node, then grade it back
    c.patch(f"/api/model/objects/node/{nid}", json={"elevation": 500}, headers=H)
    i = c.post("/api/model/tools/interpolate", json={"nodes": [a1["from_node"], nid, a2["to_node"]], "links": [l1, l2]}, headers=H)
    assert i.status_code == 200, i.text
    assert abs(float(_node(c, nid)["elevation"]) - (z_from + z_to) / 2) < 1e-3

    # merge the new node back into the upstream one: the first half disappears
    m = c.post("/api/model/tools/merge", json={"keep": a1["from_node"], "remove": nid}, headers=H).json()
    assert l1 in m["dropped_links"]
    assert _link(c, l2)["from_node"] == a1["from_node"]
    assert c.get(f"/api/model/objects/node/{nid}").status_code == 404


def test_python_console_edits_are_undoable(tmp_path: Path):
    c, inp = _open(tmp_path)
    before = inp.read_text()
    code = "t=open(MODEL_INP).read().replace('0.013','0.015')\nopen(MODEL_INP,'w').write(t)\nprint('ok', MODEL_INP.endswith('model.inp'))"
    r = c.post("/api/scripts/run", json={"code": code}, headers=H).json()
    assert r["exit_code"] == 0 and "ok True" in r["stdout"]
    assert "0.015" in inp.read_text()
    assert c.get("/api/edits").json()["undo"][0] == "Run a Python script"
    c.post("/api/edits/undo", headers=H)
    assert inp.read_text() == before
    r = c.post("/api/scripts/run", json={"code": "raise SystemExit(3)"}, headers=H).json()
    assert r["exit_code"] == 3


def test_rims_from_dem(tmp_path: Path, monkeypatch):
    from app.services import gis_service as gmod

    c, inp = _open(tmp_path)
    # No DEM in the project yet: a clear 404.
    r = c.post("/api/model/tools/rims-from-dem", json={"nodes": ["J1"]}, headers=H)
    assert r.status_code == 404 and "DEM" in r.json()["detail"]

    inv = float(_node(c, "J1")["elevation"])
    inv2 = float(_node(c, "J2")["elevation"])
    # Fake DEM: J1 ground 3 m (≈9.84 ft) above its invert, J2 ground below its invert.
    vals = [(inv + 9.84252) * 0.3048, (inv2 - 1) * 0.3048]
    monkeypatch.setattr(gmod.gis_service, "sample_dem_grid", lambda xs, ys, layer_id=None: vals[: len(xs)])
    r = c.post("/api/model/tools/rims-from-dem", json={"nodes": ["J1", "J2", "OF1"], "dem_unit": "m"}, headers=H)
    assert r.status_code == 200, r.text
    out = r.json()
    assert [x["id"] for x in out["changed"]] == ["J1"]
    assert abs(float(_node(c, "J1")["max_depth"]) - 9.84252) < 1e-2
    reasons = {x["id"]: x["reason"] for x in out["skipped"]}
    assert "below the invert" in reasons["J2"] and "rim" in reasons["OF1"]
    assert c.get("/api/edits").json()["undo"][0] == "Set 1 rim from the DEM"
