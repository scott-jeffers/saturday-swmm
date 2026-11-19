"""Update checks and one-click updates (see services/updates_service.py)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import updates_service

router = APIRouter(prefix="/api/updates", tags=["updates"])


class InstallRequest(BaseModel):
    version: Optional[str] = None


class RestartRequest(BaseModel):
    into: Optional[str] = None


@router.get("")
def get_updates(force: bool = False) -> dict[str, Any]:
    return updates_service.status(force=force)


@router.post("/all")
def install_all() -> dict[str, Any]:
    """Update every engine with a newer version, then the app."""
    return updates_service.update_all()


@router.post("/{component}/install")
def install(component: str, body: InstallRequest = InstallRequest()) -> dict[str, Any]:
    if component == "saturday-swmm":
        return updates_service.install_app_update()
    return updates_service.install_package(component, body.version)


@router.post("/{component}/rollback")
def rollback(component: str) -> dict[str, Any]:
    return updates_service.rollback_package(component)


@router.post("/restart")
def restart(body: RestartRequest = RestartRequest()) -> dict[str, Any]:
    return updates_service.restart(body.into)
