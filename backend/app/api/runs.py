from __future__ import annotations

import threading
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.models.schemas import LiveSnapshotResponse, RunStatus, RunStatusResponse, StartRunRequest
from app.services.flow_accum_service import flow_accum_run_service
from app.services.project_service import project_service
from app.services.pyswmm_run_service import pyswmm_run_service
from app.services.output_service import output_service
from app.services.run_archive_service import run_archive_service
from app.services.run_service import run_service

router = APIRouter(prefix="/api/runs", tags=["runs"])

# One registry for every engine so status / cancel / "is anything running"
# never drift apart when an engine is added.
ENGINES: dict[str, Any] = {
    "openswmm": run_service,
    "pyswmm": pyswmm_run_service,
    "flow_accum": flow_accum_run_service,
}

# Serialises "is anything running?" + "start" so two quick clicks can't launch
# two engines writing the same .rpt/.out.
_start_lock = threading.Lock()
# Engine of the most recent run started in this session: its result is what
# "current run" means once nothing is running any more.
_last_started: str | None = None


def _tag(engine: str, st: RunStatusResponse) -> RunStatusResponse:
    if st.engine is None:
        st = st.model_copy(update={"engine": engine})
    return st


def _active_engine(override: str | None = None) -> str:
    if override in ENGINES:
        return override  # type: ignore[return-value]
    return project_service.get_simulation_engine()


def running_engine() -> str | None:
    """Name of the engine currently running, if any."""
    for name, svc in ENGINES.items():
        if svc.status().status == RunStatus.running:
            return name
    return None


def _status_prefer_running() -> RunStatusResponse:
    """The running engine's status; otherwise the project's engine (or last non-idle)."""
    busy = running_engine()
    if busy:
        return _tag(busy, ENGINES[busy].status())
    if _last_started:
        last = ENGINES[_last_started].status()
        if last.status != RunStatus.idle:
            return _tag(_last_started, last)
    engine = project_service.get_simulation_engine()
    own = ENGINES.get(engine, run_service).status()
    if own.status != RunStatus.idle:
        return _tag(engine, own)
    # Results produced by another engine (e.g. an earlier OpenSWMM run) still count.
    for name, svc in ENGINES.items():
        st = svc.status()
        if st.status != RunStatus.idle:
            return _tag(name, st)
    return _tag(engine, own)


@router.post("", response_model=RunStatusResponse)
def start_run(body: StartRunRequest = StartRunRequest()) -> RunStatusResponse:
    engine = _active_engine(body.simulation_engine)
    live = bool(body.live_rendering)

    global _last_started
    with _start_lock:
        busy = running_engine()
        if busy:
            raise HTTPException(status_code=409, detail=f"A {busy} run is already in progress")
        _last_started = engine

        if engine == "flow_accum":
            return _tag(engine, flow_accum_run_service.start(project_service.require_root()))

        inp = project_service.require_inp()
        rpt = project_service.rpt_path()
        out = project_service.out_path()
        svc = ENGINES.get(engine, run_service)
        st = svc.start(inp, rpt, out, live_rendering=live)
        # After start: a status poll in between must not archive the previous run.
        run_archive_service.note_started(engine)
        return _tag(engine, st)


@router.get("/current", response_model=RunStatusResponse)
def get_run_status() -> RunStatusResponse:
    st = _status_prefer_running()
    run_archive_service.on_status(st.engine, st.status.value if hasattr(st.status, "value") else str(st.status))
    return st


# ------------------------------------------------------------- archive
class RunPatch(BaseModel):
    label: Optional[str] = None
    pinned: Optional[bool] = None


@router.get("/archive")
def list_archived_runs() -> dict[str, Any]:
    return run_archive_service.list()


@router.patch("/archive/{run_id}")
def update_archived_run(run_id: str, body: RunPatch) -> dict[str, Any]:
    return run_archive_service.update(run_id, body.label, body.pinned)


@router.delete("/archive/{run_id}")
def delete_archived_run(run_id: str) -> dict[str, Any]:
    return run_archive_service.delete(run_id)


@router.get("/compare")
def compare_runs(a: str = Query(...), b: str = Query(...)) -> dict[str, Any]:
    """Headline results and the biggest per-object changes between two runs."""
    return run_archive_service.compare(a, b)


@router.get("/archive/{run_id}/series/{kind}/{object_id}")
def archived_series(
    run_id: str,
    kind: Literal["node", "link", "subcatchment"],
    object_id: str,
    variable: Optional[str] = None,
):
    out, _ = run_archive_service.paths(run_id)
    fn = {"node": output_service.node_series, "link": output_service.link_series, "subcatchment": output_service.subcatchment_series}[kind]
    return fn(out, object_id, variable)


@router.get("/current/live", response_model=LiveSnapshotResponse)
def get_live_snapshot() -> LiveSnapshotResponse:
    """Solver-memory snapshot while a live-rendering run is in progress."""
    busy = running_engine()
    svc = ENGINES.get(busy or "", None)
    if svc is not None and hasattr(svc, "live_snapshot"):
        return svc.live_snapshot()
    return LiveSnapshotResponse(available=False)


@router.delete("/current", response_model=RunStatusResponse)
def cancel_run() -> RunStatusResponse:
    busy = running_engine()
    if not busy:
        raise HTTPException(status_code=400, detail="No run in progress")
    return _tag(busy, ENGINES[busy].cancel())
