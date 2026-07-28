from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Query

from app.models.schemas import (
    ApplyRaingageRequest,
    ApplyRaingageResponse,
    DeleteObjectResponse,
    FileRaingageRequest,
    FileRaingageResponse,
    LinkCreateRequest,
    ModelNetwork,
    ModelObjectPatch,
    ModelObjectResponse,
    NodeCreateRequest,
    ProfileResponse,
    RaingageInfo,
    SimulationWindow,
    SimulationWindowUpdate,
    SubcatchmentCreateRequest,
)
from app.services.inp_model_service import inp_model_service
from app.services.profile_service import profile_service
from app.services.project_service import project_service

router = APIRouter(prefix="/api/model", tags=["model"])


@router.get("/network", response_model=ModelNetwork)
def get_network(crs: str = Query(default="EPSG:25832")) -> ModelNetwork:
    inp = project_service.require_inp()
    payload = inp_model_service.network_payload(inp, crs=crs)
    return ModelNetwork(**payload)


@router.get("/objects/{object_type}/{object_id}", response_model=ModelObjectResponse)
def get_object(
    object_type: Literal["node", "link", "subcatchment"], object_id: str
) -> ModelObjectResponse:
    inp = project_service.require_inp()
    return ModelObjectResponse(**inp_model_service.get_object(inp, object_type, object_id))


@router.patch("/objects/{object_type}/{object_id}", response_model=ModelObjectResponse)
def patch_object(
    object_type: Literal["node", "link", "subcatchment"],
    object_id: str,
    body: ModelObjectPatch,
) -> ModelObjectResponse:
    inp = project_service.require_inp()
    patch = body.model_dump(exclude_none=True)
    return ModelObjectResponse(
        **inp_model_service.apply_patch(inp, object_type, object_id, patch)
    )


@router.post("/objects/node", response_model=ModelObjectResponse)
def create_node(body: NodeCreateRequest) -> ModelObjectResponse:
    inp = project_service.require_inp()
    return ModelObjectResponse(
        **inp_model_service.create_node(
            inp,
            node_kind=body.node_kind,
            x=body.x,
            y=body.y,
            node_id=body.id,
            elevation=body.elevation,
            max_depth=body.max_depth,
        )
    )


@router.post("/objects/link", response_model=ModelObjectResponse)
def create_link(body: LinkCreateRequest) -> ModelObjectResponse:
    inp = project_service.require_inp()
    return ModelObjectResponse(
        **inp_model_service.create_link(
            inp,
            from_node=body.from_node,
            to_node=body.to_node,
            link_kind=body.link_kind,
            link_id=body.id,
            length=body.length,
            roughness=body.roughness,
            diameter=body.diameter,
        )
    )


@router.post("/objects/subcatchment", response_model=ModelObjectResponse)
def create_subcatchment(body: SubcatchmentCreateRequest) -> ModelObjectResponse:
    inp = project_service.require_inp()
    return ModelObjectResponse(
        **inp_model_service.create_subcatchment(
            inp,
            outlet=body.outlet,
            polygon=body.polygon,
            sub_id=body.id,
            raingage=body.raingage,
            area=body.area,
            pct_imperv=body.pct_imperv,
            width=body.width,
            slope=body.slope,
        )
    )


@router.delete(
    "/objects/{object_type}/{object_id}", response_model=DeleteObjectResponse
)
def delete_object(
    object_type: Literal["node", "link", "subcatchment"],
    object_id: str,
    cascade: bool = Query(default=False),
) -> DeleteObjectResponse:
    inp = project_service.require_inp()
    return DeleteObjectResponse(
        **inp_model_service.delete_object(inp, object_type, object_id, cascade=cascade)
    )


@router.post("/save")
def save_model() -> dict[str, str]:
    """Invalidate cache after external INP edits; patches already write to disk."""
    project_service.require_inp()
    inp_model_service.invalidate()
    return {"status": "ok"}


@router.get("/simulation-window", response_model=SimulationWindow)
def get_simulation_window() -> SimulationWindow:
    inp = project_service.require_inp()
    return SimulationWindow(**inp_model_service.get_simulation_window(inp))


@router.put("/simulation-window", response_model=SimulationWindow)
def put_simulation_window(body: SimulationWindowUpdate) -> SimulationWindow:
    inp = project_service.require_inp()
    result = inp_model_service.set_simulation_window(
        inp,
        start_date=body.start_date,
        start_time=body.start_time,
        end_date=body.end_date,
        end_time=body.end_time,
        sync_report_start=body.sync_report_start,
    )
    return SimulationWindow(**result)


@router.post("/raingages/file", response_model=FileRaingageResponse)
def upsert_file_raingage(body: FileRaingageRequest) -> FileRaingageResponse:
    inp = project_service.require_inp()
    result = inp_model_service.upsert_file_raingage(
        inp,
        name=body.name,
        filename=body.filename,
        rain_format=body.format,
        interval=body.interval,
        scf=body.scf,
        units=body.units,
    )
    return FileRaingageResponse(**result)


@router.get("/raingages", response_model=list[RaingageInfo])
def list_raingages() -> list[RaingageInfo]:
    inp = project_service.require_inp()
    return [RaingageInfo(**r) for r in inp_model_service.list_raingages(inp)]


@router.delete("/raingages/{name}")
def delete_raingage(name: str) -> dict[str, object]:
    inp = project_service.require_inp()
    return inp_model_service.delete_raingage(inp, name)


@router.post("/raingages/apply-all", response_model=ApplyRaingageResponse)
def apply_raingage_to_all(body: ApplyRaingageRequest) -> ApplyRaingageResponse:
    inp = project_service.require_inp()
    result = inp_model_service.apply_raingage_to_all_subcatchments(inp, body.name)
    return ApplyRaingageResponse(**result)


@router.get("/profile", response_model=ProfileResponse)
def get_profile(
    start: str = Query(...),
    end: str = Query(...),
    period: Optional[int] = Query(default=None),
) -> ProfileResponse:
    inp = project_service.require_inp()
    return ProfileResponse(**profile_service.build_profile(inp, start, end, period))
