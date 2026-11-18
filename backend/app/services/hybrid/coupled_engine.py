"""Two-way PySWMM <-> Basilisk co-simulation loop (Option B: no rain-on-grid).

Per coupling interval [t0, t1]:

1. SWMM advances to t1. Water drained from the 2D surface in the previous
   interval is fed back into the coupled nodes as ``generated_inflow``
   (volume bookkeeping is exact: undelivered volume carries over).
2. For each coupled node we read SWMM's cumulative flooding volume: the
   increment over the interval is what overflowed the rim (SurDepth = 0 on
   coupled junctions) and goes onto the 2D surface.
3. Subcatchments whose outlet was ``*`` (PCSWMM "to 2D surface") put their
   runoff onto the 2D surface at their centroid.
4. Where the 2D surface is wet above a node whose head is below the 2D water
   level, we request drainage through an orifice (cd, area). Basilisk limits
   it to the water actually present and reports the achieved volume.
5. Basilisk advances [t0, t1] with all those sources.

Everything Basilisk sees is SI; SWMM stays in model units.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Sequence

import numpy as np

from app.services.hybrid.basilisk_ipc import BasiliskSurface, StepResult
from app.services.hybrid.surface_prep import Domain, Units

G_SI = 9.81


@dataclass
class CoupledNode:
    node_id: str
    x: float               # local metres
    y: float
    cd: float = 0.67
    area_m2: float = 0.093  # orifice area (≈1 ft²)


@dataclass
class SurfaceInflow:
    subcatchment_id: str
    x: float               # local metres
    y: float


@dataclass
class EngineOptions:
    coupling_interval: float = 10.0     # s
    frame_interval: float = 300.0       # s between stored depth frames
    frame_resolution: int = 384
    dry_depth: float = 1e-3             # m: no drainage below this
    max_drain_fraction: float = 0.9     # of cell volume per interval


@dataclass
class MassBalance:
    flood_to_2d_m3: float = 0.0
    runoff_to_2d_m3: float = 0.0
    drained_from_2d_m3: float = 0.0
    delivered_to_swmm_m3: float = 0.0
    boundary_loss_m3: float = 0.0
    stored_2d_m3: float = 0.0
    pending_to_swmm_m3: float = 0.0

    @property
    def error_m3(self) -> float:
        inflow = self.flood_to_2d_m3 + self.runoff_to_2d_m3
        out = self.drained_from_2d_m3 + self.boundary_loss_m3 + self.stored_2d_m3
        return inflow - out

    @property
    def error_pct(self) -> float:
        inflow = self.flood_to_2d_m3 + self.runoff_to_2d_m3
        return 100.0 * self.error_m3 / inflow if inflow > 0 else 0.0

    def to_dict(self) -> dict:
        d = dict(self.__dict__)
        d["error_m3"] = self.error_m3
        d["error_pct"] = self.error_pct
        return d


@dataclass
class EngineResult:
    steps: int
    frames: list[np.ndarray] = field(default_factory=list)
    frame_times: list[str] = field(default_factory=list)
    max_depth: Optional[np.ndarray] = None
    mass: MassBalance = field(default_factory=MassBalance)
    wall_seconds: float = 0.0
    swmm_seconds: float = 0.0
    surface_seconds: float = 0.0
    max_cells: int = 0
    cancelled: bool = False


def drain_requests(
    *,
    head: np.ndarray,          # SWMM node head [model len]
    flooding: np.ndarray,      # flood volume this interval (>0 means overflowing)
    depth_m: np.ndarray,       # 2D depth at node cell [m]
    bed_m: np.ndarray,         # 2D bed at node cell [m]
    cell_area_m2: np.ndarray,
    cd: np.ndarray,
    area_m2: np.ndarray,
    len_to_m: float,
    dt: float,
    dry: float,
    max_fraction: float,
) -> np.ndarray:
    """Requested drainage 2D -> pipe [m3/s] (>= 0), orifice law, volume-limited."""
    head_m = head * len_to_m
    wse = bed_m + depth_m
    wet = depth_m > dry
    below = head_m < wse
    # free inflow when the pipe head is under the ground, submerged otherwise
    dH = np.where(head_m <= bed_m, depth_m, wse - head_m)
    dH = np.clip(dH, 0.0, None)
    q = cd * area_m2 * np.sqrt(2.0 * G_SI * dH)
    qmax = max_fraction * depth_m * cell_area_m2 / max(dt, 1e-6)
    q = np.minimum(q, qmax)
    ok = wet & below & (flooding <= 0.0)
    return np.where(ok, q, 0.0)


def run_coupled(
    *,
    sanitized_inp: Path,
    surface_cmd: Sequence[str],
    workdir: Path,
    domain: Domain,
    units: Units,
    nodes: Sequence[CoupledNode],
    inflows: Sequence[SurfaceInflow],
    options: EngineOptions,
    progress: Optional[Callable[[float, str, int], None]] = None,
    cancelled: Optional[Callable[[], bool]] = None,
    flux_log: Optional[Path] = None,
) -> EngineResult:
    from pyswmm import Nodes, Simulation, Subcatchments  # type: ignore

    t_wall = time.time()
    res = EngineResult(steps=0)
    mass = res.mass
    n_nodes = len(nodes)
    n_src = n_nodes + len(inflows)
    q_conv = units.q_to_cms
    vol_conv = units.len_to_m ** 3         # SWMM volume (ft3 / m3) -> m3
    cd = np.array([n.cd for n in nodes], dtype=float)
    area = np.array([n.area_m2 for n in nodes], dtype=float)
    pending = np.zeros(n_nodes)            # m3 drained from 2D, owed to SWMM
    nf = int(options.frame_resolution)
    log_fh = flux_log.open("w", encoding="utf-8", buffering=1) if flux_log else None

    from app.services.hybrid.basilisk_runner import solver_child_env

    surf = BasiliskSurface(
        surface_cmd,
        workdir,
        n_src,
        env=solver_child_env(command=list(surface_cmd)),
    )
    try:
        with Simulation(str(sanitized_inp)) as sim:
            sim.step_advance(max(1, int(round(options.coupling_interval))))
            node_api = Nodes(sim)
            sub_api = Subcatchments(sim)
            node_objs = [node_api[n.node_id] for n in nodes]
            sub_objs = [sub_api[s.subcatchment_id] for s in inflows]
            total_s = max(1.0, (sim.end_time - sim.start_time).total_seconds())


            # initial 2D state (dry) + bed elevations at sources
            state: StepResult = surf.step(0.0, np.zeros(n_src))
            prev_flood_cum = np.zeros(n_nodes)
            prev_runoff = np.zeros(len(inflows))
            inflow_rate = np.zeros(n_nodes)      # SWMM units (flow)
            t_prev = 0.0
            next_frame = 0.0
            max_depth = np.zeros((nf, nf), dtype=np.float32)

            ts = time.time()
            for _ in sim:
                res.swmm_seconds += time.time() - ts
                if cancelled and cancelled():
                    res.cancelled = True
                    break
                t_now = (sim.current_time - sim.start_time).total_seconds()
                dt = t_now - t_prev
                if dt <= 0:
                    ts = time.time()
                    continue

                # (1) what SWMM actually received from 2D over [t_prev, t_now]
                delivered = inflow_rate * q_conv * dt
                pending -= delivered
                mass.delivered_to_swmm_m3 += float(delivered.sum())

                # (2) node flooding volumes over the interval (SWMM accounting)
                flood_cum = np.array(
                    [float(o.statistics["flooding_volume"]) for o in node_objs]
                )
                flood_v = np.clip(flood_cum - prev_flood_cum, 0.0, None) * vol_conv
                prev_flood_cum = flood_cum
                head = np.array([float(o.head) for o in node_objs])

                # (3) "*" subcatchment runoff (trapezoid over the interval)
                runoff = np.array([float(s.runoff) for s in sub_objs])
                runoff_v = 0.5 * (runoff + prev_runoff) * q_conv * dt
                prev_runoff = runoff

                # (4) drainage requests from the 2D state at t_prev
                q_drain = drain_requests(
                    head=head,
                    flooding=flood_v,
                    depth_m=state.depth[:n_nodes],
                    bed_m=state.bed[:n_nodes],
                    cell_area_m2=state.area[:n_nodes],
                    cd=cd,
                    area_m2=area,
                    len_to_m=units.len_to_m,
                    dt=dt,
                    dry=options.dry_depth,
                    max_fraction=options.max_drain_fraction,
                )

                rates = np.empty(n_src)
                rates[:n_nodes] = flood_v / dt - q_drain
                rates[n_nodes:] = runoff_v / dt

                # (5) advance Basilisk over the same interval
                t_s = time.time()
                state = surf.step(t_now, rates)
                res.surface_seconds += time.time() - t_s
                res.max_cells = max(res.max_cells, state.cells)

                achieved = state.volume[:n_nodes]
                drained = np.clip(-achieved, 0.0, None)
                mass.flood_to_2d_m3 += float(flood_v.sum())
                mass.runoff_to_2d_m3 += float(runoff_v.sum())
                mass.drained_from_2d_m3 += float(drained.sum())
                pending += drained

                # feed the drained volume back into SWMM over the next interval
                new_rate = pending / (options.coupling_interval * q_conv)
                changed = np.nonzero((new_rate != inflow_rate))[0]
                for k in changed:
                    node_objs[k].generated_inflow(float(new_rate[k]))
                inflow_rate = new_rate

                if log_fh is not None and (res.steps % 6 == 0):
                    log_fh.write(json.dumps({
                        "t": t_now,
                        "flood_m3": float(flood_v.sum()),
                        "runoff_m3": float(runoff_v.sum()),
                        "drained_m3": float(drained.sum()),
                        "cells": state.cells,
                        "solver_steps": state.solver_steps,
                    }) + "\n")

                if t_now >= next_frame - 1e-6:
                    frame, wet, vol, lost = surf.dump_depth(nf, nf)
                    res.frames.append(frame)
                    res.frame_times.append(str(sim.current_time))
                    np.maximum(max_depth, frame, out=max_depth)
                    mass.stored_2d_m3 = vol
                    mass.boundary_loss_m3 = lost
                    next_frame = t_now + options.frame_interval

                res.steps += 1
                t_prev = t_now
                if progress:
                    progress(
                        min(99.0, 100.0 * t_now / total_s),
                        f"Hybrid t={t_now/3600:.2f} h · {state.cells} 2D cells · "
                        f"2D vol {mass.stored_2d_m3:,.0f} m³",
                        res.steps,
                    )
                ts = time.time()

            # final state + mass
            frame, wet, vol, lost = surf.dump_depth(nf, nf)
            np.maximum(max_depth, frame, out=max_depth)
            if not res.frame_times or res.frame_times[-1] != str(sim.current_time):
                res.frames.append(frame)
                res.frame_times.append(str(sim.current_time))
            mass.stored_2d_m3 = vol
            mass.boundary_loss_m3 = lost
            mass.pending_to_swmm_m3 = float(pending.sum())
            res.max_depth = max_depth
            sim.report()
    finally:
        surf.close()
        if log_fh is not None:
            log_fh.close()
    res.wall_seconds = time.time() - t_wall
    return res
