from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.models.schemas import (
    MeshGenerateRequest,
    MeshGenerateResponse,
    MeshPreviewResponse,
    TwoDBoundariesResponse,
    TwoDBoundariesWriteRequest,
    TwoDInfo,
    TwoDMeshResponse,
    TwoDMetadata,
    TwoDPeriodsResponse,
    TwoDSnapshotResponse,
)
from app.services.inp_model_service import inp_model_service
from app.services.mesh_generate_service import mesh_generate_service
from app.services.project_service import project_service
from app.services.twod_mesh_service import twod_mesh_service
from app.services.twod_output_service import BinarySnapshot, twod_output_service


def _binary_response(snap: BinarySnapshot) -> Response:
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

router = APIRouter(prefix="/api/2d", tags=["2d"])


@router.get("/info", response_model=TwoDInfo)
def twod_info() -> TwoDInfo:
    inp = project_service.require_inp()
    return TwoDInfo(**twod_mesh_service.info(inp))


@router.get("/mesh", response_model=TwoDMeshResponse)
def twod_mesh(crs: Optional[str] = Query(default=None)) -> TwoDMeshResponse:
    inp = project_service.require_inp()
    code = crs or project_service.get_crs()
    payload = twod_mesh_service.mesh_payload(inp, crs=code)
    return TwoDMeshResponse(**payload)


@router.get("/boundaries", response_model=TwoDBoundariesResponse)
def twod_boundaries(crs: Optional[str] = Query(default=None)) -> TwoDBoundariesResponse:
    inp = project_service.require_inp()
    code = crs or project_service.get_crs()
    return TwoDBoundariesResponse(**twod_mesh_service.boundaries_payload(inp, crs=code))


@router.put("/boundaries", response_model=TwoDBoundariesResponse)
def twod_boundaries_write(body: TwoDBoundariesWriteRequest) -> TwoDBoundariesResponse:
    inp = project_service.require_inp()
    code = project_service.get_crs()
    payload = inp_model_service.write_2d_boundary_conditions(
        inp,
        [item.model_dump() for item in body.items],
        write_defaults=body.write_defaults,
    )
    payload["crs"] = code
    return TwoDBoundariesResponse(
        crs=code,
        geojson=payload["geojson"],
        count=payload["count"],
        bc_types=payload.get("bc_types", []),
    )


@router.get("/metadata", response_model=TwoDMetadata)
def twod_metadata() -> TwoDMetadata:
    h5 = project_service.twod_h5_path()
    out = project_service.out_path()
    return twod_output_service.metadata(h5, out_path=out if out.is_file() else None)


@router.get("/periods", response_model=TwoDPeriodsResponse)
def twod_periods() -> TwoDPeriodsResponse:
    h5 = project_service.twod_h5_path()
    return twod_output_service.periods(h5)


@router.get("/snapshot", response_model=TwoDSnapshotResponse)
def twod_snapshot(
    period: int = Query(0, ge=0),
    variable: str = Query("depth"),
) -> TwoDSnapshotResponse:
    h5 = project_service.twod_h5_path()
    return twod_output_service.snapshot(h5, period, variable=variable)


@router.get("/envelope", response_model=TwoDSnapshotResponse)
def twod_envelope(variable: str = Query("depth")) -> TwoDSnapshotResponse:
    """Per-triangle max-over-time (Mesh2_face_max_depth when available)."""
    h5 = project_service.twod_h5_path()
    return twod_output_service.envelope(h5, variable=variable)


@router.get("/snapshot/binary")
def twod_snapshot_binary(
    period: int = Query(0, ge=0),
    variable: str = Query("depth"),
) -> Response:
    """Raw little-endian float32 × n_faces for large-mesh clients."""
    h5 = project_service.twod_h5_path()
    return _binary_response(
        twod_output_service.snapshot_binary(h5, period, variable=variable)
    )


@router.get("/envelope/binary")
def twod_envelope_binary(variable: str = Query("depth")) -> Response:
    """Raw little-endian float32 max-over-time per face."""
    h5 = project_service.twod_h5_path()
    return _binary_response(twod_output_service.envelope_binary(h5, variable=variable))


def _build_from_request(body: MeshGenerateRequest):
    poly_pts = None
    if body.polygon:
        from app.services.mesh_generate_service import normalize_polygon, polygon_bbox

        poly_pts = normalize_polygon(body.polygon)
        minx, miny, maxx, maxy = polygon_bbox(poly_pts)
    elif body.bbox is not None:
        minx, miny = body.bbox.minx, body.bbox.miny
        maxx, maxy = body.bbox.maxx, body.bbox.maxy
    else:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400, detail="Provide polygon and/or bbox for the mesh AOI"
        )

    return mesh_generate_service.build(
        minx=minx,
        miny=miny,
        maxx=maxx,
        maxy=maxy,
        cell_size=body.cell_size,
        mannings_n=body.mannings_n,
        dem_layer_id=body.dem_layer_id,
        constant_z=body.constant_z,
        polygon=poly_pts,
    )


@router.post("/mesh/preview", response_model=MeshPreviewResponse)
def mesh_preview(body: MeshGenerateRequest) -> MeshPreviewResponse:
    project_service.require_inp()
    mesh = _build_from_request(body)
    payload = mesh_generate_service.preview_payload(mesh, crs=project_service.get_crs())
    return MeshPreviewResponse(**payload)


@router.post("/mesh/generate", response_model=MeshGenerateResponse)
def mesh_generate(body: MeshGenerateRequest) -> MeshGenerateResponse:
    inp = project_service.require_inp()
    mesh = _build_from_request(body)
    written = inp_model_service.write_2d_mesh(
        inp,
        vertices=mesh.vertices,
        triangles=mesh.triangles,
        replace=body.replace,
    )
    info = TwoDInfo(**twod_mesh_service.info(inp))
    mesh_payload = TwoDMeshResponse(
        **twod_mesh_service.mesh_payload(inp, crs=project_service.get_crs())
    )
    return MeshGenerateResponse(
        info=info,
        mesh=mesh_payload,
        warnings=mesh.warnings,
        written=written,
    )
