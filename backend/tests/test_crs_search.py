from __future__ import annotations

from unittest.mock import patch

import pytest

from app.services import crs_service


def test_search_exact_epsg_code() -> None:
    r = crs_service.search("2272", online=False)
    assert r["query"] == "2272"
    assert r["hits"]
    assert r["hits"][0]["auth_code"] == "EPSG:2272"
    assert "Pennsylvania" in r["hits"][0]["name"]
    assert r["hits"][0]["source"] == "local"
    assert r["hits"][0].get("proj4")


def test_search_epsg_prefixed() -> None:
    r = crs_service.search("EPSG:25832", online=False)
    assert r["hits"][0]["auth_code"] == "EPSG:25832"


def test_search_by_name() -> None:
    r = crs_service.search("pennsylvania south", online=False, limit=10)
    codes = [h["auth_code"] for h in r["hits"]]
    assert "EPSG:2272" in codes


def test_presets() -> None:
    presets = crs_service.presets()
    codes = {p["auth_code"] for p in presets}
    assert "EPSG:25832" in codes
    assert "EPSG:2272" in codes
    assert "EPSG:4326" in codes


def test_online_merge_prefers_local_proj4() -> None:
    fake_online = [
        {
            "auth_code": "EPSG:2272",
            "name": "Online PA South",
            "area_of_use": "USA",
            "proj4": None,
            "source": "epsg.io",
        },
        {
            "auth_code": "EPSG:999999",
            "name": "Fake Online Only",
            "area_of_use": None,
            "proj4": None,
            "source": "epsg.io",
        },
    ]
    with patch.object(crs_service, "search_online", return_value=(fake_online, None)):
        r = crs_service.search("2272", online=True, limit=10)
    assert r["online"] is True
    assert r["warning"] is None
    by = {h["auth_code"]: h for h in r["hits"]}
    assert by["EPSG:2272"]["source"] == "local"
    assert by["EPSG:2272"].get("proj4")
    assert "EPSG:999999" in by
    assert by["EPSG:999999"]["source"] == "epsg.io"


def test_online_failure_returns_local_with_warning() -> None:
    with patch.object(
        crs_service,
        "search_online",
        return_value=([], "Online CRS search timed out"),
    ):
        r = crs_service.search("2272", online=True)
    assert r["hits"]
    assert r["hits"][0]["auth_code"] == "EPSG:2272"
    assert r["warning"] == "Online CRS search timed out"


def test_api_search_and_presets() -> None:
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from app.main import app

    tc = TestClient(app)
    res = tc.get("/api/crs/search", params={"q": "2272"})
    assert res.status_code == 200
    body = res.json()
    assert body["hits"][0]["auth_code"] == "EPSG:2272"
    res2 = tc.get("/api/crs/presets")
    assert res2.status_code == 200
    assert len(res2.json()["presets"]) >= 3
