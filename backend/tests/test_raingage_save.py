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
