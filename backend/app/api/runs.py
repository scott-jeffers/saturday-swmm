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

        project_service.require_inp()
        try:  # a restore point per run, only when the model changed
            from app.services.snapshot_service import snapshot_service

            snapshot_service.create("Before run", auto=True)
        except Exception:
            pass
        # Under a storm from the library this is a run copy of the model.
        inp = project_service.run_inp()
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


@router.get("/targets")
def compare_targets() -> dict[str, Any]:
    """Runs (scenario × storm) the current results can be compared with."""
    return run_archive_service.targets()


# ------------------------------------------------------------- run grid
@router.get("/matrix")
def run_matrix() -> dict[str, Any]:
    """Every scenario under every storm: which have results, and their headline numbers."""
    from app.services.storm_service import storm_service

    return run_archive_service.matrix(storm_service)


class BatchCell(BaseModel):
    scenario: str
    storm: str


class BatchRequest(BaseModel):
    cells: list[BatchCell]


class _Batch:
    """Runs scenario × storm cells one after another in the background,
    without changing which one is shown."""

    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []
        self.thread: threading.Thread | None = None
        self.cancelled = False

    @property
    def running(self) -> bool:
        return bool(self.thread and self.thread.is_alive())

    def status(self) -> dict[str, Any]:
        return {"running": self.running, "items": self.items}

    def start(self, cells: list[BatchCell]) -> dict[str, Any]:
        if self.running or running_engine():
            raise HTTPException(status_code=409, detail="A run is already in progress")
        from app.services.storm_service import storm_service

        inps = storm_service.scenario_inps()
        for c in cells:
            if c.scenario not in inps:
                raise HTTPException(status_code=404, detail=f"Scenario not found: {c.scenario}")
            if not storm_service.exists(c.storm):
                raise HTTPException(status_code=404, detail=f"Storm not found: {c.storm}")
        self.items = [{"scenario": c.scenario, "storm": c.storm, "state": "waiting", "progress": 0.0, "note": None} for c in cells]
        self.cancelled = False
        engine = _active_engine()
        self.thread = threading.Thread(target=self._work, args=(engine, inps), daemon=True)
        self.thread.start()
        return self.status()

    def cancel(self) -> dict[str, Any]:
        self.cancelled = True
        busy = running_engine()
        if busy:
            try:
                ENGINES[busy].cancel()
            except HTTPException:
                pass
        return self.status()

    def _work(self, engine: str, inps: dict[str, Any]) -> None:
        import time

        from app.services.storm_service import storm_service

        global _last_started
        svc = ENGINES.get(engine, run_service)
        for item in self.items:
            if self.cancelled:
                item["state"] = "cancelled"
                continue
            try:
                inp = inps[item["scenario"]]
                run = storm_service.prepare_cell(inp, item["storm"])
                _, out, rpt = storm_service.cell_paths(inp, item["storm"])
                out.parent.mkdir(parents=True, exist_ok=True)
                with _start_lock:
                    while running_engine():
                        time.sleep(0.5)
                    _last_started = engine
                    item["state"] = "running"
                    svc.start(run, rpt, out)
                while True:
                    time.sleep(0.5)
                    st = svc.status()
                    item["progress"] = float(st.progress or 0.0)
                    if st.status != RunStatus.running:
                        break
                ok = st.status == RunStatus.completed
                item["state"] = "done" if ok else ("cancelled" if self.cancelled else "failed")
                if not ok:
                    item["note"] = (st.error or st.message or "").split("\n")[0][:300] or None
            except Exception as exc:  # noqa: BLE001
                item["state"] = "failed"
                item["note"] = str(getattr(exc, "detail", exc))[:300]
        try:
            output_service.invalidate()
        except Exception:
            pass


_batch = _Batch()


@router.post("/batch")
def start_batch(body: BatchRequest) -> dict[str, Any]:
    if not body.cells:
        raise HTTPException(status_code=400, detail="Nothing to run")
    return _batch.start(body.cells)


@router.get("/batch")
def batch_status() -> dict[str, Any]:
    return _batch.status()


@router.delete("/batch")
def cancel_batch() -> dict[str, Any]:
    return _batch.cancel()


@router.get("/archive/{run_id}/envelope")
def archived_envelope(run_id: str):
    out, _ = run_archive_service.paths(run_id)
    return output_service.envelope_response(out)


@router.get("/archive/{run_id}/snapshot")
def archived_snapshot(run_id: str, period: int = Query(0, ge=0)):
    out, _ = run_archive_service.paths(run_id)
    return output_service.snapshot_response(out, period)


@router.get("/archive/{run_id}/periods")
def archived_periods(run_id: str):
    out, _ = run_archive_service.paths(run_id)
    return output_service.periods(out)


@router.get("/archive/{run_id}/system")
def archived_system_series(run_id: str, variable: str | None = Query(None)):
    out, _ = run_archive_service.paths(run_id)
    return output_service.system_series(out, variable)


@router.get("/archive/{run_id}/lid-reports")
def lid_reports(run_id: str) -> dict:
    """Each LID unit's report (its own time series) for the current run or a
    scenario's latest run. Archived runs don't keep them."""
    from app.services import lid_reports as lr
    from app.services.project_service import project_service
    from app.services.run_archive_service import CELL_PREFIX, SCENARIO_PREFIX
    from app.services.scenario_service import scenario_service

    if run_id == "current":
        inp = project_service.results_inp()
    elif run_id.startswith(SCENARIO_PREFIX):
        inp = scenario_service.inp_path(run_id[len(SCENARIO_PREFIX):])
    elif run_id.startswith(CELL_PREFIX):
        inp = run_archive_service.cell_inp(run_id)
    else:
        return {"reports": []}
    return {"reports": lr.reports(inp)}


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
