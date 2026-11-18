"""Paths under {project}/hybrid/ for Basilisk surface + coupling artifacts."""

from __future__ import annotations

from pathlib import Path


HYBRID_DIR_NAME = "hybrid"


def hybrid_dir(project_root: Path) -> Path:
    return project_root / HYBRID_DIR_NAME


def ensure_hybrid_dir(project_root: Path) -> Path:
    d = hybrid_dir(project_root)
    d.mkdir(parents=True, exist_ok=True)
    (d / "basilisk").mkdir(parents=True, exist_ok=True)
    return d


def surface_path(project_root: Path) -> Path:
    return hybrid_dir(project_root) / "surface.json"


def coupling_path(project_root: Path) -> Path:
    return hybrid_dir(project_root) / "coupling.json"


def basilisk_dir(project_root: Path) -> Path:
    return hybrid_dir(project_root) / "basilisk"


def basilisk_source_path(project_root: Path) -> Path:
    """Copy of the (model-independent) swmm2d.c driver, for reference."""
    return basilisk_dir(project_root) / "swmm2d.c"


def basilisk_binary_path(project_root: Path) -> Path:
    return basilisk_dir(project_root) / "run"


def basilisk_build_log_path(project_root: Path) -> Path:
    return basilisk_dir(project_root) / "build.log"


def hybrid_summary_path(project_root: Path) -> Path:
    """Mass balance / timing summary of the last hybrid run."""
    return hybrid_dir(project_root) / "summary.json"


def flux_log_path(project_root: Path) -> Path:
    return hybrid_dir(project_root) / "flux_log.jsonl"


def hybrid_results_path(project_root: Path) -> Path:
    """NPZ archive of hybrid 2D depth snapshots (periods × cells)."""
    return hybrid_dir(project_root) / "results.npz"


def sanitized_inp_path(project_root: Path) -> Path:
    return hybrid_dir(project_root) / "model_pyswmm.inp"
