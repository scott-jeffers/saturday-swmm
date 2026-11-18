from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import LiveSnapshotResponse, RunStatus, RunStatusResponse, StartRunRequest
from app.services.flow_accum_service import flow_accum_run_service
from app.services.hybrid.hybrid_run_service import hybrid_run_service
from app.services.project_service import project_service
from app.services.run_service import run_service

router = APIRouter(prefix="/api/runs", tags=["runs"])


def _active_engine(override: str | None = None) -> str:
    if override in ("openswmm", "hybrid", "flow_accum"):
        return override
    return project_service.get_simulation_engine()


def _any_running() -> bool:
    return (
        run_service.status().status == RunStatus.running
        or hybrid_run_service.status().status == RunStatus.running
        or flow_accum_run_service.status().status == RunStatus.running
    )


def _status_prefer_running() -> RunStatusResponse:
    """Prefer whichever engine is running; else the project's configured engine."""
    for svc in (flow_accum_run_service, hybrid_run_service, run_service):
        st = svc.status()
        if st.status == RunStatus.running:
            return st

    engine = project_service.get_simulation_engine()
    if engine == "flow_accum":
        fa = flow_accum_run_service.status()
        if fa.status != RunStatus.idle:
            return fa
        # Fall through to OpenSWMM if flow_accum is idle (e.g. after opening a project).
    if engine == "hybrid":
        h = hybrid_run_service.status()
        o = run_service.status()
        if h.status != RunStatus.idle and o.status == RunStatus.idle:
            return h
        if o.status != RunStatus.idle:
            return o
        return h

    # openswmm (default): prefer non-idle OpenSWMM, else hybrid/flow leftovers
    o = run_service.status()
    if o.status != RunStatus.idle:
        return o
    h = hybrid_run_service.status()
    if h.status != RunStatus.idle:
        return h
    fa = flow_accum_run_service.status()
    if fa.status != RunStatus.idle:
        return fa
    return o if engine != "flow_accum" else fa


@router.post("", response_model=RunStatusResponse)
def start_run(body: StartRunRequest = StartRunRequest()) -> RunStatusResponse:
    engine = _active_engine(body.simulation_engine)
    live = bool(body.live_rendering)

    if _any_running():
        raise HTTPException(status_code=409, detail="A run is already in progress")

    if engine == "flow_accum":
        root = project_service.require_root()
        return flow_accum_run_service.start(root)

    inp = project_service.require_inp()
    rpt = project_service.rpt_path()
    out = project_service.out_path()
    if engine == "hybrid":
        root = project_service.require_root()
        return hybrid_run_service.start(root, inp, rpt, out, live_rendering=live)
    return run_service.start(inp, rpt, out, live_rendering=live)


@router.get("/current", response_model=RunStatusResponse)
def get_run_status() -> RunStatusResponse:
    return _status_prefer_running()


@router.get("/current/live", response_model=LiveSnapshotResponse)
def get_live_snapshot() -> LiveSnapshotResponse:
    """Solver-memory snapshot while a live-rendering run is in progress."""
    h = hybrid_run_service.status()
    if h.status == RunStatus.running and h.live_rendering:
        return hybrid_run_service.live_snapshot()
    return run_service.live_snapshot()


@router.delete("/current", response_model=RunStatusResponse)
def cancel_run() -> RunStatusResponse:
    fa = flow_accum_run_service.status()
    if fa.status == RunStatus.running:
        return flow_accum_run_service.cancel()
    h = hybrid_run_service.status()
    if h.status == RunStatus.running:
        return hybrid_run_service.cancel()
    return run_service.cancel()
