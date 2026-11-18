"""Co-simulation: PySWMM 1D + Basilisk (or stub) 2D surface."""

from __future__ import annotations

import json
import math
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

import numpy as np

from fastapi import HTTPException

from app.models.schemas import LiveSnapshotResponse, RunStatus, RunStatusResponse
from app.services.hybrid.basilisk_ipc import SurfaceConfig, write_inputs
from app.services.hybrid.basilisk_runner import (
    create_stub_state,
    resolve_surface_solver,
    surface_workdir,
)
from app.services.hybrid.bootstrap import bootstrap_hybrid
from app.services.hybrid.capabilities import probe_hybrid_capabilities
from app.services.hybrid.coupled_engine import (
    CoupledNode,
    EngineOptions,
    SurfaceInflow,
    run_coupled,
)
from app.services.hybrid.coupling_model import load_coupling
from app.services.hybrid.hybrid_output_service import hybrid_output_service
from app.services.hybrid.paths import flux_log_path, hybrid_summary_path, sanitized_inp_path
from app.services.hybrid.surface_model import load_surface
from app.services.hybrid.surface_prep import (
    dem_z_to_m,
    find_dem,
    prepare_dem_bin,
    resolve_units,
    square_domain,
)


class HybridRunService:
    """Background hybrid runner (shares RunStatusResponse shape with OpenSWMM)."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hybrid-run")
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

    def cancel(self) -> RunStatusResponse:
        with self._lock:
            if self._status == RunStatus.running:
                self._cancel.set()
                self._message = "Cancel requested…"
            return self.status()

    def start(
        self,
        project_root: Path,
        inp_path: Path,
        rpt_path: Path,
        out_path: Path,
        *,
        live_rendering: bool = False,
    ) -> RunStatusResponse:
        caps = probe_hybrid_capabilities()
        if not caps.get("pyswmm_ok"):
            raise HTTPException(
                status_code=400,
                detail="PySWMM is not installed. pip install pyswmm (and set SWMM_DLL if needed).",
            )

        with self._lock:
            if self._status == RunStatus.running:
                raise HTTPException(status_code=409, detail="A run is already in progress")

            self._cancel.clear()
            self._status = RunStatus.running
            self._progress = 0.0
            self._message = "Starting hybrid (PySWMM + Basilisk)…"
            self._error = None
            self._inp_path = str(inp_path)
            self._rpt_path = str(rpt_path)
            self._out_path = str(out_path)
            self._step_count = 0
            self._expected_steps = None
            self._live_rendering = bool(live_rendering)
            self._live_snapshot = None

            self._future = self._executor.submit(
                self._run_job,
                project_root,
                inp_path,
                rpt_path,
                out_path,
                live_rendering,
            )
            return self.status()

    def _set(
        self,
        *,
        progress: Optional[float] = None,
        message: Optional[str] = None,
        step_count: Optional[int] = None,
        expected_steps: Optional[int] = None,
        live: Optional[LiveSnapshotResponse] = None,
    ) -> None:
        with self._lock:
            if progress is not None:
                self._progress = progress
            if message is not None:
                self._message = message
            if step_count is not None:
                self._step_count = step_count
            if expected_steps is not None:
                self._expected_steps = expected_steps
            if live is not None:
                self._live_snapshot = live

    def _run_job(
        self,
        project_root: Path,
        inp_path: Path,
        rpt_path: Path,
        out_path: Path,
        live_rendering: bool,
    ) -> None:
        try:
            self._set(message="Preparing hybrid (domain / coupling / solver)…", progress=1.0)
            bootstrap_hybrid(project_root, inp_path)
            surface = load_surface(project_root)
            coupling = load_coupling(project_root)
            sanitized = sanitized_inp_path(project_root)

            solver, _log = resolve_surface_solver()
            dem_path = find_dem(project_root, surface) if solver else None
            if solver is not None and dem_path is None:
                self._set(message="No DEM layer found — Basilisk needs a DEM; using stub 2D…")
            if solver is not None and dem_path is not None:
                summary = self._run_basilisk(
                    project_root, inp_path, sanitized, surface, coupling, solver, dem_path
                )
                if summary is None:  # cancelled
                    return
                engine_desc = f"Basilisk ({solver.description})"
            else:
                steps = self._run_stub(project_root, sanitized, surface, coupling, live_rendering)
                if steps is None:
                    return
                summary = {"steps": steps}
                engine_desc = "stub 2D (no Basilisk solver/DEM)"

            self._copy_reports(sanitized, rpt_path, out_path)

            with self._lock:
                self._status = RunStatus.completed
                self._progress = 100.0
                mass = summary.get("mass") or {}
                extra = ""
                if mass:
                    extra = (
                        f"; 2D in {mass.get('flood_to_2d_m3', 0) + mass.get('runoff_to_2d_m3', 0):,.0f} m³"
                        f", drained {mass.get('drained_from_2d_m3', 0):,.0f} m³"
                        f", 2D mass error {mass.get('error_pct', 0):.3f}%"
                    )
                self._message = f"Hybrid completed — {engine_desc}{extra}"
                self._error = None
                self._step_count = int(summary.get("steps") or 0)

        except Exception as exc:
            with self._lock:
                self._status = RunStatus.failed
                self._error = str(exc)
                self._message = "Hybrid run failed"
                self._progress = 0.0
            traceback.print_exc()

    # -- real Basilisk surface ------------------------------------------------
    def _run_basilisk(
        self,
        project_root: Path,
        inp_path: Path,
        sanitized: Path,
        surface: Any,
        coupling: Any,
        solver: Any,
        dem_path: Path,
    ) -> Optional[dict]:
        units = resolve_units(project_root, inp_path)
        domain = square_domain(surface)
        level = int(surface.max_level)
        min_level = max(2, min(int(surface.min_level), level))
        workdir = surface_workdir(project_root)
        L_m = domain.size * units.xy_to_m

        self._set(message=f"Resampling DEM to {1 << level}² grid ({L_m / (1 << level):.1f} m cells)…",
                  progress=3.0)
        prepare_dem_bin(workdir, dem_path, domain, level, units.crs, dem_z_to_m(surface, units))
        dem = np.fromfile(workdir / "dem.bin", dtype=np.float32).reshape(1 << level, 1 << level)
        dem = np.where(dem >= 1e19, np.nan, dem)

        nodes = [
            CoupledNode(
                node_id=p.node_id,
                x=domain.to_local(p.x, p.y, units.xy_to_m)[0],
                y=domain.to_local(p.x, p.y, units.xy_to_m)[1],
                cd=float(p.cd),
                area_m2=float(p.exchange_area) * units.len_to_m ** 2,
            )
            for p in coupling.points
        ]
        inflows = [
            SurfaceInflow(
                subcatchment_id=s.subcatchment_id,
                x=domain.to_local(s.x, s.y, units.xy_to_m)[0],
                y=domain.to_local(s.x, s.y, units.xy_to_m)[1],
            )
            for s in coupling.surface_inflows
        ]
        cfg = SurfaceConfig(
            L=L_m,
            min_level=min_level,
            max_level=level,
            dem_level=level,
            manning=float(surface.mannings_n),
            dry=float(surface.dry_depth),
            htol=float(surface.eta_tolerance),
            qtol=float(surface.discharge_tolerance),
            dtmax=5.0,
        )
        write_inputs(
            workdir, cfg, dem,
            [(n.x, n.y) for n in nodes] + [(s.x, s.y) for s in inflows],
            nodata_is_outflow=bool(surface.nodata_outflow),
        )

        opts = EngineOptions(
            coupling_interval=float(surface.coupling_interval),
            frame_interval=float(surface.frame_interval),
            frame_resolution=int(surface.frame_resolution),
            dry_depth=float(surface.dry_depth),
        )
        self._set(
            message=f"Hybrid routing — {len(nodes)} coupled nodes, "
                    f"{len(inflows)} surface inflows, Basilisk {solver.kind}…",
            progress=5.0,
        )

        def on_progress(pct: float, msg: str, steps: int) -> None:
            self._set(progress=5.0 + 0.94 * pct, message=msg, step_count=steps)

        result = run_coupled(
            sanitized_inp=sanitized,
            surface_cmd=solver.command,
            workdir=workdir,
            domain=domain,
            units=units,
            nodes=nodes,
            inflows=inflows,
            options=opts,
            progress=on_progress,
            cancelled=self._cancel.is_set,
            flux_log=flux_log_path(project_root),
        )
        if result.frames:
            nf = opts.frame_resolution
            hybrid_output_service.save_results(
                project_root,
                depths=np.asarray([f.ravel() for f in result.frames], dtype=np.float32),
                times=result.frame_times,
                nx=nf,
                ny=nf,
                xmin=domain.xmin,
                ymin=domain.ymin,
                xmax=domain.xmax,
                ymax=domain.ymax,
                max_depth=result.max_depth.ravel() if result.max_depth is not None else None,
            )
        summary = {
            "engine": "basilisk",
            "solver": solver.description,
            "steps": result.steps,
            "coupled_nodes": len(nodes),
            "surface_inflows": len(inflows),
            "domain_m": L_m,
            "cell_m_finest": L_m / (1 << level),
            "max_2d_cells": result.max_cells,
            "wall_s": result.wall_seconds,
            "swmm_s": result.swmm_seconds,
            "surface_s": result.surface_seconds,
            "mass": result.mass.to_dict(),
            "depth_unit": "m",
        }
        summary["cancelled"] = result.cancelled
        hybrid_summary_path(project_root).write_text(json.dumps(summary, indent=2), encoding="utf-8")
        if result.cancelled:
            # partial 2D frames were saved above, so they can still be inspected
            with self._lock:
                self._status = RunStatus.cancelled
                self._message = f"Cancelled — {len(result.frames)} 2D frames saved"
            return None
        return summary

    # -- fallback stub surface -----------------------------------------------
    def _run_stub(
        self,
        project_root: Path,
        sanitized: Path,
        surface: Any,
        coupling: Any,
        live_rendering: bool,
    ) -> Optional[int]:
        from pyswmm import Nodes, Simulation  # type: ignore

        stub = create_stub_state(surface, coupling)
        depth_frames: list[list[float]] = []
        time_labels: list[str] = []
        step_i = 0
        with Simulation(str(sanitized)) as sim:
            sim.step_advance(max(1, int(round(surface.coupling_interval))))
            nodes = Nodes(sim)
            objs = []
            for p in coupling.points:
                try:
                    objs.append(nodes[p.node_id])
                except Exception:
                    objs.append(None)
            total_s = max(1.0, (sim.end_time - sim.start_time).total_seconds())
            expected = int(math.ceil(total_s / float(surface.coupling_interval)))
            self._set(expected_steps=expected, message="Hybrid routing (stub 2D)…")
            prev = [0.0] * len(objs)
            t_prev = 0.0
            for _step in sim:
                if self._cancel.is_set():
                    with self._lock:
                        self._status = RunStatus.cancelled
                        self._message = "Cancelled"
                    return None
                t_now = (sim.current_time - sim.start_time).total_seconds()
                dt = max(t_now - t_prev, 1e-6)
                qs = []
                for k, o in enumerate(objs):
                    if o is None:
                        qs.append(0.0)
                        continue
                    cum = float(o.statistics["flooding_volume"])
                    qs.append(max(cum - prev[k], 0.0) / dt)
                    prev[k] = cum
                stub.step(dt, qs)
                store_every = max(1, expected // 200)
                if step_i % store_every == 0:
                    depth_frames.append(list(stub.depths))
                    time_labels.append(str(sim.current_time))
                step_i += 1
                t_prev = t_now
                self._set(
                    progress=min(99.0, 100.0 * t_now / total_s),
                    step_count=step_i,
                    message=f"Hybrid step {step_i} (stub 2D)",
                )
            sim.report()
        if depth_frames:
            hybrid_output_service.save_results(
                project_root,
                depths=np.asarray(depth_frames, dtype=np.float32),
                times=time_labels,
                nx=stub.nx, ny=stub.ny,
                xmin=stub.xmin, ymin=stub.ymin, xmax=stub.xmax, ymax=stub.ymax,
            )
        return step_i

    @staticmethod
    def _copy_reports(sanitized: Path, rpt_path: Path, out_path: Path) -> None:
        try:
            cand_rpt = sanitized.with_suffix(".rpt")
            if cand_rpt.is_file() and rpt_path != cand_rpt:
                rpt_path.write_bytes(cand_rpt.read_bytes())
            cand_out = sanitized.with_suffix(".out")
            if cand_out.is_file() and out_path != cand_out:
                out_path.write_bytes(cand_out.read_bytes())
        except Exception:
            pass


hybrid_run_service = HybridRunService()
