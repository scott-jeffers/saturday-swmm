from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    IdList,
    OutEnvelopeResponse,
    OutMetadata,
    OutPeriodsResponse,
    OutSnapshotResponse,
    RptContent,
    TimeSeriesResponse,
    VariableListResponse,
)
from app.services.output_service import output_service
from app.services.project_service import project_service

router = APIRouter(prefix="/api", tags=["results"])

ObjectKind = Literal["node", "link", "subcatchment"]


@router.get("/rpt", response_model=RptContent)
def get_rpt() -> RptContent:
    rpt = project_service.rpt_path()
    if not rpt.is_file():
        raise HTTPException(
            status_code=404, detail=f"Report file not found: {rpt}. Run a simulation first."
        )
    return RptContent(
        text=rpt.read_text(encoding="utf-8", errors="replace"),
        path=str(rpt),
    )


@router.get("/out/metadata", response_model=OutMetadata)
def out_metadata() -> OutMetadata:
    return output_service.metadata(project_service.out_path())


@router.get("/out/nodes", response_model=IdList)
def out_nodes() -> IdList:
    return output_service.list_nodes(project_service.out_path())


@router.get("/out/links", response_model=IdList)
def out_links() -> IdList:
    return output_service.list_links(project_service.out_path())


@router.get("/out/subcatchments", response_model=IdList)
def out_subcatchments() -> IdList:
    return output_service.list_subcatchments(project_service.out_path())


@router.get("/out/variables", response_model=VariableListResponse)
def out_variables(
    kind: ObjectKind = Query(..., description="node | link | subcatchment"),
) -> VariableListResponse:
    return output_service.list_variables(project_service.out_path(), kind)


@router.get("/out/nodes/{node_id}/series", response_model=TimeSeriesResponse)
def node_series(
    node_id: str,
    variable: str | None = Query(None, description="Output variable id, e.g. depth"),
) -> TimeSeriesResponse:
    return output_service.node_series(project_service.out_path(), node_id, variable)


@router.get("/out/links/{link_id}/series", response_model=TimeSeriesResponse)
def link_series(
    link_id: str,
    variable: str | None = Query(None, description="Output variable id, e.g. flow"),
) -> TimeSeriesResponse:
    return output_service.link_series(project_service.out_path(), link_id, variable)


@router.get("/out/subcatchments/{sub_id}/series", response_model=TimeSeriesResponse)
def subcatchment_series(
    sub_id: str,
    variable: str | None = Query(None, description="Output variable id, e.g. runoff"),
) -> TimeSeriesResponse:
    return output_service.subcatchment_series(project_service.out_path(), sub_id, variable)


@router.get("/out/periods", response_model=OutPeriodsResponse)
def out_periods() -> OutPeriodsResponse:
    return output_service.periods(project_service.out_path())


@router.get("/out/snapshot", response_model=OutSnapshotResponse)
def out_snapshot(period: int = Query(0, ge=0)) -> OutSnapshotResponse:
    return output_service.snapshot_response(project_service.out_path(), period)


@router.get("/out/envelope", response_model=OutEnvelopeResponse)
def out_envelope() -> OutEnvelopeResponse:
    """Per-element max-over-time (depth / |flow| / |runoff|)."""
    return output_service.envelope_response(project_service.out_path())
