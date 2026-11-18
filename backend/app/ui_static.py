"""Serve the built web UI from the backend so the app needs one port.

Looks for the UI in, in order:
1. ``SATURDAY_SWMM_UI_DIR`` (env var)
2. ``<bundle>/ui`` — the portable release layout
3. ``frontend/dist`` in a source checkout (after ``npm run build``)

If none exists (e.g. during ``npm run dev``), nothing is mounted and the Vite
dev server serves the UI instead.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def find_ui_dir() -> Path | None:
    env = os.environ.get("SATURDAY_SWMM_UI_DIR", "").strip()
    cands: list[Path] = []
    if env:
        cands.append(Path(env))
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        cands.append(Path(meipass) / "ui")
    here = Path(__file__).resolve()
    cands.append(here.parents[1] / "ui")  # backend/ui (portable layout)
    cands.append(here.parents[2] / "frontend" / "dist")  # source checkout
    for c in cands:
        if (c / "index.html").is_file():
            return c
    return None


def mount_ui(app: FastAPI) -> Path | None:
    ui = find_ui_dir()
    if ui is None:
        return None

    assets = ui / "assets"
    if assets.is_dir():
        # Hashed file names: safe to cache forever.
        app.mount("/assets", StaticFiles(directory=assets), name="ui-assets")

    index = ui / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):  # noqa: ANN202 - FastAPI handler
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (ui / full_path).resolve()
        try:
            candidate.relative_to(ui.resolve())
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found") from None
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        # Client-side routes (/map, /results, ...) all load the SPA shell.
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return ui
