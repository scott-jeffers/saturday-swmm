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


def test_update_all_orders_engines_and_keeps_going_after_a_failure(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(us, "_get_json", fake_json)
    done: list[str] = []

    def fake_install(pid, version=None):
        done.append(pid)
        if pid == "pyswmm":
            raise HTTPException(status_code=500, detail="didn't start; went back to 2.2.0")
        return {"message": f"{pid} updated"}

    monkeypatch.setattr(us, "install_package", fake_install)
    monkeypatch.setattr(us, "DISTRIBUTION", "source")
    r = us.update_all()
    assert done == ["openswmm", "pyswmm", "swmm-toolkit"]  # PySWMM before its toolkit
    by = {x["id"]: x for x in r["results"]}
    assert by["openswmm"]["ok"] and by["swmm-toolkit"]["ok"]
    assert not by["pyswmm"]["ok"] and "went back" in by["pyswmm"]["message"]
    # From source the app is not auto-updated: told how instead
    assert not by["saturday-swmm"]["ok"] and "git pull" in by["saturday-swmm"]["message"]
    assert "could not be updated" in r["message"]


def test_no_updates_while_a_run_is_going(monkeypatch):
    import pytest
    from fastapi import HTTPException

    import app.api.runs as runs

    monkeypatch.setattr(runs, "running_engine", lambda: "pyswmm")
    with pytest.raises(HTTPException) as e:
        us.update_all()
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        us.install_package("pyswmm", "9.9")


def test_old_1x_numbers_count_as_0x():
    from app.version import app_version_key

    assert app_version_key("1.3.1") == "0.13.1" and app_version_key("v1.0.0") == "0.10.0"
    assert app_version_key("0.14.0") == "0.14.0"
    assert us._app_newer("0.14.0", "1.3.1")  # an old 1.3.1 install is offered 0.14
    assert not us._app_newer("0.13.0", "1.3.1")
