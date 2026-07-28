from __future__ import annotations

import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

from app.models.schemas import RunStatus, RunStatusResponse


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
                step_count = 0
                self._set(message="Stepping simulation", progress=1.0)
                while solver.step():
                    if self._cancel.is_set():
                        self._set(
                            status=RunStatus.cancelled,
                            message="Cancelled by user",
                            progress=self._progress,
                        )
                        return
                    step_count += 1
                    progress = min(95.0, 5.0 + step_count * 0.05)
                    if step_count % 50 == 0:
                        self._set(progress=progress, message=f"Step {step_count}")

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
