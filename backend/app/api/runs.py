from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import LiveSnapshotResponse, RunStatusResponse, StartRunRequest
from app.services.project_service import project_service
from app.services.run_service import run_service

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=RunStatusResponse)
def start_run(body: StartRunRequest = StartRunRequest()) -> RunStatusResponse:
    inp = project_service.require_inp()
    rpt = project_service.rpt_path()
    out = project_service.out_path()
    return run_service.start(inp, rpt, out, live_rendering=bool(body.live_rendering))


@router.get("/current", response_model=RunStatusResponse)
def get_run_status() -> RunStatusResponse:
    return run_service.status()


@router.get("/current/live", response_model=LiveSnapshotResponse)
def get_live_snapshot() -> LiveSnapshotResponse:
    """Solver-memory snapshot while a live-rendering run is in progress."""
    return run_service.live_snapshot()


@router.delete("/current", response_model=RunStatusResponse)
def cancel_run() -> RunStatusResponse:
    return run_service.cancel()
