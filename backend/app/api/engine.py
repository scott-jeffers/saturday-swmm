from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import EngineUpdateRequest
from app.services import engine_service

router = APIRouter(prefix="/api/engine", tags=["engine"])


@router.get("")
def engine_status() -> dict:
    return engine_service.get_status()


@router.post("/check")
def engine_check() -> dict:
    return engine_service.check_updates()


@router.post("/update")
def engine_update(body: EngineUpdateRequest = EngineUpdateRequest()) -> dict:
    return engine_service.update_to(body.version)


@router.post("/rollback")
def engine_rollback() -> dict:
    return engine_service.rollback()
