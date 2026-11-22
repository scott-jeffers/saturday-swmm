"""The project's storm library, and which storm the current results are for."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.project_service import project_service
from app.services.storm_service import storm_service

router = APIRouter(prefix="/api/storms", tags=["storms"])


class StormCreate(BaseModel):
    name: str
    text: str
    format: str = "VOLUME"
    interval: str = "0:05"
    units: str = "IN"
    after_hours: float = 12.0
    kind: str = "design"
    return_period: Optional[float] = None
    duration_hr: Optional[float] = None
    note: str = ""
    replace: bool = True


class StormPatch(BaseModel):
    name: Optional[str] = None
    after_hours: Optional[float] = None


class ActiveStorm(BaseModel):
    id: str


@router.get("")
def list_storms() -> dict[str, Any]:
    return storm_service.list()


@router.post("")
def create_storm(body: StormCreate) -> dict[str, Any]:
    return storm_service.create(
        body.name,
        body.text,
        fmt=body.format,
        interval=body.interval,
        units=body.units,
        after_hours=body.after_hours,
        kind=body.kind,
        return_period=body.return_period,
        duration_hr=body.duration_hr,
        note=body.note,
        replace=body.replace,
    )


@router.patch("/{sid}")
def update_storm(sid: str, body: StormPatch) -> dict[str, Any]:
    return storm_service.update(sid, body.name, body.after_hours)


@router.delete("/{sid}")
def delete_storm(sid: str) -> dict[str, Any]:
    return storm_service.delete(sid)


@router.put("/active")
def set_active_storm(body: ActiveStorm) -> Any:
    return project_service.set_active_storm(body.id)
