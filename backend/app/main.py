from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import gis, model, noaa, projects, results, runs

app = FastAPI(
    title="Saturday-SWMM Backend",
    description="Local OpenSWMM API for the Saturday-SWMM web frontend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
