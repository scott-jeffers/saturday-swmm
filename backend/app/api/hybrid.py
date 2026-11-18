"""REST API for PySWMM + Basilisk hybrid surface modeling."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.models.schemas import (
    HybridBootstrapResponse,
    HybridBuildResponse,
    HybridCapabilities,
    HybridCoupling,
    HybridInfo,
    HybridSurface,
)
from app.services.hybrid.basilisk_runner import (
    build_basilisk,
    build_log_tail,
    has_native_binary,
    source_exists,
)
from app.services.hybrid.bootstrap import bootstrap_hybrid
from app.services.hybrid.capabilities import probe_hybrid_capabilities
from app.services.hybrid.coupling_model import load_coupling, save_coupling
from app.services.hybrid.hybrid_output_service import hybrid_output_service
from app.services.hybrid.hybrid_raster_export import export_flood_rasters
from app.services.hybrid.paths import hybrid_results_path
from app.services.hybrid.surface_model import load_surface, save_surface
from app.services.project_service import project_service

router = APIRouter(prefix="/api/hybrid", tags=["hybrid"])


@router.get("/capabilities", response_model=HybridCapabilities)
def hybrid_capabilities() -> HybridCapabilities:
    return HybridCapabilities(**probe_hybrid_capabilities())


@router.get("/info", response_model=HybridInfo)
def hybrid_info() -> HybridInfo:
    root = project_service.require_root()
    surface = load_surface(root)
    coupling = load_coupling(root)
    has_surface = bool(surface.domain_polygon)
    has_coupling = len(coupling.points) > 0
    has_build = source_exists(root) or has_native_binary(root)
    has_results = hybrid_results_path(root).is_file()
    return HybridInfo(
        simulation_engine=project_service.get_simulation_engine(),  # type: ignore[arg-type]
        has_surface=has_surface,
        has_coupling=has_coupling,
        coupling_count=len(coupling.points),
        has_basilisk_build=has_build,
        has_results=has_results,
        surface=surface if has_surface or (surface.dem_layer_id or surface.mannings_n) else surface,
        coupling=coupling,
        build_log_tail=build_log_tail(root),
        capabilities=HybridCapabilities(**probe_hybrid_capabilities()),
    )


@router.get("/surface", response_model=HybridSurface)
def get_surface() -> HybridSurface:
    return load_surface(project_service.require_root())


@router.put("/surface", response_model=HybridSurface)
def put_surface(body: HybridSurface) -> HybridSurface:
    return save_surface(project_service.require_root(), body)


@router.get("/coupling", response_model=HybridCoupling)
def get_coupling() -> HybridCoupling:
    return load_coupling(project_service.require_root())


@router.put("/coupling", response_model=HybridCoupling)
def put_coupling(body: HybridCoupling) -> HybridCoupling:
    # Hand-edited couplings are kept as-is by auto-prep (not regenerated).
    body.generated_by = "user"
    return save_coupling(project_service.require_root(), body)


@router.post("/basilisk/build", response_model=HybridBuildResponse)
def basilisk_build() -> HybridBuildResponse:
    root = project_service.require_root()
    surface = load_surface(root)
    coupling = load_coupling(root)
    result = build_basilisk(root, surface, coupling)
    return HybridBuildResponse(**result)


@router.post("/bootstrap", response_model=HybridBootstrapResponse)
def hybrid_bootstrap() -> HybridBootstrapResponse:
    """Auto domain/coupling/build/sanitize so hybrid Run works without manual forms."""
    root = project_service.require_root()
    inp = project_service.require_inp()
    result = bootstrap_hybrid(root, inp)
    return HybridBootstrapResponse(**result)


@router.get("/metadata")
def hybrid_metadata() -> dict:
    root = project_service.require_root()
    return hybrid_output_service.metadata(root)


@router.get("/periods")
def hybrid_periods() -> dict:
    root = project_service.require_root()
    return hybrid_output_service.periods(root)


@router.get("/mesh")
def hybrid_mesh() -> dict:
    root = project_service.require_root()
    compact = hybrid_output_service.compact_mesh(root)
    return {
        "crs": project_service.get_crs(),
        "vertices": compact.get("vertices"),
        "triangles": compact.get("triangles"),
        "counts": compact.get("counts"),
        "nx": compact.get("nx"),
        "ny": compact.get("ny"),
        "cell_count": compact.get("cell_count"),
        "engine": "hybrid",
        "geojson": {"type": "FeatureCollection", "features": []},
    }


def _binary_snapshot_response(snap) -> Response:
    return Response(
        content=snap.body,
        media_type="application/octet-stream",
        headers={
            "X-Triangle-Count": str(snap.triangle_count),
            "X-Period": str(snap.period),
            "X-Value-Min": f"{snap.value_min:.6g}",
            "X-Value-Max": f"{snap.value_max:.6g}",
            "X-Variable": snap.variable,
            "X-Unit": snap.unit,
            "X-Time": snap.time or "",
            "Access-Control-Expose-Headers": (
                "X-Triangle-Count, X-Period, X-Value-Min, X-Value-Max, "
                "X-Variable, X-Unit, X-Time"
            ),
        },
    )


@router.get("/snapshot/binary")
def hybrid_snapshot_binary(
    period: int = Query(0, ge=0),
    variable: str = Query("depth"),
) -> Response:
    root = project_service.require_root()
    snap = hybrid_output_service.snapshot_binary(root, period, variable=variable)
    return _binary_snapshot_response(snap)


@router.get("/envelope/binary")
def hybrid_envelope_binary(variable: str = Query("depth")) -> Response:
    """Per-cell max-over-time depth from results.npz ``max_depth``."""
    root = project_service.require_root()
    try:
        snap = hybrid_output_service.envelope_binary(root, variable=variable)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _binary_snapshot_response(snap)


@router.post("/export-rasters")
def hybrid_export_rasters() -> dict:
    """Resample peak flood depth onto the DEM grid; write GeoTIFFs under hybrid/export/."""
    root = project_service.require_root()
    try:
        return export_flood_rasters(root)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
