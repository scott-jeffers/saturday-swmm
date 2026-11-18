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

from app.api import crs, engine, gis, hybrid, model, noaa, openmeteo, projects, results, runs, twod
from app.services.health_service import APP_VERSION, build_health

app = FastAPI(
    title="Saturday-SWMM Backend",
    description="Local OpenSWMM / hybrid (PySWMM+Basilisk) API for Saturday-SWMM",
    version=APP_VERSION,
)

# Compress large JSON payloads (2D mesh / snapshots, network GeoJSON).
app.add_middleware(GZipMiddleware, minimum_size=1000)

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
app.include_router(hybrid.router)
app.include_router(crs.router)


@app.get("/api/health")
def health() -> dict:
    return build_health()
