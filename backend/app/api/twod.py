from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import (
    TwoDInfo,
    TwoDMeshResponse,
    TwoDMetadata,
    TwoDPeriodsResponse,
    TwoDSnapshotResponse,
)
from app.services.project_service import project_service
from app.services.twod_mesh_service import twod_mesh_service
from app.services.twod_output_service import twod_output_service

router = APIRouter(prefix="/api/2d", tags=["2d"])


@router.get("/info", response_model=TwoDInfo)
def twod_info() -> TwoDInfo:
    inp = project_service.require_inp()
    return TwoDInfo(**twod_mesh_service.info(inp))


@router.get("/mesh", response_model=TwoDMeshResponse)
def twod_mesh(crs: str = Query(default="EPSG:25832")) -> TwoDMeshResponse:
    inp = project_service.require_inp()
    payload = twod_mesh_service.mesh_payload(inp, crs=crs)
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
