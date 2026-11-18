import shutil
from pathlib import Path

from fastapi.testclient import TestClient

SAMPLE = Path(__file__).resolve().parents[2] / "examples" / "sample.inp"
H = {"X-Saturday-SWMM": "1"}


def _open(tmp_path: Path) -> TestClient:
    from app.main import app

    proj = tmp_path / "p"
    proj.mkdir()
    shutil.copy(SAMPLE, proj / "p.inp")
    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.post("/api/projects/open", json={"path": str(proj)}, headers=H).status_code == 200
    return c


def test_sections_roundtrip_and_new_section(tmp_path):
    c = _open(tmp_path)
    secs = {s["name"].upper(): s for s in c.get("/api/model/sections").json()["sections"]}
    assert secs["JUNCTIONS"]["rows"] == 7
    t = c.get("/api/model/sections/TIMESERIES").json()
    assert t["columns"][0] == "Name" and len(t["rows"]) == 25
    # add a curve section that didn't exist
    r = c.put("/api/model/sections/CURVES", json={"rows": [
        {"values": ["PUMP1", "Pump2", "0", "0"]}, {"values": ["PUMP1", "", "5", "1.5"]}]}, headers=H)
    assert r.status_code == 200, r.text
    text = (tmp_path / "p" / "p.inp").read_text()
    assert "[CURVES]" in text and text.index("[CURVES]") < text.index("[MAP]")
    # quoted values survive
    r = c.put("/api/model/sections/TAGS", json={"rows": [{"values": ["Node", "J1", "has space"]}]}, headers=H)
    assert r.json()["rows"][0]["values"] == ["Node", "J1", "has space"]


def test_options(tmp_path):
    c = _open(tmp_path)
    o = c.get("/api/model/options").json()
    general = {x["key"]: x for x in o["groups"][0]["options"]}
    assert general["FLOW_ROUTING"]["value"] == "DYNWAVE" and "KINWAVE" in general["FLOW_ROUTING"]["choices"]
    r = c.put("/api/model/options", json={"values": {"FLOW_ROUTING": "KINWAVE", "SURCHARGE_METHOD": "SLOT"}}, headers=H).json()
    vals = {x["key"]: x["value"] for g in r["groups"] for x in g["options"]}
    assert vals["FLOW_ROUTING"] == "KINWAVE" and vals["SURCHARGE_METHOD"] == "SLOT"


def test_check_finds_problems(tmp_path):
    c = _open(tmp_path)
    assert c.get("/api/model/check").json()["errors"] == 0
    p = tmp_path / "p" / "p.inp"
    import re

    t = re.sub(r"^(C7\s+J7\s+)J3", r"\1JX", p.read_text(), flags=re.M)
    t = re.sub(r"^(C3\s+CIRCULAR)", r";\1", t, flags=re.M)
    p.write_text(t)
    r = c.get("/api/model/check").json()
    msgs = " ".join(i["message"] for i in r["issues"])
    assert "refers to node JX" in msgs and "C3 has no cross-section" in msgs
    assert r["errors"] >= 2
