"""App version, available engines, and the release update check."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
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
    return [
        {
            "id": "openswmm",
            "label": "OpenSWMM 6",
            "description": "1D + 2D overland (pre-release)",
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


def _examples_dir() -> Path | None:
    here = Path(__file__).resolve()
    # portable: <root>/app/api/app_info.py -> <root>/examples
    # source:   <repo>/backend/app/api/app_info.py -> <repo>/examples
    for cand in (here.parents[2] / "examples", here.parents[3] / "examples"):
        if cand.is_dir():
            return cand
    return None


_EXAMPLE_LABELS = {"Bellinge_SWMM": "Bellinge", "Bellinge-2D": "Bellinge 2D", "LID_Sample": "LID sample", "Drexel_Campus": "Drexel campus (LID)"}


@router.get("/examples")
def examples() -> list[dict[str, Any]]:
    """Example projects shipped with this copy of the app (folders with an .inp)."""
    root = _examples_dir()
    if root is None:
        return []
    out: list[dict[str, Any]] = []
    folders = [root, *sorted(p for p in root.iterdir() if p.is_dir())]
    for folder in folders:
        if not any(folder.glob("*.inp")):
            continue
        name = "Sample model" if folder == root else _EXAMPLE_LABELS.get(folder.name, folder.name.replace("_", " "))
        out.append({"name": name, "path": str(folder)})
    order = {"Sample model": 0, "LID sample": 1, "Drexel campus (LID)": 2, "Bellinge": 3, "Bellinge 2D": 4}
    return sorted(out, key=lambda e: (order.get(e["name"], 9), e["name"]))


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

    from app.version import app_version_key

    cur, lat = _parse(app_version_key(APP_VERSION)), _parse(app_version_key(data.get("latest") or ""))
    return {
        **data,
        "current": APP_VERSION,
        "update_available": bool(cur and lat and lat > cur),
    }
