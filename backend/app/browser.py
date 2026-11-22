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

from app.api import edits, model, model_tools, network_tools, projects, snapshots  # noqa: E402
from app.services.edit_history import EditHistoryMiddleware  # noqa: E402

#: Path prefixes served here; everything else stays with the browser code.
PREFIXES = ("/api/model", "/api/edits", "/api/snapshots", "/api/inp", "/api/projects")

app = FastAPI(title="Saturday-SWMM (browser)")
for _r in (projects.router, projects.inp_router, model.router, model_tools.router, network_tools.router, edits.router, snapshots.router):
    app.include_router(_r)
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
