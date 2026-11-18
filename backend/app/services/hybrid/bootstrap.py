"""Auto-prepare hybrid domain, coupling, solver and sanitized INP."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.models.schemas import (
    HybridCoupling,
    HybridCouplingPoint,
    HybridSurface,
    HybridSurfaceInflow,
)
from app.services.hybrid.basilisk_runner import build_basilisk
from app.services.hybrid.coupling_model import load_coupling, save_coupling
from app.services.hybrid.inp_sanitize import (
    read_connect2d_nodes,
    surface_outlet_subcatchments,
    write_sanitized_inp_report,
)
from app.services.hybrid.surface_model import load_surface, save_surface
from app.services.inp_model_service import inp_model_service

AUTO_TAG = "auto-v2"
# Safety valve for absurdly large models; West Whiteland couples ~8k nodes.
MAX_AUTO_COUPLING = 50000
MIN_EXCHANGE_AREA = 1.0  # model length units² (1 ft² / 1 m²) floor


def _bbox_polygon_expanded(
    xs: list[float], ys: list[float], *, pad_frac: float = 0.1
) -> list[list[float]]:
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    dx = (xmax - xmin) * pad_frac
    dy = (ymax - ymin) * pad_frac
    if dx <= 0:
        dx = max(abs(xmin) * pad_frac, 10.0)
    if dy <= 0:
        dy = max(abs(ymin) * pad_frac, 10.0)
    x0, x1 = xmin - dx, xmax + dx
    y0, y1 = ymin - dy, ymax + dy
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


def _xsection_area(xs: dict[str, Any]) -> float:
    shape = str(xs.get("shape", "")).upper()
    g1 = float(xs.get("geom1") or 0.0)
    g2 = float(xs.get("geom2") or 0.0)
    barrels = max(1.0, float(xs.get("barrels") or 1.0))
    if shape in ("CIRCULAR", "FORCE_MAIN", "FILLED_CIRCULAR"):
        a = math.pi * g1 * g1 / 4.0
    elif g2 > 0:
        a = g1 * g2
    else:
        a = g1 * g1
    return a * barrels


def _node_exchange_areas(model: Any) -> dict[str, float]:
    """Largest connected conduit cross-section per node (model units²)."""
    out: dict[str, float] = {}
    for lid, c in model.conduits.items():
        xs = model.xsections.get(lid)
        if not xs:
            continue
        a = _xsection_area(xs)
        for nid in (c.get("from_node"), c.get("to_node")):
            if nid:
                out[nid] = max(out.get(nid, 0.0), a)
    return out


def _centroid(ring: list[tuple[float, float]]) -> tuple[float, float]:
    if len(ring) < 3:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        cr = x0 * y1 - x1 * y0
        a += cr
        cx += (x0 + x1) * cr
        cy += (y0 + y1) * cr
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys)
    return cx / (3 * a), cy / (3 * a)


def build_auto_coupling(model: Any, raw_text: str) -> HybridCoupling:
    """Couple PCSWMM 'Connect2D' nodes if tagged, else every junction/storage.

    Subcatchments draining to '*' become surface inflows at their centroid.
    """
    tagged = read_connect2d_nodes(raw_text)
    if tagged:
        candidates = sorted(n for n in tagged if n in model.junctions or n in model.storage)
    else:
        candidates = sorted(set(model.junctions) | set(model.storage))
    areas = _node_exchange_areas(model)
    points: list[HybridCouplingPoint] = []
    for nid in candidates:
        xy = model.coordinates.get(nid)
        if xy is None:
            continue
        points.append(
            HybridCouplingPoint(
                node_id=nid,
                x=float(xy[0]),
                y=float(xy[1]),
                cd=0.67,
                exchange_area=max(MIN_EXCHANGE_AREA, round(areas.get(nid, 0.0), 4)),
            )
        )
        if len(points) >= MAX_AUTO_COUPLING:
            break

    inflows: list[HybridSurfaceInflow] = []
    for sid in surface_outlet_subcatchments(raw_text):
        ring = model.polygons.get(sid) or []
        if ring:
            x, y = _centroid(list(ring))
        else:
            continue
        inflows.append(HybridSurfaceInflow(subcatchment_id=sid, x=x, y=y))
    return HybridCoupling(points=points, surface_inflows=inflows, generated_by=AUTO_TAG)


TARGET_CELL_M = 15.0  # finest auto cell size: PCSWMM-like urban 2D meshes are ~10-25 m


def auto_max_level(project_root: Path, inp_path: Path, ring: list[list[float]]) -> int:
    """Finest AMR level giving ~TARGET_CELL_M cells over the square domain."""
    from app.services.hybrid.surface_prep import resolve_units

    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    try:
        f = resolve_units(project_root, inp_path).xy_to_m
    except Exception:
        f = 1.0
    size_m = max(max(xs) - min(xs), max(ys) - min(ys), 1.0) * f
    level = int(round(math.log2(max(size_m / TARGET_CELL_M, 1.0))))
    return max(7, min(11, level))


def bootstrap_hybrid(project_root: Path, inp_path: Path) -> dict[str, Any]:
    """
    Idempotent prep: domain from network bbox if missing; (re)generate coupling
    unless hand-edited; resolve the Basilisk solver; write the sanitized INP.
    """
    if not inp_path.is_file():
        raise HTTPException(status_code=400, detail=f"INP not found: {inp_path}")

    model = inp_model_service.load(inp_path)
    raw = inp_path.read_text(encoding="utf-8", errors="replace")
    surface = load_surface(project_root)
    coupling = load_coupling(project_root)

    domain_auto = False
    ring = list(surface.domain_polygon or [])
    if len(ring) < 3:
        if not model.coordinates:
            raise HTTPException(
                status_code=400,
                detail="Cannot auto-build hybrid domain: INP has no COORDINATES",
            )
        xs = [float(c[0]) for c in model.coordinates.values()]
        ys = [float(c[1]) for c in model.coordinates.values()]
        data = surface.model_dump()
        ring = _bbox_polygon_expanded(xs, ys)
        data["domain_polygon"] = ring
        data["max_level"] = auto_max_level(project_root, inp_path, ring)
        data["min_level"] = min(int(data.get("min_level") or 5), data["max_level"] - 2)
        data["notes"] = surface.notes or "Auto domain from network bbox (+10%)"
        surface = HybridSurface.model_validate(data)
        save_surface(project_root, surface)
        domain_auto = True

    coupling_auto = False
    if coupling.generated_by != "user" or not coupling.points:
        coupling = build_auto_coupling(model, raw)
        if not coupling.points:
            raise HTTPException(
                status_code=400,
                detail="Cannot auto-couple: no junction/storage nodes with coordinates",
            )
        save_coupling(project_root, coupling)
        coupling_auto = True

    build = build_basilisk(project_root, surface, coupling)
    used_stub = bool(build.get("used_stub"))
    coupled_junctions = [p.node_id for p in coupling.points if p.node_id in model.junctions]
    _path, report = write_sanitized_inp_report(
        project_root, inp_path, zero_surcharge_nodes=coupled_junctions
    )

    parts = []
    if domain_auto:
        parts.append("domain from network bbox")
    parts.append(
        f"{len(coupling.points)} coupled nodes"
        + (" (auto)" if coupling_auto else "")
    )
    if coupling.surface_inflows:
        parts.append(f"{len(coupling.surface_inflows)} subcatchments → 2D")
    if report.surcharge_zeroed:
        parts.append(f"SurDepth→0 on {report.surcharge_zeroed} coupled junctions")
    parts.append("stub 2D" if used_stub else build.get("message", "Basilisk"))
    message = "Hybrid prepared: " + "; ".join(parts)

    return {
        "ok": bool(build.get("ok", True)),
        "domain_auto": domain_auto,
        "coupling_count": len(coupling.points),
        "surface_inflow_count": len(coupling.surface_inflows),
        "used_stub": used_stub,
        "message": message,
        "build_log": build.get("log", ""),
    }
