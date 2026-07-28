from __future__ import annotations

import importlib.metadata
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.services.health_service import _openswmm_info

PACKAGE = "openswmm"
STATE_PATH = Path(__file__).resolve().parents[2] / ".openswmm_engine.json"
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+\-]*$")
PYPI_JSON = f"https://pypi.org/pypi/{PACKAGE}/json"


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _validate_version(version: str) -> str:
    v = version.strip()
    if not v or not VERSION_RE.match(v) or ".." in v:
        raise HTTPException(status_code=400, detail=f"Invalid version string: {version!r}")
    return v


def _load_state() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {"current": None, "previous": None, "last_ok": None, "updated_at": None}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"current": None, "previous": None, "last_ok": None, "updated_at": None}
        return {
            "current": data.get("current"),
            "previous": data.get("previous"),
            "last_ok": data.get("last_ok"),
            "updated_at": data.get("updated_at"),
        }
    except Exception:
        return {"current": None, "previous": None, "last_ok": None, "updated_at": None}


def _save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _sync_state_with_installed() -> dict[str, Any]:
    """Ensure state.current matches the installed package when possible."""
    info = _openswmm_info()
    installed = info.get("version")
    state = _load_state()
    if installed and state.get("current") != installed:
        # First run or external pip change — seed without inventing a previous
        if state.get("current") is None:
            state["current"] = installed
            state["last_ok"] = installed if info.get("import_ok") else state.get("last_ok")
            state["updated_at"] = state.get("updated_at") or _utc_now()
            _save_state(state)
        else:
            # External change: keep previous as last recorded current
            state["previous"] = state.get("current")
            state["current"] = installed
            if info.get("import_ok"):
                state["last_ok"] = installed
            state["updated_at"] = _utc_now()
            _save_state(state)
    return _load_state()


def _version_key(v: str):
    try:
        from packaging.version import Version

        return Version(v)
    except Exception:
        return v


def _is_newer(candidate: str, current: str | None) -> bool:
    if not current:
        return True
    try:
        return _version_key(candidate) > _version_key(current)
    except Exception:
        return candidate != current


def fetch_pypi() -> dict[str, Any]:
    try:
        with urllib.request.urlopen(PYPI_JSON, timeout=12) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach PyPI: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"PyPI response error: {exc}") from exc

    info = payload.get("info") or {}
    latest = str(info.get("version") or "")
    releases = payload.get("releases") or {}
    versions = sorted(
        (str(v) for v in releases.keys() if VERSION_RE.match(str(v))),
        key=_version_key,
        reverse=True,
    )
    # Cap list for UI dropdowns
    recent = versions[:20]
    if latest and latest not in recent:
        recent = [latest, *recent][:20]
    return {"latest": latest or None, "versions": recent}


def _pip_install(version: str) -> str:
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        f"{PACKAGE}=={version}",
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="pip install timed out") from exc

    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"pip install {PACKAGE}=={version} failed:\n{out[-2000:]}",
        )
    return out[-2000:]


def _verify_in_subprocess() -> tuple[bool, str | None, str | None]:
    """Fresh interpreter check so we don't rely on a stale in-process import."""
    code = (
        "import importlib.metadata as m\n"
        "from openswmm.engine import Solver, OutputReader\n"
        "print(m.version('openswmm'))\n"
    )
    try:
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, None, "Verification timed out"
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "import failed").strip()
        return False, None, err[-1000:]
    ver = (proc.stdout or "").strip().splitlines()
    return True, (ver[-1] if ver else None), None


def get_status() -> dict[str, Any]:
    info = _openswmm_info()
    state = _sync_state_with_installed()
    return {
        "package": PACKAGE,
        "installed_version": info.get("version"),
        "import_ok": bool(info.get("import_ok")),
        "import_error": info.get("error"),
        "current": state.get("current") or info.get("version"),
        "previous": state.get("previous"),
        "last_ok": state.get("last_ok"),
        "updated_at": state.get("updated_at"),
        "can_rollback": bool(state.get("previous")),
        "restart_required_hint": (
            "Restart the backend (uvicorn) after changing the engine so the "
            "running process loads the new wheels."
        ),
    }


def check_updates() -> dict[str, Any]:
    status = get_status()
    pypi = fetch_pypi()
    latest = pypi.get("latest")
    installed = status.get("installed_version")
    update_available = bool(latest and _is_newer(str(latest), installed))
    return {
        **status,
        "latest": latest,
        "versions": pypi.get("versions") or [],
        "update_available": update_available,
        "checked_at": _utc_now(),
    }


def install_version(version: str, *, record_previous: bool = True) -> dict[str, Any]:
    target = _validate_version(version)
    before = _openswmm_info()
    before_ver = before.get("version")
    state = _sync_state_with_installed()

    if before_ver == target and before.get("import_ok"):
        return {
            **get_status(),
            "changed": False,
            "message": f"OpenSWMM {target} is already installed.",
            "restart_required": False,
        }

    _pip_install(target)
    ok, verified_ver, err = _verify_in_subprocess()
    if not ok:
        # Auto-rollback to previous good version if we have one
        rollback_to = state.get("previous") or state.get("last_ok") or before_ver
        rolled = False
        if rollback_to and rollback_to != target:
            try:
                _pip_install(str(rollback_to))
                rok, _, _ = _verify_in_subprocess()
                rolled = rok
            except Exception:
                rolled = False
        raise HTTPException(
            status_code=500,
            detail=(
                f"OpenSWMM {target} installed but failed verification: {err}. "
                + (
                    f"Restored {rollback_to}."
                    if rolled
                    else "Automatic restore failed — check the venv manually."
                )
            ),
        )

    new_state = {
        "current": verified_ver or target,
        "previous": (before_ver if record_previous and before_ver and before_ver != target else state.get("previous")),
        "last_ok": verified_ver or target,
        "updated_at": _utc_now(),
    }
    # If we had no previous and before_ver equals target somehow, keep existing previous
    if not new_state["previous"] and state.get("previous"):
        new_state["previous"] = state["previous"]
    _save_state(new_state)

    return {
        **get_status(),
        "changed": True,
        "message": f"OpenSWMM updated to {verified_ver or target}. Restart the backend to load it.",
        "restart_required": True,
    }


def update_to(version: str | None = None) -> dict[str, Any]:
    if version:
        return install_version(version, record_previous=True)
    checked = check_updates()
    latest = checked.get("latest")
    if not latest:
        raise HTTPException(status_code=404, detail="No PyPI version found for openswmm")
    if not checked.get("update_available"):
        return {
            **get_status(),
            "latest": latest,
            "update_available": False,
            "changed": False,
            "message": f"Already on latest OpenSWMM ({checked.get('installed_version')}).",
            "restart_required": False,
        }
    return install_version(str(latest), record_previous=True)


def rollback() -> dict[str, Any]:
    state = _sync_state_with_installed()
    previous = state.get("previous")
    if not previous:
        raise HTTPException(
            status_code=400,
            detail="No previous OpenSWMM version recorded to roll back to.",
        )
    current = state.get("current") or _openswmm_info().get("version")
    result = install_version(str(previous), record_previous=False)
    # After rolling back, the version we left becomes the new "previous"
    st = _load_state()
    st["previous"] = current
    st["current"] = result.get("current") or previous
    if result.get("import_ok") or result.get("changed"):
        st["last_ok"] = st["current"]
    st["updated_at"] = _utc_now()
    _save_state(st)
    return {
        **get_status(),
        "changed": True,
        "message": f"Rolled back OpenSWMM to {st['current']}. Restart the backend to load it.",
        "restart_required": True,
    }
