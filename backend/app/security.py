"""Request guards for the local API.

The backend listens on localhost and has no user accounts, so it protects
itself from the two ways a web page you visit could still reach it:

* **DNS rebinding** — a hostile domain re-pointed at 127.0.0.1. Blocked by
  only accepting ``Host`` headers for localhost names (plus any extra names in
  ``SATURDAY_SWMM_ALLOWED_HOSTS``, comma separated).
* **Cross-site form posts** — a page on another site submitting a form to
  ``http://127.0.0.1:8000``. Blocked by requiring the ``X-Saturday-SWMM``
  header on every state-changing ``/api`` request; browsers only let a page
  set custom headers on cross-origin requests after a CORS preflight, which
  the CORS policy refuses for foreign origins.

It also refuses edits that would change the model underneath a running
simulation (409), so a save can't corrupt a run in progress.
"""

from __future__ import annotations

import json
import os
from typing import Any, Awaitable, Callable

CLIENT_HEADER = "x-saturday-swmm"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

DEFAULT_HOSTS = ("localhost", "127.0.0.1", "::1", "[::1]", "testserver")

# Mutations refused while any engine is running (prefix match).
_BLOCKED_DURING_RUN = (
    "/api/inp",
    "/api/model/",
    "/api/2d/",
    "/api/engine/update",
    "/api/updates/",
    "/api/scenarios",
    "/api/engine/rollback",
    "/api/projects/create",
    "/api/projects/crs",
    "/api/projects/simulation-engine",
    "/api/projects/files",
)

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


def allowed_hosts() -> set[str]:
    extra = os.environ.get("SATURDAY_SWMM_ALLOWED_HOSTS", "")
    hosts = {h.strip().lower() for h in extra.split(",") if h.strip()}
    return hosts | set(DEFAULT_HOSTS)


def _host_name(raw: str) -> str:
    raw = raw.strip().lower()
    if raw.startswith("["):  # [::1]:8000
        end = raw.find("]")
        return raw[: end + 1] if end > 0 else raw
    return raw.rsplit(":", 1)[0] if raw.count(":") == 1 else raw


async def _reject(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class LocalGuardMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app
        self.hosts = allowed_hosts()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        host = _host_name(headers.get("host", ""))
        if host not in self.hosts:
            await _reject(send, 400, f"Host '{host}' is not allowed")
            return

        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET").upper()
        if scope["type"] == "http" and path.startswith("/api/") and method not in SAFE_METHODS:
            if headers.get(CLIENT_HEADER) != "1":
                await _reject(send, 403, "Missing X-Saturday-SWMM header")
                return
            if path.startswith(_BLOCKED_DURING_RUN) or path == "/api/inp":
                from app.api.runs import running_engine

                busy = running_engine()
                if busy:
                    await _reject(
                        send,
                        409,
                        f"A {busy} simulation is running. Cancel it or wait for it to "
                        "finish before changing the model.",
                    )
                    return

        await self.app(scope, receive, send)
