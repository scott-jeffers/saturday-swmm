"""EPA SWMM 5 runs through PySWMM (standalone 1D engine).

Runs the project's INP with the EPA SWMM 5.2 engine bundled in PySWMM's
``swmm-toolkit``. Content EPA SWMM cannot parse (OpenSWMM ``[2D_*]`` sections,
``[END]``, PCSWMM ``*`` outlets) is removed into a temporary copy written next
to the original, so relative file paths (rain files, time series) resolve the
same way. Results go to the project's normal ``.rpt`` / ``.out`` — the binary
output is SWMM 5 format, which the OutputReader used for results reads as-is.
"""

from __future__ import annotations

import threading
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.models.schemas import LiveSnapshotResponse, RunStatus, RunStatusResponse
from app.services.run_service import _minmax, _release_output_files

ENGINE = "pyswmm"
MIN_UPDATE_INTERVAL_S = 0.25
MIN_LIVE_INTERVAL_S = 0.5
# Python-side stride: advance the engine this many simulated seconds per loop.
# Keeps per-step Python overhead low on long continuous simulations.
MAX_ADVANCE_S = 300.0


def pyswmm_info() -> dict[str, Any]:
    """Version / availability of PySWMM and the EPA SWMM engine it bundles."""
    try:
        import pyswmm  # type: ignore
    except Exception as exc:
        return {"installed": False, "version": None, "swmm_version": None, "error": str(exc)}
    swmm_version = None
    try:
        from swmm.toolkit import solver  # type: ignore

        v = int(solver.swmm_get_version())  # e.g. 52004 -> 5.2.4
        swmm_version = f"{v // 10000}.{(v // 1000) % 10}.{v % 1000}"
    except Exception:
        pass
    return {
        "installed": True,
        "version": getattr(pyswmm, "__version__", None),
        "swmm_version": swmm_version,
        "error": None,
    }


def prepare_epa_inp(inp_path: Path) -> tuple[Path, list[str]]:
    """Write an EPA-SWMM-parseable copy of ``inp_path`` beside it.

    Returns ``(path, notes)`` where notes describe anything that was removed
    or changed (surfaced to the user in the run message).
    """
    from app.services.fs_utils import atomic_write_text
    from app.services.epa_inp import sanitize_for_pyswmm

    from app.services.lid_reports import with_lid_reports

    text = inp_path.read_text(encoding="utf-8", errors="replace")
    # LID units get report files (their own time series), as with OpenSWMM.
    text, _ = with_lid_reports(text, inp_path)
    body, report = sanitize_for_pyswmm(text, drop_graphics=True)
    notes: list[str] = []
    twod = [s for s in report.removed_sections if s.startswith("2D_")]
    if twod:
        notes.append("2D overland sections ignored (EPA SWMM 5 is 1D only)")
    if report.surface_subcatchments:
        notes.append(
            f"{len(report.surface_subcatchments)} subcatchment(s) with outlet '*' "
            "routed to a dummy outfall"
        )
    target = inp_path.with_name(f".{inp_path.stem}.epa-swmm5.inp")
    atomic_write_text(target, body)
    return target, notes


class PySwmmRunService:
    """Background PySWMM runner with the same contract as ``RunService``."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pyswmm-run")
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
        self._live_rendering = False
        self._live_snapshot: Optional[LiveSnapshotResponse] = None

    # ----------------------------------------------------------------- state
    def status(self) -> RunStatusResponse:
        with self._lock:
            return RunStatusResponse(
                status=self._status,
                engine=ENGINE,
                progress=self._progress,
                message=self._message,
                error=self._error,
                inp_path=self._inp_path,
                rpt_path=self._rpt_path,
                out_path=self._out_path,
                step_count=self._step_count,
                expected_steps=None,
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

    def _set(self, **kw: Any) -> None:
        with self._lock:
            for key, value in kw.items():
                if value is not None:
                    setattr(self, f"_{key}", value)

    # ------------------------------------------------------------ lifecycle
    def start(
        self,
        inp_path: Path,
        rpt_path: Path,
        out_path: Path,
        *,
        live_rendering: bool = False,
    ) -> RunStatusResponse:
        if not pyswmm_info()["installed"]:
            raise HTTPException(
                status_code=503,
                detail="PySWMM is not installed in this backend (pip install pyswmm).",
            )
        with self._lock:
            if self._status == RunStatus.running:
                raise HTTPException(status_code=409, detail="A run is already in progress")
            self._cancel.clear()
            self._status = RunStatus.running
            self._progress = 0.0
            self._message = "Starting EPA SWMM 5"
            self._error = None
            self._step_count = 0
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

    # ------------------------------------------------------------------ job
    @staticmethod
    def _snapshot(sim: Any, nodes: list, links: list, subs: list) -> LiveSnapshotResponse:
        node_depths = [round(float(n.depth), 4) for n in nodes]
        link_flows = [round(abs(float(link.flow)), 4) for link in links]
        sub_runoffs = [round(abs(float(s.runoff)), 4) for s in subs]
        dmin, dmax = _minmax(node_depths)
        fmin, fmax = _minmax(link_flows)
        rmin, rmax = _minmax(sub_runoffs)
        return LiveSnapshotResponse(
            available=True,
            time=sim.current_time.strftime("%Y-%m-%dT%H:%M:%S"),
            node_ids=[n.nodeid for n in nodes],
            link_ids=[link.linkid for link in links],
            subcatchment_ids=[s.subcatchmentid for s in subs],
            node_depths=node_depths,
            link_flows=link_flows,
            subcatchment_runoffs=sub_runoffs,
            node_depth_min=dmin,
            node_depth_max=dmax,
            link_flow_min=fmin,
            link_flow_max=fmax,
            subcatchment_runoff_min=rmin,
            subcatchment_runoff_max=rmax,
        )

    def _run_job(
        self, inp_path: Path, rpt_path: Path, out_path: Path, live_rendering: bool
    ) -> None:
        epa_inp: Optional[Path] = None
        steps = 0
        try:
            _release_output_files(inp_path, out_path, rpt_path)
            self._set(message="Preparing EPA SWMM 5 input")
            epa_inp, notes = prepare_epa_inp(inp_path)
            note_txt = f" ({'; '.join(notes)})" if notes else ""

            from pyswmm import Links, Nodes, Simulation, Subcatchments  # type: ignore

            with Simulation(str(epa_inp), str(rpt_path), str(out_path)) as sim:
                # ~2000 progress updates per run, between 10 s and 5 min of sim time
                total_s = max((sim.end_time - sim.start_time).total_seconds(), 1.0)
                advance = min(MAX_ADVANCE_S, max(10.0, total_s / 2000.0))
                sim.step_advance(int(advance))

                nodes: list = []
                links: list = []
                subs: list = []
                if live_rendering:
                    nodes, links, subs = list(Nodes(sim)), list(Links(sim)), list(Subcatchments(sim))

                last_update = last_live = 0.0
                self._set(message=f"Running EPA SWMM 5{note_txt}")
                for _ in sim:
                    steps += 1
                    now = time.monotonic()
                    if now - last_update >= MIN_UPDATE_INTERVAL_S:
                        last_update = now
                        pct = min(99.0, float(sim.percent_complete) * 100.0)
                        clock = sim.current_time.strftime("%Y-%m-%d %H:%M:%S")
                        self._set(
                            progress=pct,
                            message=f"EPA SWMM 5 · {clock}{note_txt}",
                            step_count=steps,
                        )
                    if live_rendering and now - last_live >= MIN_LIVE_INTERVAL_S:
                        last_live = now
                        try:
                            snap = self._snapshot(sim, nodes, links, subs)
                            with self._lock:
                                if self._status == RunStatus.running:
                                    self._live_snapshot = snap
                        except Exception:
                            pass
                    if self._cancel.is_set():
                        break

            cancelled = self._cancel.is_set()
            self._invalidate_readers()
            with self._lock:
                self._live_rendering = False
                self._live_snapshot = None
            if cancelled:
                self._set(status=RunStatus.cancelled, message="Cancelled by user", step_count=steps)
            else:
                self._set(
                    status=RunStatus.completed,
                    progress=100.0,
                    message=f"EPA SWMM 5 simulation completed{note_txt}",
                    step_count=steps,
                )
        except Exception as exc:
            self._invalidate_readers()
            with self._lock:
                self._live_rendering = False
                self._live_snapshot = None
            detail = str(exc).strip() or type(exc).__name__
            hint = ""
            if "ERROR" in detail and rpt_path.is_file():
                hint = "\n\nSee the report (.rpt) for the line EPA SWMM 5 rejected."
            self._set(
                status=RunStatus.failed,
                message="EPA SWMM 5 simulation failed",
                error=f"{detail}{hint}\n{traceback.format_exc()}",
            )
        finally:
            if epa_inp is not None:
                try:
                    epa_inp.unlink()
                except OSError:
                    pass

    @staticmethod
    def _invalidate_readers() -> None:
        try:
            from app.services.output_service import output_service

            output_service.invalidate()
        except Exception:
            pass


pyswmm_run_service = PySwmmRunService()

