"""Undo / redo for every change to the open model.

Every state-changing API request is wrapped (see ``EditHistoryMiddleware``):
the model's .inp is read before the request and compared afterwards, and if
the request changed it, the previous text is kept. Undo restores it, redo puts
the change back. Because this works on the file, it covers every kind of edit
(map moves, the inspector, section tables, options, the INP editor, deletes
with their cascades) with nothing per-feature to maintain.

History is per model file (base and each scenario separately), kept in memory
and compressed, newest 60 steps.
"""

from __future__ import annotations

import contextvars
import hashlib
import threading
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

MAX_STEPS = 60
MAX_BYTES = 64 * 1024 * 1024  # compressed, per model file


def _hash(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


@dataclass
class _Step:
    label: str
    restore: bytes  # zlib-compressed file content to write back
    expect: str  # hash the file must have now for this step to apply

    @property
    def size(self) -> int:
        return len(self.restore)


@dataclass
class _Stack:
    undo: list[_Step] = field(default_factory=list)
    redo: list[_Step] = field(default_factory=list)

    def trim(self) -> None:
        while len(self.undo) > MAX_STEPS or (sum(s.size for s in self.undo) > MAX_BYTES and len(self.undo) > 1):
            self.undo.pop(0)


def label_for(method: str, path: str) -> str:
    parts = [p for p in path.split("/") if p][1:]  # drop "api"
    if parts[:2] == ["model", "objects"]:
        kind = parts[2] if len(parts) > 2 else "object"
        oid = parts[3] if len(parts) > 3 else ""
        verb = {"POST": "Add", "DELETE": "Delete"}.get(method, "Change")
        return f"{verb} {kind} {oid}".strip()
    if parts[:2] == ["model", "sections"] and len(parts) > 2:
        return f"Edit [{parts[2].upper()}]"
    if parts[:2] == ["model", "options"]:
        return "Change simulation options"
    if parts[:2] == ["model", "simulation-window"]:
        return "Change simulation dates and steps"
    if parts[:2] == ["model", "raingages"]:
        return "Change rain gauges"
    if parts[:1] == ["inp"]:
        return "Edit the INP text"
    if parts[:1] == ["2d"]:
        return "Change 2D model"
    if parts[:2] == ["model", "climate-temperature"]:
        return "Change climate data"
    return "Edit model"


# Per-request label holder: an endpoint can name its edit ("Delete 5 objects").
# A mutable dict so it survives FastAPI running sync endpoints in a thread.
_request_label: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar("edit_label", default=None)


class EditHistory:
    @staticmethod
    def set_label(label: str) -> None:
        """Name the edit the current request makes (shown in the history)."""
        holder = _request_label.get()
        if holder is not None:
            holder["label"] = label

    def __init__(self) -> None:
        self._stacks: dict[str, _Stack] = {}
        self._lock = threading.Lock()

    def _stack(self, inp: Path) -> _Stack:
        return self._stacks.setdefault(str(inp.resolve()), _Stack())

    @staticmethod
    def read(inp: Optional[Path]) -> Optional[bytes]:
        try:
            return inp.read_bytes() if inp and inp.is_file() else None
        except OSError:
            return None

    def record(self, inp: Path, before: bytes, after: bytes, label: str) -> None:
        if before == after:
            return
        with self._lock:
            st = self._stack(inp)
            st.undo.append(_Step(label, zlib.compress(before, 6), _hash(after)))
            st.redo.clear()
            st.trim()

    def state(self, inp: Optional[Path]) -> dict:
        if inp is None:
            return {"undo": [], "redo": []}
        with self._lock:
            st = self._stack(inp)
            return {"undo": [s.label for s in reversed(st.undo)], "redo": [s.label for s in reversed(st.redo)]}

    def _apply(self, inp: Path, take: str) -> dict:
        from app.services.inp_model_service import inp_model_service

        with self._lock:
            st = self._stack(inp)
            src, dst = (st.undo, st.redo) if take == "undo" else (st.redo, st.undo)
            if not src:
                raise HTTPException(status_code=400, detail=f"Nothing to {take}.")
            step = src[-1]
            current = self.read(inp) or b""
            if _hash(current) != step.expect:
                # The file was changed outside the app since this step.
                src.clear()
                raise HTTPException(
                    status_code=409,
                    detail=f"The model file was changed outside Saturday-SWMM, so the {take} history was cleared.",
                )
            src.pop()
            restored = zlib.decompress(step.restore)
            tmp = inp.with_name(inp.name + ".undo-tmp")
            tmp.write_bytes(restored)
            tmp.replace(inp)
            dst.append(_Step(step.label, zlib.compress(current, 6), _hash(restored)))
            if take == "redo":
                st.trim()
        inp_model_service.invalidate()
        out = self.state(inp)
        out["applied"] = step.label
        return out

    def undo(self, inp: Path) -> dict:
        return self._apply(inp, "undo")

    def redo(self, inp: Path) -> dict:
        return self._apply(inp, "redo")


edit_history = EditHistory()

# Requests that never count as model edits (or are the history itself).
_NOT_EDITS = (
    "/api/edits",
    "/api/runs",
    "/api/projects/open",
    "/api/projects/browse",
    "/api/projects/create",
    "/api/updates",
    "/api/app",
    "/api/scenarios",
    "/api/engine",
)


class EditHistoryMiddleware:
    """Records the .inp before/after each mutating /api request."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        method = scope.get("method", "GET").upper() if scope["type"] == "http" else "GET"
        path: str = scope.get("path", "")
        if scope["type"] != "http" or method in ("GET", "HEAD", "OPTIONS") or not path.startswith("/api/") or path.startswith(_NOT_EDITS):
            await self.app(scope, receive, send)
            return
        from app.services.project_service import project_service

        inp = getattr(project_service, "_inp_path", None)
        before = edit_history.read(inp)
        status = {"code": 0}
        holder: dict = {}
        _request_label.set(holder)

        async def wrapped(message):
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            elif message["type"] == "http.response.body" and not message.get("more_body") and before is not None:
                now_inp = getattr(project_service, "_inp_path", None)
                if 200 <= status["code"] < 300 and now_inp == inp:
                    after = edit_history.read(inp)
                    if after is not None and after != before:
                        edit_history.record(inp, before, after, holder.get("label") or label_for(method, path))
            await send(message)

        await self.app(scope, receive, wrapped)
