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


class ChangeItem(BaseModel):
    section: str
    id: str
    field: Optional[int] = None


class ChangeItems(BaseModel):
    items: list[ChangeItem]


class NameBody(BaseModel):
    name: str


class ParentBody(BaseModel):
    parent: str


class LockBody(BaseModel):
    locked: bool


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




@router.get("/compare")
def compare_scenarios(a: str, b: str) -> dict[str, Any]:
    return scenario_service.compare(a, b)


@router.get("/{sid}/diff")
def scenario_diff(sid: str) -> dict[str, Any]:
    return scenario_service.diff(sid)


@router.post("/{sid}/sync")
def sync_scenario(sid: str) -> dict[str, Any]:
    return scenario_service.sync_from_parent(sid)


def _items(b: ChangeItems) -> list[dict[str, Any]]:
    return [i.model_dump() for i in b.items]


@router.get("/{sid}/inheritance")
def inheritance(sid: str) -> dict[str, Any]:
    """The scenario's own changes from its parent, and where the parent changed one of them."""
    return scenario_service.inheritance(None if sid == "active" else sid)


@router.post("/{sid}/reset")
def reset(sid: str, body: ChangeItems) -> dict[str, Any]:
    return scenario_service.reset(sid, _items(body))


@router.post("/{sid}/keep")
def keep(sid: str, body: ChangeItems) -> dict[str, Any]:
    return scenario_service.keep_mine(sid, _items(body))


@router.post("/{sid}/push")
def push(sid: str, body: ChangeItems) -> dict[str, Any]:
    return scenario_service.push_to_parent(sid, _items(body))


@router.post("/{sid}/apply-to-siblings")
def apply_to_siblings(sid: str, body: ChangeItems) -> dict[str, Any]:
    return scenario_service.apply_to_siblings(sid, _items(body))


@router.post("/{sid}/lock")
def lock(sid: str, body: LockBody) -> dict[str, Any]:
    return scenario_service.set_locked(sid, body.locked)


@router.post("/{sid}/reparent")
def reparent(sid: str, body: ParentBody) -> dict[str, Any]:
    return scenario_service.reparent(sid, body.parent)


@router.post("/{sid}/duplicate")
def duplicate(sid: str, body: NameBody) -> dict[str, Any]:
    return scenario_service.duplicate(sid, body.name)


@router.post("/{sid}/insert-parent")
def insert_parent(sid: str, body: NameBody) -> dict[str, Any]:
    return scenario_service.insert_parent(sid, body.name)


@router.post("/{sid}/make-base")
def make_base(sid: str) -> dict[str, Any]:
    return scenario_service.make_base(sid)


@router.delete("/{sid}")
def delete_scenario(sid: str, branch: bool = False) -> dict[str, Any]:
    """Delete a scenario; ``branch`` deletes its children too."""
    return scenario_service.delete(sid, branch=branch)


@router.get("/{sid}/removed-geojson")
def removed_geojson(sid: str) -> dict[str, Any]:
    """Elements removed in this scenario, as they were in its parent (model coordinates)."""
    return scenario_service.removed_geojson(sid)
