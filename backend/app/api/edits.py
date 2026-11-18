"""Undo / redo for model edits (services/edit_history.py)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services.edit_history import edit_history
from app.services.project_service import project_service

router = APIRouter(prefix="/api/edits", tags=["edits"])


def _inp():
    inp = getattr(project_service, "_inp_path", None)
    if inp is None:
        raise HTTPException(status_code=404, detail="No project is open")
    return inp


@router.get("")
def history() -> dict:
    return edit_history.state(getattr(project_service, "_inp_path", None))


@router.post("/undo")
def undo() -> dict:
    return edit_history.undo(_inp())


@router.post("/redo")
def redo() -> dict:
    return edit_history.redo(_inp())
