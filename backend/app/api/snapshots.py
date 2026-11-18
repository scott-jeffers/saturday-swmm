"""Named model snapshots (services/snapshot_service.py)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.services.snapshot_service import snapshot_service

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


class SnapshotCreate(BaseModel):
    label: str = ""


class SnapshotRename(BaseModel):
    label: str


@router.get("")
def list_snapshots() -> dict:
    return snapshot_service.list()


@router.post("")
def create_snapshot(body: SnapshotCreate) -> dict:
    return snapshot_service.create(body.label, auto=False)


@router.get("/{sid}/text", response_class=PlainTextResponse)
def snapshot_text(sid: str) -> str:
    return snapshot_service.text(sid)


@router.post("/{sid}/restore")
def restore_snapshot(sid: str) -> dict:
    return snapshot_service.restore(sid)


@router.patch("/{sid}")
def rename_snapshot(sid: str, body: SnapshotRename) -> dict:
    return snapshot_service.rename(sid, body.label)


@router.delete("/{sid}")
def delete_snapshot(sid: str) -> dict:
    return snapshot_service.delete(sid)
