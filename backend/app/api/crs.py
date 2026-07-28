from __future__ import annotations

from fastapi import APIRouter, Query

from app.models.schemas import CrsPreset, CrsPresetList, CrsSearchHit, CrsSearchResponse
from app.services import crs_service

router = APIRouter(prefix="/api/crs", tags=["crs"])


@router.get("/search", response_model=CrsSearchResponse)
def search_crs(
    q: str = Query("", description="EPSG code, name, or area keywords"),
    online: bool = Query(
        False,
        description="Also query the online EPSG registry and merge results",
    ),
    limit: int = Query(20, ge=1, le=50),
) -> CrsSearchResponse:
    payload = crs_service.search(q, online=online, limit=limit)
    return CrsSearchResponse(
        query=payload["query"],
        online=payload["online"],
        hits=[CrsSearchHit(**h) for h in payload["hits"]],
        warning=payload.get("warning"),
    )


@router.get("/presets", response_model=CrsPresetList)
def crs_presets() -> CrsPresetList:
    return CrsPresetList(presets=[CrsPreset(**p) for p in crs_service.presets()])
