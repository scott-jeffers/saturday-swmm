"""Run a short Python script against the open model (the in-app Python console).

The script runs in a separate Python process (the app's own interpreter, so
pyswmm and the other packages are available), in the project folder, with a
time limit. ``MODEL_INP``, ``MODEL_OUT`` and ``MODEL_RPT`` give the paths. If it
changes the .inp, the change is one undo step like any other edit.
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.project_service import project_service

router = APIRouter(prefix="/api/scripts", tags=["scripts"])

PRELUDE = """\
import os
MODEL_INP = os.environ["MODEL_INP"]
MODEL_OUT = os.environ["MODEL_OUT"]
MODEL_RPT = os.environ["MODEL_RPT"]
"""


class ScriptBody(BaseModel):
    code: str = Field(..., max_length=200_000)
    timeout: int = Field(default=60, ge=1, le=600)


@router.post("/run")
def run_script(body: ScriptBody) -> dict[str, Any]:
    from app.services.edit_history import edit_history
    from app.services.inp_model_service import inp_model_service

    root = project_service.require_root()
    inp = project_service.require_inp()
    env = {
        **os.environ,
        "MODEL_INP": str(inp),
        "MODEL_OUT": str(inp.with_suffix(".out")),
        "MODEL_RPT": str(inp.with_suffix(".rpt")),
        "PYTHONIOENCODING": "utf-8",
    }
    edit_history.set_label("Run a Python script")
    try:
        p = subprocess.run(
            [sys.executable, "-I", "-c", PRELUDE + body.code],
            cwd=str(root),
            env=env,
            capture_output=True,
            text=True,
            timeout=body.timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail=f"The script ran longer than {body.timeout} s and was stopped.") from exc
    inp_model_service.invalidate()
    return {"exit_code": p.returncode, "stdout": p.stdout[-200_000:], "stderr": p.stderr[-50_000:]}
