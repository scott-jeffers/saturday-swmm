"""Local API guards and the run registry."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.models.schemas import RunStatus, RunStatusResponse

H = {"X-Saturday-SWMM": "1"}


def client(host: str = "127.0.0.1:8000") -> TestClient:
    return TestClient(app, base_url=f"http://{host}")


def test_foreign_host_rejected():
    r = client("evil.example.com").get("/api/health")
    assert r.status_code == 400


def test_localhost_hosts_allowed():
    for host in ("127.0.0.1:8000", "localhost:5280", "[::1]:8000"):
        assert client(host).get("/api/app").status_code == 200, host


def test_mutation_without_client_header_rejected():
    r = client().post("/api/engine/update")
    assert r.status_code == 403
    r = client().post("/api/runs")
    assert r.status_code == 403


def test_reads_do_not_need_header():
    assert client().get("/api/health").status_code == 200


def test_app_info_lists_engines():
    data = client().get("/api/app").json()
    ids = [e["id"] for e in data["engines"]]
    assert ids[:2] == ["openswmm", "pyswmm"]
    assert data["version"]


def test_model_edits_blocked_while_running(monkeypatch):
    from app.api import runs

    fake = RunStatusResponse(status=RunStatus.running, message="x")
    monkeypatch.setattr(runs.pyswmm_run_service, "status", lambda: fake)
    assert runs.running_engine() == "pyswmm"
    r = client().put("/api/inp", json={"text": ""}, headers=H)
    assert r.status_code == 409
    assert "pyswmm" in r.json()["detail"]
    # starting a second run is refused too
    r = client().post("/api/runs", json={}, headers=H)
    assert r.status_code == 409
    # status reports the running engine
    st = client().get("/api/runs/current").json()
    assert st["engine"] == "pyswmm" and st["status"] == "running"


def test_examples_are_discovered_from_the_install():
    data = client().get("/api/app/examples").json()
    names = [e["name"] for e in data]
    assert names[0] == "Sample model"
    assert "Bellinge" in names and "Bellinge 2D" in names
