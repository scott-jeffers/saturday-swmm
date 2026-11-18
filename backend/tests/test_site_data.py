"""US site data: live 3DEP / NLCD downloads (skipped offline) and SSURGO → infiltration from a fixture."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}
LIVE = os.environ.get("SATURDAY_LIVE_TESTS") == "1"


def _open(tmp_path: Path):
    from app.main import app

    proj = tmp_path / "p"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "model.inp")
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
    assert c.put("/api/projects/crs", json={"crs": "EPSG:2272"}, headers=H).status_code == 200
    return c, proj


def test_hsg_and_params():
    from app.services.site_data_service import hsg_letter, infiltration_params, parse_sda

    assert hsg_letter("B/D") == "D" and hsg_letter("a") == "A" and hsg_letter(None) is None
    p = infiltration_params("B", 1.0, "GREEN_AMPT", us=False)
    assert p["suction"] == pytest.approx(3.5 * 25.4) and p["ksat"] == pytest.approx(25.4)
    assert infiltration_params("C", None, "CURVE_NUMBER", us=True)["cn"] == 74
    assert parse_sda({"Table": [["mukey", "hsg"], ["1", "A"]]}) == [{"mukey": "1", "hsg": "A"}]


def test_soils_to_infiltration(tmp_path: Path):
    from pyproj import Transformer

    c, proj = _open(tmp_path)
    # One soil (group C) over the west half of the model, group A over the east half.
    t = Transformer.from_crs("EPSG:2272", "EPSG:4326", always_xy=True)
    ring = lambda x0, x1: [list(t.transform(x, y)) for x, y in ((x0, 236000), (x1, 236000), (x1, 238000), (x0, 238000), (x0, 236000))]
    feats = [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring(2689000, 2690800)]}, "properties": {"mukey": "1", "hsg": "C", "ksat_um_s": 2.0}},
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring(2690800, 2693000)]}, "properties": {"mukey": "2", "hsg": "A", "ksat_um_s": None}},
    ]
    (proj / "site-data").mkdir()
    (proj / "site-data" / "ssurgo_soils.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    s = c.get("/api/site-data/soils").json()
    assert s["method"] == "HORTON"
    by = {r["id"]: r for r in s["subcatchments"]}
    assert by["S1"]["hsg"] == "C" and by["S1"]["covered_pct"] > 99
    r = c.post("/api/site-data/soils/apply", json={}, headers=H)
    assert r.status_code == 200, r.text
    infil = c.get("/api/model/sections/INFILTRATION").json()["rows"]
    s1 = next(x for x in infil if x["values"][0] == "S1")
    assert float(s1["values"][1]) == pytest.approx(3.0)  # Horton max rate, group C, in/hr
    assert c.get("/api/edits").json()["undo"][0].startswith("Set infiltration from SSURGO")


@pytest.mark.skipif(not LIVE, reason="set SATURDAY_LIVE_TESTS=1 to call USGS and MRLC")
def test_live_dem_and_impervious(tmp_path: Path):
    c, proj = _open(tmp_path)
    r = c.post("/api/site-data/dem", json={"resolution_m": 10}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["vertical_unit"] == "ft" and (proj / r.json()["file"]).is_file()
    r = c.post("/api/site-data/impervious", headers=H)
    assert r.status_code == 200, r.text
    rows = r.json()["subcatchments"]
    assert rows and all(0 <= x["nlcd"] <= 100 for x in rows)
    r = c.post("/api/site-data/impervious/apply", json={"ids": [rows[0]["id"]]}, headers=H)
    assert r.status_code == 200 and r.json()["changed"] == [rows[0]["id"]]
