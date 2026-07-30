from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import crs, engine, gis, model, noaa, projects, results, runs, twod
from app.services.health_service import APP_VERSION, build_health

app = FastAPI(
    title="Saturday-SWMM Backend",
    description="Local OpenSWMM API for the Saturday-SWMM web frontend",
    version=APP_VERSION,
)

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
app.include_router(gis.router)
app.include_router(engine.router)
app.include_router(twod.router)
app.include_router(crs.router)


@app.get("/api/health")
def health() -> dict:
    return build_health()
