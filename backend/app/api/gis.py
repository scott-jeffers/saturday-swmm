from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.models.schemas import (
    GisIngestRequest,
    GisLayer,
    GisLayerInfo,
    GisLayerList,
    GisLayerPatch,
)
from app.services.gis_service import NeedsCrsError, gis_service

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
