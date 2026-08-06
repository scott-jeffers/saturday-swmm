from __future__ import annotations

import math
import threading
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.models.schemas import RunStatus, RunStatusResponse

# 2D models sub-cycle below the nominal routing step during wet periods.
_2D_SUBCYCLE_FACTOR = 3


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
            )

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


    def start(self, inp_path: Path, rpt_path: Path, out_path: Path) -> RunStatusResponse:
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
            self._future = self._executor.submit(
                self._run_job, inp_path, rpt_path, out_path
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

    def _run_job(self, inp_path: Path, rpt_path: Path, out_path: Path) -> None:
        try:
            # Release any open *.2d.h5 handle so OpenSWMM can recreate the file (Windows locks).
            try:
                from app.services.twod_output_service import twod_output_service

                twod_output_service.invalidate()
            except Exception:
                pass

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
                MIN_UPDATE_INTERVAL_S = 0.25

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

                    if self._cancel.is_set():
                        self._set(
                            status=RunStatus.cancelled,
                            message="Cancelled by user",
                            progress=self._progress,
                            step_count=step_count,
                            expected_steps=expected_steps,
                        )
                        return

            # Ensure next results read picks up the new HDF5, not a stale handle.
            try:
                from app.services.twod_output_service import twod_output_service

                twod_output_service.invalidate()
            except Exception:
                pass

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
            tb = traceback.format_exc()
            self._set(
                status=RunStatus.failed,
                message="Simulation failed",
                error=f"{exc}\n{tb}",
                progress=self._progress,
            )


run_service = RunService()
