from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel

from app.models.schemas import (
    SaveRaingageRequest,
    ApplyRaingageRequest,
    ApplyRaingageResponse,
    ClimateTemperatureRequest,
    ClimateTemperatureResponse,
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
    SnapRaingageToMeshRequest,
    SnapRaingageToMeshResponse,
    SubcatchmentCreateRequest,
    TwoDOptionsSettings,
    TwoDOptionsUpdate,
)
from app.services.edit_history import edit_history
from app.services.inp_model_service import inp_model_service
from app.services.profile_service import profile_service
from app.services.project_service import project_service

router = APIRouter(prefix="/api/model", tags=["model"])


_NETWORK_CACHE: "dict[str, tuple[bytes, bytes | None]]" = {}


def _mesh_sig(inp) -> str:
    """Changes when a 2D mesh sidecar file changes (the mesh widens the network bounds)."""
    try:
        from pathlib import Path

        from app.services.twod_mesh_service import twod_mesh_service

        mf = getattr(twod_mesh_service.load(inp), "mesh_file", None)
        if mf and Path(mf).is_file():
            st = Path(mf).stat()
            return f"{mf}:{st.st_mtime_ns}:{st.st_size}"
    except Exception:
        pass
    return ""


@router.get("/network", response_model=ModelNetwork)
def get_network(request: Request, crs: Optional[str] = Query(default=None)):
    """The whole network for the map. The JSON is cached per file content, so a
    repeat request, or an undo back to a recent version, answers without rebuilding it."""
    import hashlib

    inp = project_service.require_inp()
    code = crs or project_service.get_crs()
    key = hashlib.blake2b(f"{inp_model_service.content_key(inp)}|{code}|{_mesh_sig(inp)}".encode(), digest_size=12).hexdigest()
    etag = f'"{key}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    entry = _NETWORK_CACHE.pop(key, None)
    if entry is None:
        import gzip

        payload = inp_model_service.network_payload(inp, crs=code)
        raw = ModelNetwork(**payload).model_dump_json().encode()
        # Compress once, here, instead of in the middleware on every request:
        # re-compressing a 20 MB network cost ~0.9 s per map load.
        entry = (raw, gzip.compress(raw, compresslevel=1, mtime=0) if len(raw) > 64_000 else None)
    _NETWORK_CACHE[key] = entry
    while len(_NETWORK_CACHE) > 4:
        _NETWORK_CACHE.pop(next(iter(_NETWORK_CACHE)))
    raw, packed = entry
    headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
    if packed is not None and "gzip" in request.headers.get("accept-encoding", "").lower():
        headers["Content-Encoding"] = "gzip"
        return Response(content=packed, media_type="application/json", headers=headers)
    return Response(content=raw, media_type="application/json", headers=headers)


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


class BulkPatchItem(BaseModel):
    object_type: Literal["node", "link", "subcatchment"]
    id: str
    patch: ModelObjectPatch


class BulkPatchBody(BaseModel):
    items: list[BulkPatchItem]


class BulkDeleteItem(BaseModel):
    object_type: Literal["node", "link", "subcatchment"]
    id: str


class BulkDeleteBody(BaseModel):
    items: list[BulkDeleteItem]
    cascade: bool = True


_NOUN = {"node": "nodes", "link": "links", "subcatchment": "subcatchments"}


def _bulk_label(verb: str, items: list, n: int) -> str:
    kinds = {i.object_type for i in items}
    noun = _NOUN[kinds.pop()] if len(kinds) == 1 else "objects"
    if n == 1:
        noun = noun[:-1]
    fields = sorted({k for i in items for k in getattr(i, "patch", ModelObjectPatch()).model_dump(exclude_none=True)} - {"geom1"})
    what = f" {fields[0].replace('_', ' ')} of" if verb == "Change" and len(fields) == 1 else ""
    return f"{verb}{what} {n} {noun}"


@router.post("/objects/bulk-patch")
def bulk_patch(body: BulkPatchBody) -> dict:
    """Apply the same kind of change to many objects as one edit (one undo step)."""
    inp = project_service.require_inp()
    done, errors = [], []
    for it in body.items:
        try:
            inp_model_service.apply_patch(inp, it.object_type, it.id, it.patch.model_dump(exclude_none=True))
            done.append(it.id)
        except HTTPException as exc:
            errors.append({"id": it.id, "detail": str(exc.detail)})
    edit_history.set_label(_bulk_label("Change", body.items, len(done)))
    return {"changed": done, "errors": errors}


@router.post("/objects/bulk-delete")
def bulk_delete(body: BulkDeleteBody) -> dict:
    """Delete many objects as one edit; links first so their nodes can go cleanly."""
    inp = project_service.require_inp()
    order = {"subcatchment": 0, "link": 1, "node": 2}
    deleted, cascaded, errors = [], [], []
    for it in sorted(body.items, key=lambda i: order[i.object_type]):
        if it.object_type == "link" and it.id in cascaded:
            continue
        try:
            res = inp_model_service.delete_object(inp, it.object_type, it.id, cascade=body.cascade)
            deleted.append({"object_type": it.object_type, "id": it.id})
            cascaded.extend(res.get("cascaded_link_ids", []))
        except HTTPException as exc:
            errors.append({"id": it.id, "detail": exc.detail if isinstance(exc.detail, str) else exc.detail.get("message", str(exc.detail))})
    edit_history.set_label(_bulk_label("Delete", body.items, len(deleted)))
    return {"deleted": deleted, "cascaded_link_ids": cascaded, "errors": errors}


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
        threads=body.threads,
        report_step=body.report_step,
        routing_step=body.routing_step,
        flow_routing=body.flow_routing,
    )
    return SimulationWindow(**result)


@router.get("/2d-options", response_model=TwoDOptionsSettings)
def get_2d_options() -> TwoDOptionsSettings:
    inp = project_service.require_inp()
    return TwoDOptionsSettings(**inp_model_service.get_2d_options_settings(inp))


@router.put("/2d-options", response_model=TwoDOptionsSettings)
def put_2d_options(body: TwoDOptionsUpdate) -> TwoDOptionsSettings:
    inp = project_service.require_inp()
    result = inp_model_service.set_2d_options_settings(
        inp,
        report_2d=body.report_2d,
        dry_depth=body.dry_depth,
        max_timestep=body.max_timestep,
        min_timestep=body.min_timestep,
        rel_tolerance=body.rel_tolerance,
        abs_tolerance=body.abs_tolerance,
    )
    return TwoDOptionsSettings(**result)


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


@router.put("/raingages/{name}")
def save_raingage(name: str, body: SaveRaingageRequest) -> dict[str, object]:
    """Create a rain gage, or change what it reads, how and how often."""
    inp = project_service.require_inp()
    result = inp_model_service.save_raingage(
        inp,
        name,
        new_name=body.new_name,
        rain_format=body.format,
        interval=body.interval,
        scf=body.scf,
        source=body.source,
        timeseries=body.timeseries,
        filename=body.filename,
        station=body.station,
        units=body.units,
    )
    verb = "Add" if result["created"] else ("Rename" if body.new_name and body.new_name != name else "Change")
    edit_history.set_label(f"{verb} rain gage {result['name']}")
    return result


@router.delete("/raingages/{name}")
def delete_raingage(name: str) -> dict[str, object]:
    inp = project_service.require_inp()
    return inp_model_service.delete_raingage(inp, name)


@router.post("/raingages/apply-all", response_model=ApplyRaingageResponse)
def apply_raingage_to_all(body: ApplyRaingageRequest) -> ApplyRaingageResponse:
    inp = project_service.require_inp()
    result = inp_model_service.apply_raingage_to_all_subcatchments(inp, body.name)
    return ApplyRaingageResponse(**result)


@router.post("/raingages/snap-to-mesh", response_model=SnapRaingageToMeshResponse)
def snap_raingage_to_mesh(body: SnapRaingageToMeshRequest) -> SnapRaingageToMeshResponse:
    """Place a raingage at the 2D mesh centroid so OpenSWMM can rain on the grid."""
    inp = project_service.require_inp()
    result = inp_model_service.snap_raingage_to_2d_mesh(inp, body.name)
    return SnapRaingageToMeshResponse(**result)


@router.post("/climate-temperature", response_model=ClimateTemperatureResponse)
def apply_climate_temperature(body: ClimateTemperatureRequest) -> ClimateTemperatureResponse:
    """Wire [TEMPERATURE] FILE + temperature-driven [EVAPORATION] for continuous climate."""
    inp = project_service.require_inp()
    result = inp_model_service.apply_climate_temperature(
        inp,
        filename=body.filename,
        dry_only=body.dry_only,
        latitude=body.latitude,
    )
    return ClimateTemperatureResponse(**result)


@router.get("/profile", response_model=ProfileResponse)
def get_profile(
    start: str = Query(...),
    end: str = Query(...),
    period: Optional[int] = Query(default=None),
    via: Optional[str] = Query(default=None, description="Comma-separated nodes the path must pass through"),
) -> ProfileResponse:
    inp = project_service.require_inp()
    vias = [v for v in (via or "").split(",") if v.strip()]
    return ProfileResponse(**profile_service.build_profile(inp, start, end, period, vias))
