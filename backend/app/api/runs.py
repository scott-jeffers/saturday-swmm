from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import RunStatusResponse
from app.services.project_service import project_service
from app.services.run_service import run_service

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=RunStatusResponse)
def start_run() -> RunStatusResponse:
    inp = project_service.require_inp()
    rpt = project_service.rpt_path()
    out = project_service.out_path()
    return run_service.start(inp, rpt, out)


@router.get("/current", response_model=RunStatusResponse)
def get_run_status() -> RunStatusResponse:
    return run_service.status()


@router.delete("/current", response_model=RunStatusResponse)
def cancel_run() -> RunStatusResponse:
    return run_service.cancel()
