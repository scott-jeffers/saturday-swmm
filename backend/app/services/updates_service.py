"""Update checks and one-click updates for Saturday-SWMM and its engines.

Components:

* ``saturday-swmm`` – the app itself, from GitHub releases. In the portable
  build an update downloads the new zip, checks its SHA-256, unpacks it next
  to the current folder and restarts into it. From a source checkout it only
  reports the new version (update with git).
* ``openswmm`` – OpenSWMM 6 engine (PyPI, pre-releases included: OpenSWMM 6
  is only published as pre-releases).
* ``pyswmm`` and ``swmm-toolkit`` – PySWMM and the EPA SWMM 5 engine it
  wraps (PyPI).

Engine updates run ``pip`` in the interpreter that runs the app, verify the
new version imports in a fresh process, and roll back automatically if not.
The running server keeps the old modules loaded until it restarts, so a
successful update reports ``restart_required``.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.version import APP_VERSION, DISTRIBUTION, RELEASES_REPO

STATE_PATH = Path(__file__).resolve().parents[2] / ".updates_state.json"
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+\-]*$")
CACHE_S = 3600.0
_cache: dict[str, Any] = {"at": 0.0, "latest": {}}


@dataclass(frozen=True)
class Package:
    id: str
    name: str
    role: str
    dist: str  # PyPI / importlib.metadata distribution name
    verify: str  # code run in a fresh interpreter; must print the version
    prereleases: bool = False


PACKAGES: dict[str, Package] = {
    "openswmm": Package(
        "openswmm",
        "OpenSWMM",
        "OpenSWMM 6 engine (1D + 2D)",
        "openswmm",
        "import importlib.metadata as m\nfrom openswmm.engine import Solver, OutputReader\nprint(m.version('openswmm'))",
        prereleases=True,
    ),
    "pyswmm": Package(
        "pyswmm",
        "PySWMM",
        "Runs the EPA SWMM 5 engine",
        "pyswmm",
        "import importlib.metadata as m\nimport pyswmm\nprint(m.version('pyswmm'))",
    ),
    "swmm-toolkit": Package(
        "swmm-toolkit",
        "EPA SWMM 5 engine",
        "swmm-toolkit: the EPA SWMM 5.2 solver used by PySWMM",
        "swmm-toolkit",
        "import importlib.metadata as m\nfrom swmm.toolkit import solver\nprint(m.version('swmm-toolkit'))",
    ),
}


# ---------------------------------------------------------------- helpers
def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _vkey(v: str):
    from packaging.version import InvalidVersion, Version

    try:
        return Version(v.lstrip("vV"))
    except InvalidVersion:
        return None


def _newer(candidate: Optional[str], current: Optional[str]) -> bool:
    if not candidate or not current:
        return False
    a, b = _vkey(candidate), _vkey(current)
    return bool(a and b and a > b)


def _installed(dist: str) -> Optional[str]:
    try:
        return importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        return None


def _loaded(pkg: Package) -> Optional[str]:
    """Version the running process imported (differs after an update until restart)."""
    return _state().get("loaded", {}).get(pkg.id) or _installed(pkg.dist)


def _state() -> dict[str, Any]:
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_state(data: dict[str, Any]) -> None:
    from app.services.fs_utils import atomic_write_text

    atomic_write_text(STATE_PATH, json.dumps(data, indent=2) + "\n")


def remember_loaded_versions() -> None:
    """Record what this process loaded at startup (called once from main)."""
    data = _state()
    data["loaded"] = {p.id: _installed(p.dist) for p in PACKAGES.values()}
    try:
        _save_state(data)
    except OSError:
        pass


def _get_json(url: str, timeout: float = 10.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": f"Saturday-SWMM/{APP_VERSION}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _pypi_latest(pkg: Package) -> dict[str, Any]:
    data = _get_json(f"https://pypi.org/pypi/{pkg.dist}/json")
    versions = []
    for v, files in (data.get("releases") or {}).items():
        k = _vkey(v)
        if k is None or not files or all(f.get("yanked") for f in files):
            continue
        if k.is_prerelease and not pkg.prereleases:
            continue
        versions.append(v)
    versions.sort(key=_vkey, reverse=True)
    return {
        "latest": versions[0] if versions else (data.get("info") or {}).get("version"),
        "versions": versions[:15],
        "notes_url": f"https://pypi.org/project/{pkg.dist}/#history",
    }


def _github_latest() -> dict[str, Any]:
    rel = _get_json(f"https://api.github.com/repos/{RELEASES_REPO}/releases/latest")
    assets = {a["name"]: a for a in rel.get("assets") or []}
    zip_asset = next((a for n, a in assets.items() if n.endswith("-win64.zip")), None)
    sha_asset = assets.get(f"{zip_asset['name']}.sha256") if zip_asset else None
    return {
        "latest": str(rel.get("tag_name") or "").lstrip("vV") or None,
        "notes_url": rel.get("html_url"),
        "notes": (rel.get("body") or "")[:4000],
        "zip_url": zip_asset and zip_asset["browser_download_url"],
        "zip_size": zip_asset and zip_asset.get("size"),
        "sha_url": sha_asset and sha_asset["browser_download_url"],
    }


def _latest(force: bool) -> dict[str, dict[str, Any]]:
    now = time.time()
    if force or now - _cache["at"] > CACHE_S or not _cache["latest"]:
        out: dict[str, dict[str, Any]] = {}
        try:
            out["saturday-swmm"] = _github_latest()
        except Exception as exc:
            out["saturday-swmm"] = {"error": f"Couldn't reach GitHub: {exc}"}
        for pkg in PACKAGES.values():
            try:
                out[pkg.id] = _pypi_latest(pkg)
            except Exception as exc:
                out[pkg.id] = {"error": f"Couldn't reach PyPI: {exc}"}
        _cache.update(at=now, latest=out)
    return _cache["latest"]


# ----------------------------------------------------------------- status
def status(force: bool = False) -> dict[str, Any]:
    latest = _latest(force)
    st = _state()
    comps: list[dict[str, Any]] = []

    app_l = latest.get("saturday-swmm", {})
    comps.append(
        {
            "id": "saturday-swmm",
            "name": "Saturday-SWMM",
            "role": "The app",
            "installed": APP_VERSION,
            "latest": app_l.get("latest"),
            "update_available": _newer(app_l.get("latest"), APP_VERSION),
            "can_update": DISTRIBUTION == "portable" and bool(app_l.get("zip_url")),
            "how_to_update": (
                None
                if DISTRIBUTION == "portable"
                else "Running from source: update with `git pull`, then `pip install -r requirements.txt` and `npm ci`."
            ),
            "notes_url": app_l.get("notes_url"),
            "notes": app_l.get("notes", ""),
            "download_size": app_l.get("zip_size"),
            "previous": None,
            "error": app_l.get("error"),
            "downloaded_to": st.get("app_downloaded", {}).get(app_l.get("latest") or ""),
        }
    )
    restart = False
    for pkg in PACKAGES.values():
        info = latest.get(pkg.id, {})
        inst = _installed(pkg.dist)
        loaded = _loaded(pkg)
        if inst and loaded and inst != loaded:
            restart = True
        comps.append(
            {
                "id": pkg.id,
                "name": pkg.name,
                "role": pkg.role,
                "installed": inst,
                "loaded": loaded,
                "latest": info.get("latest"),
                "versions": info.get("versions", []),
                "update_available": _newer(info.get("latest"), inst),
                "can_update": inst is not None,
                "notes_url": info.get("notes_url"),
                "previous": st.get("previous", {}).get(pkg.id),
                "error": info.get("error"),
            }
        )
    return {
        "checked_at": datetime.fromtimestamp(_cache["at"], timezone.utc).replace(microsecond=0).isoformat()
        if _cache["at"]
        else _now(),
        "distribution": DISTRIBUTION,
        "restart_required": restart,
        "can_restart": _can_restart(),
        "updates_available": sum(1 for c in comps if c["update_available"]),
        "components": comps,
    }


# ------------------------------------------------------------ pip updates
def _pip(spec: str) -> None:
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--upgrade", spec]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600, check=False)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="The download timed out. Check your internet connection and try again.") from exc
    if proc.returncode != 0:
        tail = ((proc.stdout or "") + (proc.stderr or ""))[-1500:]
        raise HTTPException(status_code=502, detail=f"pip couldn't install {spec}:\n{tail}")


def _verify(pkg: Package) -> tuple[bool, Optional[str], str]:
    try:
        proc = subprocess.run([sys.executable, "-c", pkg.verify], capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return False, None, "check timed out"
    if proc.returncode != 0:
        return False, None, (proc.stderr or proc.stdout or "import failed").strip()[-800:]
    out = (proc.stdout or "").strip().splitlines()
    return True, out[-1] if out else None, ""


def _refuse_while_running() -> None:
    """Swapping an engine under a running simulation would corrupt its results."""
    try:
        from app.api.runs import running_engine

        busy = running_engine()
    except Exception:
        busy = None
    if busy:
        raise HTTPException(status_code=409, detail="A simulation is running. Update after it finishes.")


def install_package(pkg_id: str, version: Optional[str] = None) -> dict[str, Any]:
    pkg = PACKAGES.get(pkg_id)
    if pkg is None:
        raise HTTPException(status_code=404, detail=f"Unknown component: {pkg_id}")
    _refuse_while_running()
    before = _installed(pkg.dist)
    if version is None:
        version = _latest(False).get(pkg.id, {}).get("latest")
    if not version or not VERSION_RE.match(version):
        raise HTTPException(status_code=400, detail="No version to install")
    if version == before:
        return {"changed": False, "message": f"{pkg.name} {version} is already installed.", **status()}

    _pip(f"{pkg.dist}=={version}")
    ok, got, err = _verify(pkg)
    if not ok:
        restored = False
        if before:
            try:
                _pip(f"{pkg.dist}=={before}")
                restored = _verify(pkg)[0]
            except HTTPException:
                restored = False
        raise HTTPException(
            status_code=500,
            detail=f"{pkg.name} {version} installed but didn't start: {err}. "
            + (f"Went back to {before}." if restored else "Couldn't restore the previous version automatically."),
        )
    data = _state()
    data.setdefault("previous", {})[pkg.id] = before
    data.setdefault("history", []).append({"at": _now(), "id": pkg.id, "from": before, "to": got or version})
    _save_state(data)
    return {
        "changed": True,
        "message": f"{pkg.name} updated to {got or version}. Restart Saturday-SWMM to start using it.",
        **status(),
    }


# PySWMM before swmm-toolkit: pip then picks the toolkit PySWMM supports.
UPDATE_ORDER = ("openswmm", "pyswmm", "swmm-toolkit")


def update_all() -> dict[str, Any]:
    """Update every engine that has a newer version, then the app itself.

    Each engine is verified after install and rolled back on its own if it
    fails, so one bad release never blocks the rest. The app goes last because
    updating it restarts into a new folder.
    """
    _refuse_while_running()
    now = status(force=True)
    pending = {c["id"]: c for c in now["components"] if c.get("update_available")}
    results: list[dict[str, Any]] = []
    for pid in UPDATE_ORDER:
        if pid not in pending:
            continue
        try:
            r = install_package(pid)
            results.append({"id": pid, "ok": True, "message": r.get("message", "")})
        except HTTPException as exc:
            results.append({"id": pid, "ok": False, "message": str(exc.detail)})
    app_result: dict[str, Any] | None = None
    app = pending.get("saturday-swmm")
    if app and app.get("can_update"):
        try:
            app_result = install_app_update()
            results.append({"id": "saturday-swmm", "ok": True, "message": app_result.get("message", "")})
        except HTTPException as exc:
            results.append({"id": "saturday-swmm", "ok": False, "message": str(exc.detail)})
    elif app:
        results.append({"id": "saturday-swmm", "ok": False, "message": app.get("how_to_update") or "Update the app by hand."})
    out = status()
    out["results"] = results
    if app_result and app_result.get("path"):
        out["path"] = app_result["path"]
        out["version"] = app_result.get("version")
    failed = [r for r in results if not r["ok"]]
    done = [r for r in results if r["ok"]]
    if not results:
        out["message"] = "Everything is already up to date."
    elif not failed:
        out["message"] = f"Updated {len(done)} component{'s' if len(done) != 1 else ''}."
    else:
        out["message"] = f"Updated {len(done)}; {len(failed)} could not be updated."
    return out


def rollback_package(pkg_id: str) -> dict[str, Any]:
    prev = _state().get("previous", {}).get(pkg_id)
    if not prev:
        raise HTTPException(status_code=400, detail="There's no earlier version recorded to go back to.")
    return install_package(pkg_id, prev)


# ------------------------------------------------------------- app update
def _portable_root() -> Path:
    return Path(__file__).resolve().parents[2]  # <root>/app/services/updates_service.py


def install_app_update() -> dict[str, Any]:
    _refuse_while_running()
    if DISTRIBUTION != "portable":
        raise HTTPException(status_code=400, detail="Automatic app updates work in the portable release. From source, use git pull.")
    info = _latest(True).get("saturday-swmm", {})
    ver, url, sha_url = info.get("latest"), info.get("zip_url"), info.get("sha_url")
    if not ver or not url:
        raise HTTPException(status_code=404, detail="No downloadable release found.")
    if not _newer(ver, APP_VERSION):
        raise HTTPException(status_code=400, detail=f"You already have the latest version ({APP_VERSION}).")
    root = _portable_root()
    target = root.parent / f"Saturday-SWMM-{ver}"
    if not (target / "Saturday-SWMM.cmd").is_file():
        tmp = Path(tempfile.mkdtemp(prefix="saturday-update-", dir=root.parent))
        try:
            zpath = tmp / "update.zip"
            h = hashlib.sha256()
            req = urllib.request.Request(url, headers={"User-Agent": f"Saturday-SWMM/{APP_VERSION}"})
            with urllib.request.urlopen(req, timeout=60) as r, open(zpath, "wb") as f:
                while chunk := r.read(1 << 20):
                    h.update(chunk)
                    f.write(chunk)
            if sha_url:
                expected = urllib.request.urlopen(sha_url, timeout=30).read().decode().split()[0].lower()
                if expected != h.hexdigest():
                    raise HTTPException(status_code=502, detail="The download was corrupted (checksum mismatch). Try again.")
            with zipfile.ZipFile(zpath) as z:
                z.extractall(tmp / "x")
            inner = tmp / "x" / "Saturday-SWMM"
            if not (inner / "Saturday-SWMM.cmd").is_file():
                raise HTTPException(status_code=502, detail="The downloaded release doesn't look right.")
            shutil.move(str(inner), str(target))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    data = _state()
    data.setdefault("app_downloaded", {})[ver] = str(target)
    _save_state(data)
    return {
        "changed": True,
        "version": ver,
        "path": str(target),
        "message": f"Saturday-SWMM {ver} is ready in {target}. Restart to switch to it; next time start it from that folder.",
        **status(),
    }


# ----------------------------------------------------------------- restart
def _can_restart() -> bool:
    from app import launcher

    return launcher._server is not None


def restart(into: Optional[str] = None) -> dict[str, Any]:
    """Start a fresh server (optionally from a newer portable folder) and stop this one."""
    from app import launcher

    if launcher._server is None:
        raise HTTPException(status_code=400, detail="Restart Saturday-SWMM yourself: close its window and start it again.")
    port = launcher._server.config.port
    root = Path(into) if into else _portable_root()
    py = root / "python" / "python.exe"
    exe = str(py) if py.is_file() else sys.executable
    args = [exe, "-m", "app.launcher", "--port", str(port), "--no-browser", "--wait-for-port"]
    kwargs: dict[str, Any] = {"cwd": str(root)}
    if sys.platform.startswith("win"):
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    subprocess.Popen(args, **kwargs)
    launcher.request_shutdown()
    return {"ok": True, "port": port}
