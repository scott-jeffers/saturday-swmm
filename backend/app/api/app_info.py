"""App version, available engines, and the release update check."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

from fastapi import APIRouter

from app.version import APP_VERSION, DISTRIBUTION, RELEASES_REPO

router = APIRouter(prefix="/api/app", tags=["app"])

_CACHE: dict[str, Any] = {"at": 0.0, "data": None}
_CACHE_S = 3600.0


def _parse(v: str):
    from packaging.version import InvalidVersion, Version

    try:
        return Version(v.lstrip("vV"))
    except InvalidVersion:
        return None


def engines() -> list[dict[str, Any]]:
    """Engines this backend can run, with availability for the UI selector."""
    from app.services.health_service import _openswmm_info
    from app.services.pyswmm_run_service import pyswmm_info

    o = _openswmm_info()
    p = pyswmm_info()
    hybrid_note = None
    try:
        from app.services.hybrid.capabilities import probe_hybrid_capabilities

        caps = probe_hybrid_capabilities()
        hybrid_note = caps.get("summary") or caps.get("message")
    except Exception as exc:  # pragma: no cover - optional engine
        hybrid_note = str(exc)
    return [
        {
            "id": "openswmm",
            "label": "OpenSWMM 6",
            "description": "1D + 2D overland (default)",
            "available": bool(o.get("import_ok")),
            "version": o.get("version"),
            "error": o.get("error"),
        },
        {
            "id": "pyswmm",
            "label": "EPA SWMM 5 (PySWMM)",
            "description": "Reference EPA SWMM 5.2 engine, 1D only",
            "available": bool(p.get("installed")),
            "version": p.get("swmm_version") or p.get("version"),
            "error": p.get("error"),
        },
        {
            "id": "hybrid",
            "label": "Hybrid 1D/2D",
            "description": "EPA SWMM 5 pipes + Basilisk 2D surface",
            "available": bool(p.get("installed")),
            "version": p.get("version"),
            "error": None if p.get("installed") else "Needs PySWMM",
            "note": hybrid_note,
        },
        {
            "id": "flow_accum",
            "label": "Flow accumulation",
            "description": "DEM-only overland flow paths (no SWMM run)",
            "available": True,
            "version": None,
            "error": None,
        },
    ]


def _launched() -> bool:
    from app import launcher

    return launcher._server is not None


@router.get("")
def app_info() -> dict[str, Any]:
    return {
        "name": "Saturday-SWMM",
        "version": APP_VERSION,
        "distribution": DISTRIBUTION,
        "releases_url": f"https://github.com/{RELEASES_REPO}/releases",
        "can_quit": _launched(),
        "engines": engines(),
    }


@router.post("/shutdown")
def shutdown() -> dict[str, Any]:
    """Stop the app (only when started by the launcher, e.g. the portable build)."""
    from app import launcher

    return {"ok": launcher.request_shutdown()}


@router.get("/update-check")
def update_check(force: bool = False) -> dict[str, Any]:
    """Compare this version with the latest GitHub release (cached 1 h)."""
    now = time.time()
    data = _CACHE["data"]
    if force or data is None or now - _CACHE["at"] > _CACHE_S:
        url = f"https://api.github.com/repos/{RELEASES_REPO}/releases/latest"
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"Saturday-SWMM/{APP_VERSION}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=6) as resp:
                rel = json.loads(resp.read().decode("utf-8"))
            data = {
                "ok": True,
                "latest": str(rel.get("tag_name") or "").lstrip("vV") or None,
                "url": rel.get("html_url"),
                "published_at": rel.get("published_at"),
                "notes": (rel.get("body") or "")[:4000],
                "error": None,
            }
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            data = {"ok": False, "latest": None, "url": None, "notes": "", "error": str(exc)}
        _CACHE.update(at=now, data=data)

    cur, lat = _parse(APP_VERSION), _parse(data.get("latest") or "")
    return {
        **data,
        "current": APP_VERSION,
        "update_available": bool(cur and lat and lat > cur),
    }
