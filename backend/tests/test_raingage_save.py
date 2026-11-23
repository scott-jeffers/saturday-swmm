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
S2 RG1 J1 1 25 100 0.5 0

[JUNCTIONS]
J1 10 5

[TIMESERIES]
TS1 0:00 0.1
TS2 0:00 0.2

[SYMBOLS]
RG1 5 5
"""
H = {"X-Saturday-SWMM": "1"}


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    (tmp_path / "m.inp").write_text(INP, encoding="utf-8")
    (tmp_path / "storm.dat").write_text(";rain\nSTA9 2024 6 1 0 0 0.1\n", encoding="utf-8")
    c = TestClient(app, headers=H)
    assert c.post("/api/projects/open", json={"path": str(tmp_path)}).status_code == 200
    return c


def gages(c: TestClient) -> dict[str, dict]:
    return {g["name"]: g for g in c.get("/api/model/raingages").json()}


def test_change_source_and_timing(client: TestClient) -> None:
    r = client.put("/api/model/raingages/RG1", json={"format": "VOLUME", "interval": "0:15", "source": "FILE", "filename": "storm.dat", "units": "MM"})
    assert r.status_code == 200, r.text
    g = gages(client)["RG1"]
    assert (g["format"], g["interval"], g["source"], g["filename"], g["station"], g["units"]) == ("VOLUME", "0:15", "FILE", "storm.dat", "STA9", "MM")
    r = client.put("/api/model/raingages/RG1", json={"source": "TIMESERIES", "timeseries": "TS2"})
    assert gages(client)["RG1"]["timeseries"] == "TS2"


def test_add_and_rename(client: TestClient, tmp_path: Path) -> None:
    assert client.put("/api/model/raingages/RG2", json={"timeseries": "TS1"}).json()["created"] is True
    assert client.put("/api/model/raingages/RG1", json={"new_name": "RG2", "timeseries": "TS1"}).status_code == 409
    r = client.put("/api/model/raingages/RG1", json={"new_name": "Roof", "timeseries": "TS1"}).json()
    assert r["subcatchments_renamed"] == 2
    g = gages(client)
    assert "RG1" not in g and g["Roof"]["subcatchments"] == 2
    text = (tmp_path / "m.inp").read_text()
    assert "\nRoof 5 5" in text or "Roof" in text.split("[SYMBOLS]")[1]
    # undo puts it back
    assert client.post("/api/edits/undo").status_code == 200
    assert "RG1" in gages(client)


def test_rejects_bad_input(client: TestClient) -> None:
    assert client.put("/api/model/raingages/RG1", json={"source": "TIMESERIES"}).status_code == 400
    assert client.put("/api/model/raingages/RG1", json={"interval": "soon", "timeseries": "TS1"}).status_code == 400
    assert client.put("/api/model/raingages/RG1", json={"new_name": "two words", "timeseries": "TS1"}).status_code == 400


def test_new_elements_use_model_units(tmp_path: Path) -> None:
    """A metre map under a US model: lengths in ft, areas in acres, 12 in pipes."""
    (tmp_path / "m.inp").write_text("[OPTIONS]\nFLOW_UNITS CFS\n\n[RAINGAGES]\nRG1 INTENSITY 0:05 1.0 TIMESERIES T\n", encoding="utf-8")
    c = TestClient(app, headers=H)
    assert c.post("/api/projects/open", json={"path": str(tmp_path)}).status_code == 200
    assert c.put("/api/projects/crs", json={"crs": "EPSG:25832"}).status_code == 200
    for i, x in enumerate((500000, 500100)):
        assert c.post("/api/model/objects/node", json={"node_kind": "junction", "x": x, "y": 6000000, "id": f"J{i}"}).status_code == 200
    link = c.post("/api/model/objects/link", json={"from_node": "J0", "to_node": "J1"}).json()
    text = (tmp_path / "m.inp").read_text()
    row = next(ln for ln in text.splitlines() if ln.startswith(link["id"]) and "J0" in ln)
    assert abs(float(row.split()[3]) - 328.084) < 0.1
    assert "CIRCULAR     1.0" in text
    sub = c.post("/api/model/objects/subcatchment", json={"outlet": "J0", "polygon": [[500000, 6000000], [500100, 6000000], [500100, 6000100], [500000, 6000100]]})
    assert sub.status_code == 200, sub.text
    srow = next(ln for ln in (tmp_path / "m.inp").read_text().splitlines() if ln.startswith("S1"))
    assert abs(float(srow.split()[3]) - 2.4711) < 0.01  # 1 ha in acres


def test_climate_temperature_keeps_other_lines(tmp_path: Path) -> None:
    (tmp_path / "m.inp").write_text(
        "[OPTIONS]\nFLOW_UNITS CFS\n\n[EVAPORATION]\nCONSTANT 0.1\nRECOVERY P1\n\n[TEMPERATURE]\nTIMESERIES T1\nWINDSPEED MONTHLY 1 1 1 1 1 1 1 1 1 1 1 1\nSNOWMELT 34 0.5 0.6 100 50 0\n",
        encoding="utf-8",
    )
    (tmp_path / "climate.dat").write_text("x\n", encoding="utf-8")
    c = TestClient(app, headers=H)
    assert c.post("/api/projects/open", json={"path": str(tmp_path)}).status_code == 200
    r = c.post("/api/model/climate-temperature", json={"filename": "climate.dat", "dry_only": True, "latitude": 39.95})
    assert r.status_code == 200, r.text
    text = (tmp_path / "m.inp").read_text()
    temp = text.split("[TEMPERATURE]")[1]
    assert 'FILE "climate.dat"' in temp and "WINDSPEED MONTHLY" in temp and "TIMESERIES" not in temp
    assert "SNOWMELT         34 0.5 0.6 100 39.9500 0" in temp
    evap = text.split("[EVAPORATION]")[1].split("[")[0]
    assert "TEMPERATURE" in evap and "RECOVERY P1" in evap and "DRY_ONLY         YES" in evap and "CONSTANT" not in evap
