"""Probe PySWMM / Basilisk availability on this machine."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from typing import Any


def probe_hybrid_capabilities() -> dict[str, Any]:
    pyswmm_ok = False
    pyswmm_version: str | None = None
    swmm_dll: str | None = None
    try:
        import pyswmm  # type: ignore

        pyswmm_ok = True
        pyswmm_version = getattr(pyswmm, "__version__", None) or "installed"
        swmm_dll = os.environ.get("SWMM_DLL") or os.environ.get("SWMM5_DLL")
    except Exception:
        pyswmm_ok = False

    qcc = shutil.which("qcc")
    basilisk_qcc = bool(qcc)
    basilisk_version: str | None = None
    if qcc:
        try:
            proc = subprocess.run(
                [qcc, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            out = (proc.stdout or proc.stderr or "").strip()
            basilisk_version = out.splitlines()[0] if out else "qcc"
        except Exception:
            basilisk_version = "qcc"

    is_windows = platform.system().lower().startswith("win")

    # Which surface solver will a run actually use? (cached after first probe)
    solver_desc = None
    solver_kind = None
    omp_threads = None
    try:
        from app.services.hybrid.basilisk_runner import (
            active_omp_threads,
            resolve_surface_solver,
        )

        solver, _log = resolve_surface_solver()
        omp_threads = active_omp_threads()
        if solver is not None:
            solver_desc = solver.description
            solver_kind = solver.kind
    except Exception:
        solver = None
    wsl_recommended = is_windows and solver_desc is None

    parts: list[str] = []
    if pyswmm_ok:
        parts.append(f"PySWMM {pyswmm_version}")
    else:
        parts.append("PySWMM not installed (pip install pyswmm)")
    if solver_desc:
        parts.append(f"Basilisk surface: {solver_desc}")
    elif basilisk_qcc:
        parts.append(f"Basilisk qcc at {qcc} (self-test failed — see build log)")
    else:
        parts.append(
            "Basilisk solver not available — stub 2D"
            + (" (bundled exe missing; or install Basilisk in WSL2)" if is_windows else " (install Basilisk qcc)")
        )

    return {
        "pyswmm_ok": pyswmm_ok,
        "pyswmm_version": pyswmm_version,
        "swmm_dll": swmm_dll,
        "basilisk_qcc": basilisk_qcc,
        "basilisk_qcc_path": qcc,
        "basilisk_version": basilisk_version,
        "basilisk_solver": solver_desc,
        "basilisk_solver_kind": solver_kind,
        "omp_threads": omp_threads,
        "platform": platform.platform(),
        "wsl_recommended": wsl_recommended,
        "message": "; ".join(parts),
    }
