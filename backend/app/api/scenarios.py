"""Parent/child scenarios (see services/scenario_service.py)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.project_service import project_service
from app.services.scenario_service import scenario_service

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


class CreateScenario(BaseModel):
    name: str
    parent: Optional[str] = None
    description: str = ""


class UpdateScenario(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ActiveScenario(BaseModel):
    id: str


@router.get("")
def list_scenarios() -> dict[str, Any]:
    return scenario_service.list()


@router.post("")
def create_scenario(body: CreateScenario) -> dict[str, Any]:
    return scenario_service.create(body.name, body.parent, body.description)


@router.put("/active")
def set_active(body: ActiveScenario) -> dict[str, Any]:
    project_service.set_active_scenario(body.id)
    return scenario_service.list()


@router.patch("/{sid}")
def update_scenario(sid: str, body: UpdateScenario) -> dict[str, Any]:
    return scenario_service.update(sid, body.name, body.description)


@router.delete("/{sid}")
def delete_scenario(sid: str) -> dict[str, Any]:
    return scenario_service.delete(sid)


@router.get("/compare")
def compare_scenarios(a: str, b: str) -> dict[str, Any]:
    return scenario_service.compare(a, b)


@router.get("/{sid}/diff")
def scenario_diff(sid: str) -> dict[str, Any]:
    return scenario_service.diff(sid)


@router.post("/{sid}/sync")
def sync_scenario(sid: str) -> dict[str, Any]:
    return scenario_service.sync_from_parent(sid)
