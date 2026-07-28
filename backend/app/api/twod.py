from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.models.schemas import (
    MeshGenerateRequest,
    MeshGenerateResponse,
    MeshPreviewResponse,
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
from app.services.twod_output_service import twod_output_service

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
