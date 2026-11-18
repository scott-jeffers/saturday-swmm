"""Network editing tools (services/network_tools_service.py)."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.services.network_tools_service import network_tools_service

router = APIRouter(prefix="/api/model/tools", tags=["network tools"])


class Links(BaseModel):
    links: list[str] = []


class Interpolate(BaseModel):
    nodes: list[str]
    links: list[str]
    keep_rims: bool = True


class Split(BaseModel):
    link: str
    fraction: float = 0.5
    node_id: Optional[str] = None


class Merge(BaseModel):
    keep: str
    remove: str


@router.post("/reverse")
def reverse(body: Links) -> dict[str, Any]:
    return network_tools_service.reverse(body.links)


@router.post("/lengths")
def lengths(body: Links) -> dict[str, Any]:
    return network_tools_service.set_lengths(body.links or None)


@router.post("/interpolate")
def interpolate(body: Interpolate) -> dict[str, Any]:
    return network_tools_service.interpolate(body.nodes, body.links, body.keep_rims)


@router.post("/split")
def split(body: Split) -> dict[str, Any]:
    return network_tools_service.split(body.link, body.fraction, body.node_id)


@router.post("/merge")
def merge(body: Merge) -> dict[str, Any]:
    return network_tools_service.merge(body.keep, body.remove)
