"""Update center: version comparison and status shape (network mocked)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.services import updates_service as us


def fake_json(url: str, timeout: float = 10.0):
    if "github" in url:
        return {
            "tag_name": "v99.0.0",
            "html_url": "https://example/rel",
            "body": "notes",
            "assets": [
                {"name": "Saturday-SWMM-99.0.0-win64.zip", "browser_download_url": "https://x/z.zip", "size": 1},
                {"name": "Saturday-SWMM-99.0.0-win64.zip.sha256", "browser_download_url": "https://x/z.sha256"},
            ],
        }
    name = url.split("/pypi/")[1].split("/")[0]
    return {"info": {"version": "99.0"}, "releases": {"1.0": [{}], "99.0": [{}], "100.0a1": [{}], "0.5": []}}


def test_status_reports_updates(monkeypatch):
    monkeypatch.setattr(us, "_get_json", fake_json)
    st = us.status(force=True)
    by = {c["id"]: c for c in st["components"]}
    assert set(by) == {"saturday-swmm", "openswmm", "pyswmm", "swmm-toolkit"}
    assert by["saturday-swmm"]["latest"] == "99.0.0" and by["saturday-swmm"]["update_available"]
    # OpenSWMM follows pre-releases; PySWMM doesn't
    assert by["openswmm"]["latest"] == "100.0a1"
    assert by["pyswmm"]["latest"] == "99.0"
    assert st["updates_available"] >= 3


def test_offline_is_reported_not_raised(monkeypatch):
    def boom(*a, **k):
        raise OSError("offline")

    monkeypatch.setattr(us, "_get_json", boom)
    st = us.status(force=True)
    assert all(c["error"] for c in st["components"])
    assert not any(c["update_available"] for c in st["components"])


def test_api_and_guard(monkeypatch):
    monkeypatch.setattr(us, "_get_json", fake_json)
    from app.main import app

    c = TestClient(app, base_url="http://127.0.0.1:8000")
    assert c.get("/api/updates?force=true").status_code == 200
    assert c.post("/api/updates/pyswmm/install").status_code == 403  # needs the app header
    r = c.post("/api/updates/saturday-swmm/install", headers={"X-Saturday-SWMM": "1"})
    assert r.status_code == 400  # source checkout: not a portable install
