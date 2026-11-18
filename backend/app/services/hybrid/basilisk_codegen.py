"""Basilisk driver source for the hybrid surface.

The driver used to be generated per model with coupling points baked in. It is
now one model-independent program (``basilisk/swmm2d.c``) that reads the
domain, DEM and coupling points at runtime; this module just places a copy of
it in ``{project}/hybrid/basilisk/`` for reference.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from app.models.schemas import HybridCoupling, HybridSurface
from app.services.hybrid.paths import basilisk_source_path, ensure_hybrid_dir

DRIVER_SOURCE = Path(__file__).resolve().parent / "basilisk" / "swmm2d.c"


def generate_coupled_surface_c(
    project_root: Path,
    surface: HybridSurface,
    coupling: HybridCoupling,
) -> Path:
    """Copy the generic swmm2d.c driver into the project and return its path."""
    ensure_hybrid_dir(project_root)
    dest = basilisk_source_path(project_root)
    shutil.copyfile(DRIVER_SOURCE, dest)
    return dest
