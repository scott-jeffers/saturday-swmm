"""Section tables, simulation options and model check (services/model_tools_service.py)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import model_tools_service as mt

router = APIRouter(prefix="/api/model", tags=["model"])


class SectionRow(BaseModel):
    values: list[str]
    comment: str = ""


class SectionBody(BaseModel):
    rows: Optional[list[SectionRow]] = None
    text: Optional[str] = None


class OptionsBody(BaseModel):
    values: dict[str, str]


@router.get("/sections")
def sections() -> dict[str, Any]:
    return mt.list_sections()


@router.get("/sections/{name}")
def get_section(name: str) -> dict[str, Any]:
    return mt.get_section(name)


@router.put("/sections/{name}")
def put_section(name: str, body: SectionBody) -> dict[str, Any]:
    return mt.put_section(name, [r.model_dump() for r in body.rows] if body.rows is not None else None, body.text)


@router.get("/options")
def get_options() -> dict[str, Any]:
    return mt.get_options()


@router.put("/options")
def put_options(body: OptionsBody) -> dict[str, Any]:
    return mt.put_options(body.values)


@router.get("/check")
def check() -> dict[str, Any]:
    return mt.check_model()
