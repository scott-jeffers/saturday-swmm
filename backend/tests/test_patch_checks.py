from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

INP = """[OPTIONS]
FLOW_UNITS CFS

[RAINGAGES]
RG1 INTENSITY 0:05 1.0 TIMESERIES TS1

[SUBCATCHMENTS]
S1 RG1 J1 1 25 100 0.5 0

[JUNCTIONS]
J1 10 5 0 0 0
J2 9 5 0 0 0

[OUTFALLS]
O1 8 FREE

[CONDUITS]
C1 J1 J2 100 0.013 0 0 0 0

[XSECTIONS]
C1 CIRCULAR 1 0 0 0 1
"""
H = {"X-Saturday-SWMM": "1"}


@pytest.fixture()
def c(tmp_path: Path) -> TestClient:
    (tmp_path / "m.inp").write_text(INP, encoding="utf-8")
    cl = TestClient(app, headers=H)
    assert cl.post("/api/projects/open", json={"path": str(tmp_path)}).status_code == 200
    return cl


@pytest.mark.parametrize(
    "kind,oid,patch,field,words",
    [
        ("link", "C1", {"length": 0}, "length", "more than 0"),
        ("link", "C1", {"roughness": -1}, "roughness", "Manning"),
        ("link", "C1", {"to_node": "J9"}, "to_node", "isn't a node"),
        ("link", "C1", {"to_node": "J1"}, "to_node", "starts and ends"),
        ("subcatchment", "S1", {"pct_imperv": 120}, "pct_imperv", "100"),
        ("subcatchment", "S1", {"outlet": "X"}, "outlet", "isn't a node or subcatchment"),
        ("subcatchment", "S1", {"raingage": "RG9"}, "raingage", "isn't in the model"),
        ("node", "J1", {"init_depth": 3}, "init_depth", "error 138"),
    ],
)
def test_bad_values_say_which_field_and_how_to_fix(c: TestClient, kind, oid, patch, field, words) -> None:
    if kind == "node" and field == "init_depth":
        assert c.patch("/api/model/objects/node/J1", json={"max_depth": 2}).status_code == 200
    r = c.patch(f"/api/model/objects/{kind}/{oid}", json=patch)
    assert r.status_code == 422, r.text
    d = r.json()["detail"]
    assert d["field"] == field and words in d["message"] and d["fix"]


def test_good_values_still_save(c: TestClient) -> None:
    assert c.patch("/api/model/objects/link/C1", json={"length": 120, "roughness": 0.012}).status_code == 200
    assert c.patch("/api/model/objects/subcatchment/S1", json={"outlet": "J2", "pct_imperv": 60}).status_code == 200
