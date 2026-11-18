"""US site data downloads: USGS 3DEP elevation, NLCD impervious, SSURGO soils."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.site_data_service import site_data_service

router = APIRouter(prefix="/api/site-data", tags=["site data"])


class DemBody(BaseModel):
    resolution_m: float = Field(default=3.0, ge=0.5, le=60)


class Ids(BaseModel):
    ids: Optional[list[str]] = None


@router.post("/dem")
def dem(body: DemBody) -> dict[str, Any]:
    return site_data_service.download_dem(body.resolution_m)


@router.post("/impervious")
def impervious() -> dict[str, Any]:
    return site_data_service.download_impervious()


@router.get("/impervious")
def impervious_summary() -> dict[str, Any]:
    return site_data_service.impervious_summary()


@router.post("/impervious/apply")
def impervious_apply(body: Ids) -> dict[str, Any]:
    return site_data_service.apply_impervious(body.ids)


@router.post("/soils")
def soils() -> dict[str, Any]:
    return site_data_service.download_soils()


@router.get("/soils")
def soils_summary() -> dict[str, Any]:
    return site_data_service.soils_summary()


@router.post("/soils/apply")
def soils_apply(body: Ids) -> dict[str, Any]:
    return site_data_service.apply_soils(body.ids)
