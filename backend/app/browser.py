"""The backend as it runs inside the browser (Pyodide), for the online viewer.

Only the pure-Python parts are served: model editing, model tools, network
tools, undo/redo, restore points, INP text and project rain files. Running
SWMM, reading results and GIS stay in the browser's own code (WebAssembly
SWMM and TypeScript readers).

Pyodide has no threads, so FastAPI's thread pool is replaced by direct
calls, and requests are dispatched in-process through ASGI by :func:`call`.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

import fastapi.concurrency as _fc
import fastapi.dependencies.utils as _fdu
import fastapi.routing as _fr
import starlette.concurrency as _sc


async def _direct(func: Any, *args: Any, **kwargs: Any) -> Any:
    return func(*args, **kwargs)


if sys.platform == "emscripten":  # Pyodide: no threads, so call straight through
    for _mod in (_sc, _fc, _fr, _fdu):
        if hasattr(_mod, "run_in_threadpool"):
            _mod.run_in_threadpool = _direct  # type: ignore[attr-defined]
    asyncio.to_thread = _direct  # type: ignore[assignment]

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from app.api import edits, model, model_tools, network_tools, projects, scenarios, snapshots, storms  # noqa: E402
from app.services.edit_history import EditHistoryMiddleware  # noqa: E402

#: Path prefixes served here; everything else stays with the browser code.
PREFIXES = ("/api/model", "/api/edits", "/api/snapshots", "/api/inp", "/api/projects", "/api/scenarios", "/api/storms", "/api/scripts")

app = FastAPI(title="Saturday-SWMM (browser)")
for _r in (projects.router, projects.inp_router, model.router, model_tools.router, network_tools.router, edits.router, snapshots.router, scenarios.router, storms.router):
    app.include_router(_r)


# ---------------------------------------------------------------- Python console
# The desktop runs a script in a separate Python process. Here there is one Python
# (this one), so the script runs in a fresh namespace with its output captured.
# MODEL_INP/OUT/RPT point at the files in /project, as on the desktop.
from fastapi import APIRouter, HTTPException  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

_scripts = APIRouter(prefix="/api/scripts", tags=["scripts"])


class _ScriptBody(BaseModel):
    code: str = Field(..., max_length=200_000)
    timeout: int = Field(default=60, ge=1, le=600)


@_scripts.post("/run")
def _run_script(body: _ScriptBody) -> dict[str, Any]:
    import contextlib
    import io
    import os
    import traceback

    from app.services.edit_history import edit_history
    from app.services.inp_model_service import inp_model_service
    from app.services.project_service import project_service

    root = project_service.require_root()
    inp = project_service.require_inp()
    edit_history.set_label("Run a Python script")
    out, err = io.StringIO(), io.StringIO()
    ns: dict[str, Any] = {"__name__": "__main__", "MODEL_INP": str(inp), "MODEL_OUT": str(inp.with_suffix(".out")), "MODEL_RPT": str(inp.with_suffix(".rpt"))}
    code = 0
    cwd = os.getcwd()
    try:
        os.chdir(root)
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(compile(body.code, "<console>", "exec"), ns)  # noqa: S102  (the user's own script, in their own browser)
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 0
    except BaseException:  # noqa: BLE001
        err.write(traceback.format_exc())
        code = 1
    finally:
        os.chdir(cwd)
    if not os.path.isfile(inp):
        raise HTTPException(status_code=500, detail="The script removed the model file.")
    inp_model_service.invalidate()
    return {"exit_code": code, "stdout": out.getvalue()[-200_000:], "stderr": err.getvalue()[-50_000:]}


app.include_router(_scripts)


# ---------------------------------------------------------------- browser runs under a storm
# The desktop writes a run copy of the model with the storm's rain file wired in
# (storm_service.prepare_cell). Here SWMM runs in the page, which wants the text and
# the rain file by name, side by side.
_runs = APIRouter(prefix="/api/storms", tags=["storms"])


@_runs.post("/run-input")
def _run_input() -> dict[str, Any]:
    from datetime import datetime, timedelta

    from app.services.project_service import project_service
    from app.services.scenario_service import scenario_service
    from app.services.storm_service import MODEL, apply_storm, storm_service

    inp = project_service.require_inp()
    text = inp.read_text(encoding="utf-8", errors="replace")
    sid = project_service.active_storm_id()
    scen = project_service.active_scenario_id()
    names = {s["id"]: s["name"] for s in scenario_service.list(catch_up=False)["scenarios"]}
    out: dict[str, Any] = {"scenario": {"id": scen, "name": names.get(scen, "Base")}, "storm": {"id": MODEL, "name": "Model rainfall"}, "text": text, "files": []}
    if sid == MODEL:
        return out
    s = storm_service.get(sid)
    rain = storm_service._dir() / s["file"]  # noqa: SLF001
    name = rain.name
    start = datetime.fromisoformat(s["start"])
    end = datetime.fromisoformat(s["end"]) + timedelta(hours=float(s.get("after_hours") or 0))
    out["text"] = apply_storm(text, name, s.get("station") or "STORM", s["format"], s["interval"], s["units"], start, end)
    out["files"] = [{"name": name, "text": rain.read_text(encoding="utf-8", errors="replace")}] if rain.is_file() else []
    out["storm"] = {"id": sid, "name": s.get("name") or sid}
    return out


# Registered ahead of the storms router so /run-input isn't taken for a storm id.
app.router.routes.insert(0, _runs.routes[0])

_snap = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@_snap.post("/before-run")
def _before_run() -> dict[str, Any]:
    """The automatic version the desktop keeps before every run."""
    from app.services.snapshot_service import snapshot_service

    return snapshot_service.create("Before run", auto=True)


app.router.routes.insert(0, _snap.routes[0])
app.add_middleware(EditHistoryMiddleware)  # undo/redo, as in the desktop app


@app.exception_handler(FileNotFoundError)
async def _missing_file(_request: Any, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"File not found: {getattr(exc, 'filename', None) or exc}"})


async def call(method: str, path: str, query: str = "", body: str | None = None) -> tuple[int, str, str]:
    """Dispatch one request; returns (status, body text, content type)."""
    payload = b"" if body is None else body.encode("utf-8")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": query.encode("utf-8"),
        "root_path": "",
        "headers": [(b"content-type", b"application/json"), (b"x-saturday-swmm", b"1")],
        "server": ("browser", 80),
        "client": ("browser", 1),
    }
    sent = False

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": payload, "more_body": False}

    out: dict[str, Any] = {"status": 500, "body": b"", "ctype": ""}

    async def send(msg: dict[str, Any]) -> None:
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
            for k, v in msg.get("headers", []):
                if k.lower() == b"content-type":
                    out["ctype"] = v.decode("latin-1")
        elif msg["type"] == "http.response.body":
            out["body"] += msg.get("body", b"")

    try:
        await app(scope, receive, send)
    except Exception as exc:  # noqa: BLE001  (surface as a 500 with the message)
        return 500, json.dumps({"detail": f"{type(exc).__name__}: {exc}"}), "application/json"
    return out["status"], out["body"].decode("utf-8", "replace"), out["ctype"]
