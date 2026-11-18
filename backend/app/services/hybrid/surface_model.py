"""Load / save hybrid/surface.json."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.models.schemas import HybridSurface
from app.services.hybrid.paths import ensure_hybrid_dir, surface_path


def default_surface() -> HybridSurface:
    return HybridSurface()


def load_surface(project_root: Path) -> HybridSurface:
    path = surface_path(project_root)
    if not path.is_file():
        return default_surface()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return HybridSurface.model_validate(data)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid hybrid/surface.json: {exc}"
        ) from exc


def save_surface(project_root: Path, surface: HybridSurface) -> HybridSurface:
    ensure_hybrid_dir(project_root)
    # Validate polygon if present
    ring = surface.domain_polygon or []
    if ring and len(ring) < 3:
        raise HTTPException(
            status_code=400, detail="domain_polygon needs at least 3 vertices"
        )
    path = surface_path(project_root)
    path.write_text(
        json.dumps(surface.model_dump(), indent=2) + "\n",
        encoding="utf-8",
    )
    return surface


def surface_summary(project_root: Path) -> dict[str, Any]:
    path = surface_path(project_root)
    if not path.is_file():
        return {"has_surface": False}
    s = load_surface(project_root)
    return {
        "has_surface": True,
        "domain_vertices": len(s.domain_polygon or []),
        "rainfall_mode": s.rainfall_mode,
        "mannings_n": s.mannings_n,
        "dem_layer_id": s.dem_layer_id,
    }
