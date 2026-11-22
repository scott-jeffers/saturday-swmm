from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.models.schemas import (
    FlowAccumInfo,
    GisIngestRequest,
    GisLayer,
    GisLayerInfo,
    GisLayerList,
    GisLayerPatch,
    GisGeoJsonLayerRequest,
    GisWebLayerRequest,
)
from app.services.flow_accum_service import (
    flow_accum_bounds_path,
    flow_accum_meta_path,
    flow_accum_png_path,
    flow_floodplain_geojson_path,
    has_flow_accum_results,
)
from app.services.gis_service import NeedsCrsError, gis_service
from app.services.project_service import project_service

router = APIRouter(prefix="/api/gis", tags=["gis"])


def _needs_crs_http(exc: NeedsCrsError) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={"needs_crs": True, "message": exc.message},
    )


@router.get("/layers", response_model=GisLayerList)
def list_layers() -> GisLayerList:
    return GisLayerList(**gis_service.list_layers())


@router.get("/layers/{layer_id}", response_model=GisLayerInfo)
def get_layer(layer_id: str) -> GisLayerInfo:
    return GisLayerInfo(**gis_service.get_layer(layer_id))


@router.post("/layers/dem", response_model=GisLayer)
def ingest_dem(body: GisIngestRequest) -> GisLayer:
    try:
        return GisLayer(
            **gis_service.ingest_dem(
                body.source_path,
                name=body.name,
                source_crs=body.source_crs,
                copy=body.copy_to_project,
            )
        )
    except NeedsCrsError as exc:
        raise _needs_crs_http(exc) from exc


@router.post("/layers/vector", response_model=GisLayer)
def ingest_vector(body: GisIngestRequest) -> GisLayer:
    try:
        return GisLayer(
            **gis_service.ingest_vector(
                body.source_path,
                name=body.name,
                source_crs=body.source_crs,
            )
        )
    except NeedsCrsError as exc:
        raise _needs_crs_http(exc) from exc


@router.post("/layers/web", response_model=GisLayer)
def add_web_layer(body: GisWebLayerRequest) -> GisLayer:
    return GisLayer(**gis_service.add_web_layer(body.name, body.web.model_dump()))


@router.post("/layers/geojson", response_model=GisLayer)
def add_geojson_layer(body: GisGeoJsonLayerRequest) -> GisLayer:
    return GisLayer(**gis_service.add_geojson_layer(body.name, body.geojson, body.source))


@router.patch("/layers/{layer_id}", response_model=GisLayer)
def patch_layer(layer_id: str, body: GisLayerPatch) -> GisLayer:
    patch = body.model_dump(exclude_none=True)
    return GisLayer(**gis_service.patch_layer(layer_id, patch))


@router.delete("/layers/{layer_id}", response_model=GisLayerList)
def delete_layer(layer_id: str) -> GisLayerList:
    return GisLayerList(**gis_service.delete_layer(layer_id))


@router.get("/preview/{layer_id}/hillshade.png")
def preview_hillshade(layer_id: str) -> FileResponse:
    path = gis_service.preview_path(layer_id, "hillshade")
    return FileResponse(path, media_type="image/png", filename=f"{layer_id}_hillshade.png")


@router.get("/preview/{layer_id}/vector.geojson")
def preview_vector(layer_id: str) -> FileResponse:
    path = gis_service.preview_path(layer_id, "vector")
    return FileResponse(path, media_type="application/geo+json", filename=f"{layer_id}.geojson")


@router.get("/preview/{layer_id}/bounds.json")
def preview_bounds(layer_id: str) -> FileResponse:
    path = gis_service.preview_path(layer_id, "bounds")
    return FileResponse(path, media_type="application/json", filename=f"{layer_id}_bounds.json")


@router.get("/flow/info", response_model=FlowAccumInfo)
def flow_accum_info() -> FlowAccumInfo:
    """Status + WGS84 bounds for the DEM flow-accumulation overlay."""
    root = project_service.require_root()
    if not has_flow_accum_results(root):
        return FlowAccumInfo(available=False)
    bounds_raw: dict[str, Any] = json.loads(
        flow_accum_bounds_path(root).read_text(encoding="utf-8")
    )
    meta: dict[str, Any] = {}
    meta_path = flow_accum_meta_path(root)
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
    geojson = flow_floodplain_geojson_path(root)
    return FlowAccumInfo(
        available=True,
        bounds=bounds_raw,  # type: ignore[arg-type]
        png_url="/api/gis/flow/accum.png",
        geojson_url="/api/gis/flow/floodplain.geojson" if geojson.is_file() else None,
        width=meta.get("width"),
        height=meta.get("height"),
        cell_area_m2=meta.get("cell_area_m2"),
        max_area_m2=meta.get("max_area_m2"),
        hand_max=meta.get("hand_max"),
        polygon_count=meta.get("polygon_count"),
    )


@router.get("/flow/accum.png")
def flow_accum_png() -> FileResponse:
    root = project_service.require_root()
    path = flow_accum_png_path(root)
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="No flow accumulation overlay. Run with DEM flow accumulation engine first.",
        )
    return FileResponse(
        path,
        media_type="image/png",
        filename="flow_accum.png",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/flow/floodplain.geojson")
def flow_floodplain_geojson() -> FileResponse:
    root = project_service.require_root()
    path = flow_floodplain_geojson_path(root)
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="No floodplain polygons. Run with DEM flow accumulation engine first.",
        )
    return FileResponse(
        path,
        media_type="application/geo+json",
        filename="flow_floodplain.geojson",
        headers={"Cache-Control": "no-cache"},
    )
