"""Scenarios: each a full SWMM file; diff and three-way update from parent."""

from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from app.services.scenario_service import diff_inp, merge_from_parent

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}


def _client():
    from app.main import app

    return TestClient(app, base_url="http://127.0.0.1:8000")


def test_merge_takes_parent_changes_keeps_child_edits():
    base = "[JUNCTIONS]\nJ1 10 5 0 0 0\nJ2 9 5 0 0 0\n[CONDUITS]\nC1 J1 J2 100 0.013 0 0\n"
    parent = "[JUNCTIONS]\nJ1 10 6 0 0 0\nJ2 9 5 0 0 0\nJ3 8 5 0 0 0\n[CONDUITS]\nC1 J1 J2 100 0.013 0 0\n"
    child = "[JUNCTIONS]\nJ1 10 5 0 0 0\nJ2 9 7 0 0 0\n[CONDUITS]\nC1 J1 J2 100 0.015 0 0\n"
    merged, applied, conflicts = merge_from_parent(base, parent, child)
    assert "J1 10 6 0 0 0" in merged          # parent change, child untouched -> taken
    assert "J2 9 7 0 0 0" in merged           # child edit kept
    assert "J3 8 5 0 0 0" in merged           # parent addition taken
    assert "C1 J1 J2 100 0.015 0 0" in merged # child edit kept
    assert {(a["id"], a["change"]) for a in applied} == {("J1", "modified"), ("J3", "added")}
    assert conflicts == []


def test_merge_reports_conflicts():
    base = "[JUNCTIONS]\nJ1 10 5 0 0 0\n"
    parent = "[JUNCTIONS]\nJ1 10 6 0 0 0\n"
    child = "[JUNCTIONS]\nJ1 10 7 0 0 0\n"
    merged, applied, conflicts = merge_from_parent(base, parent, child)
    assert "J1 10 7 0 0 0" in merged and conflicts == [{"section": "JUNCTIONS", "id": "J1"}]


def test_diff_ignores_spacing():
    assert diff_inp("[JUNCTIONS]\nJ1  10 5\n", "[JUNCTIONS]\nJ1 10    5\n") == []


def test_scenario_lifecycle(tmp_path: Path):
    proj = tmp_path / "proj"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    (proj / "rain.dat").write_text("RG1 2024 6 1 0 0 0.1\n")
    txt = (proj / "model.inp").read_text().replace("TIMESERIES DESIGN_2YR", 'FILE "rain.dat" RG1 IN')
    (proj / "model.inp").write_text(txt)
    c = _client()
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200

    r = c.post("/api/scenarios", json={"name": "Bigger trunk"}, headers=H)
    assert r.status_code == 200, r.text
    data = r.json()
    child = next(s for s in data["scenarios"] if s["name"] == "Bigger trunk")
    assert data["active"] == child["id"] and child["parent"] == "base"
    child_inp = proj / child["inp"]
    assert child_inp.is_file() and "scenarios" in child["inp"]
    # file reference still points at the project's rain file
    assert '"../../rain.dat"' in child_inp.read_text()

    # edits now go to the child; Base is untouched
    info = c.get("/api/projects/current").json()
    assert info["scenario_name"] == "Bigger trunk" and info["inp_path"] == str(child_inp)
    r = c.patch("/api/model/objects/link/C3", json={"geom1": 2.0}, headers=H)
    assert r.status_code == 200, r.text
    assert "C3" not in [x["id"] for x in c.get(f"/api/scenarios/base/diff").json()["vs_parent"]]
    d = c.get(f"/api/scenarios/{child['id']}/diff").json()
    assert {"section": "XSECTIONS", "id": "C3", "change": "modified"} in d["vs_parent"]
    cmp = c.get("/api/scenarios/compare", params={"a": "base", "b": child["id"]}).json()["changes"]
    x = next(ch for ch in cmp if ch["section"] == "XSECTIONS" and ch["id"] == "C3")
    assert x["object"] == "link" and x["a"] and x["b"] and x["a"] != x["b"]

    # change the parent: the child takes it on its own (no sync step)
    c.put("/api/scenarios/active", json={"id": "base"}, headers=H)
    c.patch("/api/model/objects/node/J1", json={"max_depth": 9}, headers=H)
    t = child_inp.read_text()
    j1 = [l.split() for l in t.splitlines() if l.startswith("J1 ")]
    assert j1 and float(j1[0][2]) == 9, j1
    assert any(l.split()[:2] == ["C3", "CIRCULAR"] and float(l.split()[2]) == 2 for l in t.splitlines())

    # a child scenario is a normal SWMM model: EPA SWMM runs it
    import pytest

    pyswmm = pytest.importorskip("pyswmm")
    with pyswmm.Simulation(str(child_inp)) as sim:
        for _ in sim:
            pass

    # delete moves it to scenarios/.deleted and returns to the parent
    r = c.delete(f"/api/scenarios/{child['id']}", headers=H).json()
    assert r["active"] == "base" and len(r["scenarios"]) == 1
    assert any((proj / "scenarios" / ".deleted").iterdir())
