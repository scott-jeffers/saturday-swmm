from __future__ import annotations

# IMPORTANT (Windows): import h5py before any openswmm.engine import.
# OpenSWMM ships its own hdf5.dll; if that loads first, h5py fails with
# "DLL load failed while importing _errors".
try:
    import h5py as _h5py_preload  # noqa: F401
except ImportError:
    _h5py_preload = None  # type: ignore[assignment]

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api import (
    app_info,
    crs,
    engine,
    gis,
    model,
    noaa,
    openmeteo,
    projects,
    results,
    runs,
    twod,
    updates,
)
from app.security import LocalGuardMiddleware
from app.services.health_service import build_health
from app.ui_static import mount_ui
from app.version import APP_VERSION
from app.services.updates_service import remember_loaded_versions

app = FastAPI(
    title="Saturday-SWMM",
    description="Local API for Saturday-SWMM: OpenSWMM 6 and EPA SWMM 5 (PySWMM) runs",
    version=APP_VERSION,
)

# Compress large JSON payloads (2D mesh / snapshots, network GeoJSON).
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Only the Vite dev server needs CORS; the packaged app serves the UI itself
# from the same origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5280",
        "http://127.0.0.1:5280",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Outermost: host allow-list, client header, and no model edits during runs.
app.add_middleware(LocalGuardMiddleware)

app.include_router(app_info.router)
app.include_router(projects.router)
app.include_router(projects.inp_router)
app.include_router(runs.router)
app.include_router(results.router)
app.include_router(model.router)
app.include_router(noaa.router)
app.include_router(openmeteo.router)
app.include_router(gis.router)
app.include_router(engine.router)
app.include_router(twod.router)
app.include_router(crs.router)
app.include_router(updates.router)


@app.get("/api/health")
def health() -> dict:
    return build_health()


remember_loaded_versions()

# Serve the built web UI (frontend/dist or the packaged copy) on the same port.
# Must come after the API routes so /api/* is never shadowed.
mount_ui(app)
