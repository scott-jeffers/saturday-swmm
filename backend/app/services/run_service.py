from __future__ import annotations

import math
import threading
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.models.schemas import LiveSnapshotResponse, RunStatus, RunStatusResponse

# 2D models sub-cycle below the nominal routing step during wet periods.
_2D_SUBCYCLE_FACTOR = 3


def _release_output_files(inp_path: Path, out_path: Path, rpt_path: Path) -> None:
    """Close cached readers and remove stale result files OpenSWMM must recreate.

    Windows locks *.2d.h5 / *.out while h5py/OutputReader hold them; OpenSWMM then
    fails Solver.start with a generic PluginError.
    """
    import gc

    try:
        from app.services.twod_output_service import twod_output_service

        twod_output_service.invalidate()
    except Exception:
        pass
    try:
        from app.services.output_service import output_service

        output_service.invalidate()
    except Exception:
        pass
    gc.collect()

    h5_path: Optional[Path] = None
    try:
        from app.services.twod_mesh_service import twod_mesh_service

        h5_path = twod_mesh_service.resolve_h5_path(inp_path)
    except Exception:
        h5_path = inp_path.with_suffix(".2d.h5")

    for path in (h5_path, out_path, rpt_path):
        if path is None:
            continue
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            # Still locked — caller will surface OpenSWMM's PluginError.
            pass


def _model_uses_2d_solver(inp_path: Path) -> bool:
    """True when the INP configures 2D overland routing (inline or external mesh)."""
    try:
        from app.services.inp_model_service import inp_model_service
        from app.services.twod_mesh_service import twod_mesh_service

        if twod_mesh_service.has_2d_mesh(inp_path):
            return True
        model = inp_model_service.load(inp_path)
        sections = model.sections
        return bool(sections.get("2D_OPTIONS") or sections.get("2D_MESH_FILE"))
    except Exception:
        return False


def _estimate_expected_steps(inp_path: Path, solver: Any) -> int:
    """Estimate routing steps from the simulation window and routing step."""
    duration_s = (solver.end_datetime - solver.start_datetime).total_seconds()
    routing_s = max(solver.routing_step.total_seconds(), 1e-9)
    base = max(1, math.ceil(duration_s / routing_s))

    if _model_uses_2d_solver(inp_path):
        # Wet-weather 2D routing often needs several substeps per routing interval.
        return max(1, math.ceil(duration_s / (routing_s / _2D_SUBCYCLE_FACTOR)))

    return base


def _step_progress(
    step_count: int,
    expected_steps: int,
    *,
    elapsed_sim_s: float,
    total_sim_s: float,
) -> tuple[float, int]:
    """Return (percent, possibly revised expected_steps).

    Starts from the pre-run estimate, then auto-corrects using
    projected_total = step_count / sim_done_fraction once enough
    simulated time has elapsed.
    """
    expected = max(1, expected_steps)
    if total_sim_s > 0 and step_count > 0:
        sim_done = max(0.0, min(1.0, elapsed_sim_s / total_sim_s))
        if sim_done > 0.05:
            projected = int(math.ceil(step_count / sim_done))
            expected = max(expected, projected)
    if step_count >= expected:
        expected = step_count + max(1000, expected // 5)
    pct = min(99.0, (step_count / expected) * 100.0)
    return pct, expected


def _as_str_ids(arr: Any) -> list[str]:
    try:
        return [str(x) for x in arr.tolist()]
    except Exception:
        return [str(x) for x in arr]


def _as_float_list(arr: Any, *, ndigits: int | None = 4) -> list[float]:
    try:
        values = arr.tolist()
    except Exception:
        values = list(arr)
    if ndigits is None:
        return [float(v) for v in values]
    return [round(float(v), ndigits) for v in values]


def _minmax(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    return float(min(values)), float(max(values))


class RunService:
    """Background OpenSWMM Solver runner (single active job for MVP)."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="swmm-run")
        self._future: Optional[Future] = None
        self._cancel = threading.Event()
        self._status = RunStatus.idle
        self._progress = 0.0
        self._message = ""
        self._error: Optional[str] = None
        self._inp_path: Optional[str] = None
        self._rpt_path: Optional[str] = None
        self._out_path: Optional[str] = None
        self._step_count: Optional[int] = None
        self._expected_steps: Optional[int] = None
        self._live_rendering = False
        self._live_snapshot: Optional[LiveSnapshotResponse] = None

    def status(self) -> RunStatusResponse:
        with self._lock:
            return RunStatusResponse(
                status=self._status,
                progress=self._progress,
                message=self._message,
                error=self._error,
                inp_path=self._inp_path,
                rpt_path=self._rpt_path,
                out_path=self._out_path,
                step_count=self._step_count,
                expected_steps=self._expected_steps,
                live_rendering=self._live_rendering,
            )

    def live_snapshot(self) -> LiveSnapshotResponse:
        with self._lock:
            if (
                self._status != RunStatus.running
                or not self._live_rendering
                or self._live_snapshot is None
            ):
                return LiveSnapshotResponse(available=False)
            return self._live_snapshot

    def note_project_outputs(
        self,
        *,
        inp_path: str,
        rpt_path: Optional[str],
        out_path: Optional[str],
    ) -> None:
        """When opening a project, surface existing .out/.rpt without changing run state."""
        with self._lock:
            if self._status == RunStatus.running:
                return
            # A different model: the last run's status (e.g. "failed") belongs
            # to the project we left, so it must not follow the user here.
            switched = str(self._inp_path or "") != str(inp_path)
            if switched and self._status in (RunStatus.failed, RunStatus.cancelled, RunStatus.completed):
                self._status = RunStatus.idle
                self._error = None
                self._message = ""
                self._progress = 0.0
            self._inp_path = inp_path
            self._rpt_path = rpt_path
            self._out_path = out_path
            if out_path and self._status in (RunStatus.idle, RunStatus.cancelled):
                self._status = RunStatus.completed
                self._progress = 100.0
                self._message = "Existing results loaded"
                self._error = None
            elif not out_path and self._status != RunStatus.running:
                # Fresh project with no results — reset completed-from-previous-project.
                if self._message == "Existing results loaded" or self._status == RunStatus.completed:
                    self._status = RunStatus.idle
                    self._progress = 0.0
                    self._message = ""
                    self._error = None

    def start(
        self,
        inp_path: Path,
        rpt_path: Path,
        out_path: Path,
        *,
        live_rendering: bool = False,
    ) -> RunStatusResponse:
        with self._lock:
            if self._status == RunStatus.running:
                raise HTTPException(status_code=409, detail="A run is already in progress")

            self._cancel.clear()
            self._status = RunStatus.running
            self._progress = 0.0
            self._message = "Starting simulation"
            self._error = None
            self._step_count = 0
            self._expected_steps = None
            self._inp_path = str(inp_path)
            self._rpt_path = str(rpt_path)
            self._out_path = str(out_path)
            self._live_rendering = bool(live_rendering)
            self._live_snapshot = None
            self._future = self._executor.submit(
                self._run_job, inp_path, rpt_path, out_path, self._live_rendering
            )
            return self.status()

    def cancel(self) -> RunStatusResponse:
        with self._lock:
            if self._status != RunStatus.running:
                raise HTTPException(status_code=400, detail="No run in progress")
            self._cancel.set()
            self._message = "Cancel requested"
            return self.status()

    def _set(
        self,
        *,
        status: Optional[RunStatus] = None,
        progress: Optional[float] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        step_count: Optional[int] = None,
        expected_steps: Optional[int] = None,
    ) -> None:
        with self._lock:
            if status is not None:
                self._status = status
            if progress is not None:
                self._progress = progress
            if message is not None:
                self._message = message
            if error is not None:
                self._error = error
            if step_count is not None:
                self._step_count = step_count
            if expected_steps is not None:
                self._expected_steps = expected_steps

    def _store_live_snapshot(self, snap: LiveSnapshotResponse) -> None:
        with self._lock:
            if self._status == RunStatus.running and self._live_rendering:
                self._live_snapshot = snap

    def _clear_live(self) -> None:
        with self._lock:
            self._live_rendering = False
            self._live_snapshot = None

    def _capture_live_snapshot(
        self,
        solver: Any,
        *,
        node_ids: list[str],
        link_ids: list[str],
        sub_ids: list[str],
        capture_twod: bool,
    ) -> LiveSnapshotResponse:
        node_depths = _as_float_list(solver.nodes.depths)
        link_flows = [abs(v) for v in _as_float_list(solver.links.flows)]
        sub_runoffs: list[float] = []
        if sub_ids:
            try:
                sub_runoffs = [abs(v) for v in _as_float_list(solver.subcatchments.runoffs)]
            except Exception:
                sub_runoffs = [0.0] * len(sub_ids)

        dmin, dmax = _minmax(node_depths)
        fmin, fmax = _minmax(link_flows)
        rmin, rmax = _minmax(sub_runoffs)

        clock: Optional[str] = None
        try:
            clock = solver.current_datetime.strftime("%Y-%m-%dT%H:%M:%S")
        except Exception:
            clock = None

        has_twod = False
        twod_values: list[float] = []
        twod_min = 0.0
        twod_max = 0.0
        twod_count = 0
        if capture_twod:
            try:
                surface = solver.surface2d
                if surface is not None and getattr(surface, "is_active", False):
                    depths = surface.get_depths()
                    twod_values = _as_float_list(depths, ndigits=4)
                    twod_count = len(twod_values)
                    twod_min, twod_max = _minmax(twod_values)
                    has_twod = twod_count > 0
            except Exception:
                has_twod = False

        return LiveSnapshotResponse(
            available=True,
            time=clock,
            node_ids=node_ids,
            link_ids=link_ids,
            subcatchment_ids=sub_ids,
            node_depths=node_depths,
            link_flows=link_flows,
            subcatchment_runoffs=sub_runoffs,
            node_depth_min=dmin,
            node_depth_max=dmax,
            link_flow_min=fmin,
            link_flow_max=fmax,
            subcatchment_runoff_min=rmin,
            subcatchment_runoff_max=rmax,
            has_twod=has_twod,
            twod_triangle_count=twod_count,
            twod_values=twod_values,
            twod_value_min=twod_min,
            twod_value_max=twod_max,
        )

    def _run_job(
        self,
        inp_path: Path,
        rpt_path: Path,
        out_path: Path,
        live_rendering: bool,
    ) -> None:
        expected_steps = 1
        step_count = 0
        try:
            # Release any open *.2d.h5 / *.out handles so OpenSWMM can recreate files.
            _release_output_files(inp_path, out_path, rpt_path)

            from openswmm.engine import Solver

            self._set(message="Opening solver")
            with Solver(str(inp_path), str(rpt_path), str(out_path)) as solver:
                expected_steps = _estimate_expected_steps(inp_path, solver)
                total_sim_s = max(
                    (solver.end_datetime - solver.start_datetime).total_seconds(),
                    1e-9,
                )
                step_count = 0
                last_update_wall = 0.0
                last_live_wall = 0.0
                MIN_UPDATE_INTERVAL_S = 0.25
                MIN_LIVE_INTERVAL_S = 0.5

                node_ids: list[str] = []
                link_ids: list[str] = []
                sub_ids: list[str] = []
                capture_twod = False
                if live_rendering:
                    try:
                        node_ids = _as_str_ids(solver.nodes.ids)
                        link_ids = _as_str_ids(solver.links.ids)
                        sub_ids = _as_str_ids(solver.subcatchments.ids)
                    except Exception:
                        node_ids, link_ids, sub_ids = [], [], []
                    try:
                        surface = solver.surface2d
                        capture_twod = bool(
                            surface is not None and getattr(surface, "is_active", False)
                        )
                    except Exception:
                        capture_twod = False

                self._set(
                    message=f"Estimated {expected_steps:,} steps",
                    progress=0.0,
                    step_count=0,
                    expected_steps=expected_steps,
                )

                while True:
                    elapsed_td = solver.step()
                    step_count += 1
                    if not elapsed_td or elapsed_td.total_seconds() <= 0:
                        break

                    now = time.monotonic()
                    if now - last_update_wall >= MIN_UPDATE_INTERVAL_S:
                        last_update_wall = now
                        elapsed_sim_s = elapsed_td.total_seconds()
                        pct, expected_steps = _step_progress(
                            step_count,
                            expected_steps,
                            elapsed_sim_s=elapsed_sim_s,
                            total_sim_s=total_sim_s,
                        )
                        try:
                            clock = solver.current_datetime.strftime(
                                "%Y-%m-%d %H:%M:%S"
                            )
                            message = (
                                f"Step {step_count:,} / {expected_steps:,} · {clock}"
                            )
                        except Exception:
                            message = f"Step {step_count:,} / {expected_steps:,}"
                        self._set(
                            progress=pct,
                            message=message,
                            step_count=step_count,
                            expected_steps=expected_steps,
                        )

                    if live_rendering and now - last_live_wall >= MIN_LIVE_INTERVAL_S:
                        last_live_wall = now
                        try:
                            snap = self._capture_live_snapshot(
                                solver,
                                node_ids=node_ids,
                                link_ids=link_ids,
                                sub_ids=sub_ids,
                                capture_twod=capture_twod,
                            )
                            self._store_live_snapshot(snap)
                        except Exception:
                            pass

                    if self._cancel.is_set():
                        self._clear_live()
                        self._set(
                            status=RunStatus.cancelled,
                            message="Cancelled by user",
                            progress=self._progress,
                            step_count=step_count,
                            expected_steps=expected_steps,
                        )
                        return

            # Ensure next results read picks up the new HDF5 / OUT, not a stale handle.
            try:
                from app.services.twod_output_service import twod_output_service

                twod_output_service.invalidate()
            except Exception:
                pass
            try:
                from app.services.output_service import output_service

                output_service.invalidate()
            except Exception:
                pass

            self._clear_live()
            self._set(
                status=RunStatus.completed,
                progress=100.0,
                message="Simulation completed",
                step_count=step_count,
                expected_steps=expected_steps,
            )
        except Exception as exc:
            try:
                from app.services.twod_output_service import twod_output_service

                twod_output_service.invalidate()
            except Exception:
                pass
            try:
                from app.services.output_service import output_service

                output_service.invalidate()
            except Exception:
                pass
            self._clear_live()
            tb = traceback.format_exc()
            msg = str(exc)
            engine_errors = _rpt_error_summary(rpt_path)
            if engine_errors:
                msg = f"{msg}\n{engine_errors}"
            if "PluginError" in type(exc).__name__ or "Plugin" in msg:
                msg = (
                    f"{exc}\n\nOften caused by a locked *.2d.h5 / *.out (results still open). "
                    "Stop other runs, close results views, or restart the backend, then try again."
                )
            self._set(
                status=RunStatus.failed,
                message="Simulation failed",
                error=f"{msg}\n{tb}",
                progress=self._progress,
            )


def _rpt_error_summary(rpt_path: Path, limit: int = 8) -> str:
    """The engine's own ERROR lines from the report, de-duplicated, so the
    user sees "ERROR 209: undefined object *" instead of a Python traceback."""
    try:
        if not rpt_path.is_file():
            return ""
        lines: list[str] = []
        counts: dict[str, int] = {}
        with rpt_path.open("r", errors="replace") as fh:
            for raw in fh:
                t = raw.strip()
                if not t.upper().startswith("ERROR"):
                    continue
                if t not in counts:
                    lines.append(t)
                counts[t] = counts.get(t, 0) + 1
        if not lines:
            return ""
        out = []
        for t in lines[:limit]:
            n = counts[t]
            out.append(f"{t}" + (f"  (x{n})" if n > 1 else ""))
        if len(lines) > limit:
            out.append(f"... and {len(lines) - limit} more distinct errors in the report")
        if any("undefined object *" in t for t in lines):
            out.append(
                "Hint: subcatchments drain to '*', PCSWMM's 2D surface. Generate a 2D mesh "
                "(2D page) or run with EPA SWMM 5, which sends that runoff to a surface outfall."
            )
        return "\n".join(out)
    except Exception:
        return ""


run_service = RunService()
