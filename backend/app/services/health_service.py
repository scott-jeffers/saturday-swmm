from __future__ import annotations

import importlib.metadata
import importlib.util
import sys
from typing import Any


APP_VERSION = "0.1.0"

# (report key, import module name)
GIS_PACKAGES = (
    ("rasterio", "rasterio"),
    ("pyogrio", "pyogrio"),
    ("shapely", "shapely"),
    ("pyproj", "pyproj"),
    ("pillow", "PIL"),
    ("geopandas", "geopandas"),
    ("h5py", "h5py"),
)


def _package_importable(module: str) -> bool:
    try:
        importlib.import_module(module)
        return True
    except Exception:
        return False


def _openswmm_info() -> dict[str, Any]:
    # Prefer h5py's HDF5 DLLs before OpenSWMM's (Windows DLL search order).
    try:
        import h5py  # noqa: F401
    except Exception:
        pass
    try:
        import openswmm  # noqa: F401
        from openswmm.engine import OutputReader, Solver  # noqa: F401
    except Exception as exc:
        version = None
        try:
            version = importlib.metadata.version("openswmm")
        except Exception:
            version = None
        return {
            "installed": version is not None,
            "version": version,
            "import_ok": False,
            "error": str(exc),
        }

    version: str | None
    try:
        version = importlib.metadata.version("openswmm")
    except Exception:
        version = getattr(openswmm, "__version__", None) or "unknown"

    return {
        "installed": True,
        "version": version,
        "import_ok": True,
        "error": None,
    }


def build_health() -> dict[str, Any]:
    openswmm = _openswmm_info()
    gis = {key: _package_importable(module) for key, module in GIS_PACKAGES}
    status = "ok" if openswmm["import_ok"] and gis.get("h5py", False) else "degraded"
    return {
        "status": status,
        "app_version": APP_VERSION,
        "python_version": sys.version.split()[0],
        "openswmm": openswmm,
        "gis": gis,
    }
