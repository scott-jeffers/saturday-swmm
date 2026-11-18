"""Locate / build the Basilisk surface solver (swmm2d), or fall back to a stub.

``swmm2d.c`` is model-independent (all model data is read at runtime), so it
is built once per machine and cached under ``backend/.basilisk/``.

Resolution order for the solver command:

1. ``SATURDAY_SWMM2D`` env var: path to a prebuilt swmm2d binary.
2. Native ``qcc`` on PATH (Linux / macOS / WSL-hosted backend): compile.
3. Windows: bundled ``basilisk/bin/swmm2d-win64.exe`` (cross-compiled from
   the same source, see ``basilisk/build_windows.sh``).
4. Windows + WSL with Basilisk installed: compile and run inside WSL.

Every candidate must pass a small mass-conservation self-test before use.
If none does, the run falls back to the Python stub surface.
"""

from __future__ import annotations

import hashlib
import os
import platform
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.models.schemas import HybridCoupling, HybridSurface
from app.services.hybrid.paths import (
    basilisk_build_log_path,
    basilisk_dir,
    basilisk_source_path,
    ensure_hybrid_dir,
)

ASSET_DIR = Path(__file__).resolve().parent / "basilisk"
DRIVER_SOURCE = ASSET_DIR / "swmm2d.c"
BUNDLED_WIN_EXE = ASSET_DIR / "bin" / "swmm2d-win64.exe"
CACHE_DIR = Path(__file__).resolve().parents[3] / ".basilisk"   # backend/.basilisk

IS_WINDOWS = platform.system().lower().startswith("win")


# ---------------------------------------------------------------------------
# Stub surface (kept for machines without any working solver)
# ---------------------------------------------------------------------------


@dataclass
class StubSurfaceState:
    """Simple Cartesian depth field for when Basilisk is not available."""

    nx: int = 64
    ny: int = 64
    xmin: float = 0.0
    ymin: float = 0.0
    xmax: float = 1000.0
    ymax: float = 1000.0
    depths: list[float] = field(default_factory=list)
    t: float = 0.0
    coupling_xy: list[tuple[float, float]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.depths:
            self.depths = [0.0] * (self.nx * self.ny)

    def cell_index(self, x: float, y: float) -> int:
        dx = (self.xmax - self.xmin) / self.nx
        dy = (self.ymax - self.ymin) / self.ny
        if dx <= 0 or dy <= 0:
            return 0
        ix = max(0, min(self.nx - 1, int((x - self.xmin) / dx)))
        iy = max(0, min(self.ny - 1, int((y - self.ymin) / dy)))
        return iy * self.nx + ix

    def step(self, dt: float, source_qs: list[float]) -> None:
        """Inject volume at coupling cells and lightly diffuse (numpy)."""
        cell_area = ((self.xmax - self.xmin) / self.nx) * ((self.ymax - self.ymin) / self.ny)
        if cell_area <= 0:
            return
        d = np.asarray(self.depths, dtype=float).reshape(self.ny, self.nx)
        for i, (x, y) in enumerate(self.coupling_xy):
            q = source_qs[i] if i < len(source_qs) else 0.0
            if abs(q) < 1e-15:
                continue
            idx = self.cell_index(x, y)
            iy, ix = divmod(idx, self.nx)
            d[iy, ix] = max(0.0, d[iy, ix] + q * dt / cell_area)
        alpha = min(0.15, 0.05 * max(dt, 0.0))
        if alpha > 0:
            p = np.pad(d, 1, mode="edge")
            avg = (p[1:-1, 1:-1] + p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 5.0
            d = (1.0 - alpha) * d + alpha * avg
        self.depths = d.ravel().tolist()
        self.t += dt

    def sample_at_couplings(self) -> list[float]:
        return [self.depths[self.cell_index(x, y)] for x, y in self.coupling_xy]


def _domain_bounds(surface: HybridSurface) -> tuple[float, float, float, float]:
    ring = surface.domain_polygon or []
    if len(ring) < 2:
        return 0.0, 0.0, 1000.0, 1000.0
    xs = [float(p[0]) for p in ring if p and len(p) >= 2]
    ys = [float(p[1]) for p in ring if p and len(p) >= 2]
    return min(xs), min(ys), max(xs), max(ys)


def create_stub_state(
    surface: HybridSurface,
    coupling: HybridCoupling,
    *,
    nx: int = 64,
    ny: int = 64,
) -> StubSurfaceState:
    xmin, ymin, xmax, ymax = _domain_bounds(surface)
    return StubSurfaceState(
        nx=nx, ny=ny, xmin=xmin, ymin=ymin, xmax=xmax, ymax=ymax,
        coupling_xy=[(float(p.x), float(p.y)) for p in coupling.points],
    )


# ---------------------------------------------------------------------------
# Solver discovery
# ---------------------------------------------------------------------------


@dataclass
class SurfaceSolver:
    kind: str                    # "env" | "native" | "windows-bundled" | "wsl"
    command: list[str]
    description: str
    log: str = ""


BUILD_FLAVOR = "omp1"  # bump when build flags change (invalidates cached binaries)


# Highest thread count proven stable for the Windows OpenMP-patched portable C
# (serial qcc -source + activated OMP macros). Full qcc -fopenmp regen can go higher.
_SAFE_OMP_CAP = 2

# Chosen after self-test during resolve_surface_solver (None until first resolve).
_ACTIVE_OMP_THREADS: Optional[int] = None


def omp_thread_count() -> int:
    """Requested Basilisk OpenMP threads (SATURDAY_SWMM_OMP_THREADS or all CPUs)."""
    raw = os.environ.get("SATURDAY_SWMM_OMP_THREADS", "").strip()
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    return max(1, os.cpu_count() or 1)


def active_omp_threads() -> int:
    """Threads actually used after self-test (falls back to requested before resolve)."""
    if _ACTIVE_OMP_THREADS is not None:
        return _ACTIVE_OMP_THREADS
    return omp_thread_count()


def solver_child_env(
    *, threads: Optional[int] = None, command: Optional[list[str]] = None
) -> dict[str, str]:
    """Environment for a swmm2d child process (inherits current env + OMP_NUM_THREADS)."""
    env = os.environ.copy()
    n = active_omp_threads() if threads is None else max(1, int(threads))
    env["OMP_NUM_THREADS"] = str(n)
    # Keep OpenMP from oversubscribing when nested libs also use threads.
    env.setdefault("OMP_DYNAMIC", "false")
    if command:
        exe = Path(str(command[0])).resolve()
        if exe.parent.is_dir():
            exe_dir = str(exe.parent)
            path_key = "Path" if "Path" in env and "PATH" not in env else "PATH"
            prev = env.get(path_key) or env.get("PATH") or ""
            if exe_dir not in prev.split(os.pathsep):
                env[path_key] = exe_dir + os.pathsep + prev
    return env


def describe_solver(base: str, *, threads: Optional[int] = None) -> str:
    n = active_omp_threads() if threads is None else max(1, int(threads))
    return f"{base} (OpenMP, OMP_NUM_THREADS={n})"


def _thread_candidates(requested: int) -> list[int]:
    """Try requested count, then safe cap, then powers of two down to 1."""
    out: list[int] = []
    for n in (requested, min(requested, _SAFE_OMP_CAP), 8, 4, 2, 1):
        n = max(1, int(n))
        if n not in out and n <= max(requested, _SAFE_OMP_CAP):
            out.append(n)
    if 1 not in out:
        out.append(1)
    return out


def _self_test_stable(
    command: list[str], threads: int, *, trials: int = 2
) -> tuple[bool, str]:
    """Require consecutive self-test passes (OpenMP races can be intermittent)."""
    last = ""
    for _ in range(max(1, trials)):
        ok, last = self_test(command, threads=threads)
        if not ok:
            return False, last
    return True, last


def _source_hash() -> str:
    h = hashlib.sha1(DRIVER_SOURCE.read_bytes())
    h.update(BUILD_FLAVOR.encode())
    return h.hexdigest()[:12]


def _run(cmd: list[str], cwd: Optional[Path] = None, timeout: int = 300) -> tuple[int, str]:
    kwargs: dict[str, Any] = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True,
            timeout=timeout, check=False, **kwargs,
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except Exception as exc:  # FileNotFoundError, TimeoutExpired, ...
        return -1, str(exc)


def _native_qcc() -> Optional[str]:
    return shutil.which("qcc")


def _build_native(qcc: str) -> tuple[Optional[Path], str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    exe = CACHE_DIR / f"swmm2d-{_source_hash()}"
    if exe.is_file():
        return exe, f"cached {exe.name}"
    # Build in a private temp dir, then rename: concurrent builds never see a
    # half-written binary.
    with tempfile.TemporaryDirectory(prefix="swmm2d-build-", dir=CACHE_DIR) as td:
        tdir = Path(td)
        shutil.copyfile(DRIVER_SOURCE, tdir / "swmm2d.c")
        built = tdir / "swmm2d"
        # qcc's exit status is unreliable (it can return 2 after a successful
        # build), so success = the binary exists in this fresh directory; the
        # self-test then proves it works.
        # OpenMP first (multi-core surface), serial if the compiler lacks it.
        code, log = _run(
            [qcc, "-O2", "-fopenmp", "-Wall", "-o", "swmm2d", "swmm2d.c", "-lm"], cwd=tdir
        )
        if not built.is_file():
            code, log2 = _run([qcc, "-O2", "-Wall", "-o", "swmm2d", "swmm2d.c", "-lm"], cwd=tdir)
            log = f"OpenMP build failed, serial build:\n{log}\n{log2}"
        if not built.is_file():
            return None, f"qcc failed (exit {code}):\n{log}"
        os.replace(built, exe)
    return exe, log or "built"


def _to_wsl_path(p: Path) -> str:
    s = str(p.resolve())
    if len(s) > 1 and s[1] == ":":
        return "/mnt/" + s[0].lower() + s[2:].replace("\\", "/")
    return s.replace("\\", "/")


def _wsl_has_qcc() -> bool:
    if not IS_WINDOWS or not shutil.which("wsl.exe"):
        return False
    code, out = _run(["wsl.exe", "-e", "bash", "-lc", "command -v qcc"], timeout=30)
    return code == 0 and "qcc" in out


def _build_wsl() -> tuple[Optional[list[str]], str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    name = f"swmm2d-wsl-{_source_hash()}"
    exe = CACHE_DIR / name
    if not exe.is_file():
        shutil.copyfile(DRIVER_SOURCE, CACHE_DIR / "swmm2d.c")
        wdir = _to_wsl_path(CACHE_DIR)
        code, log = _run(
            ["wsl.exe", "-e", "bash", "-lc",
             f"cd '{wdir}' && (qcc -O2 -fopenmp -o '{name}' swmm2d.c -lm "
             f"|| qcc -O2 -o '{name}' swmm2d.c -lm)"],
            timeout=300,
        )
        if not exe.is_file():  # qcc exit status is unreliable; check the output
            return None, f"WSL qcc failed (exit {code}):\n{log}"
    # wsl.exe starts in the (translated) Windows cwd, which Popen sets.
    return ["wsl.exe", "-e", _to_wsl_path(exe)], "built in WSL"


def self_test(
    command: list[str], *, threads: Optional[int] = None
) -> tuple[bool, str]:
    """Tiny tilted-plane run: 100 m3 in, must find 100 m3 on the surface."""
    from app.services.hybrid.basilisk_ipc import BasiliskSurface, SurfaceConfig, write_inputs

    n_threads = omp_thread_count() if threads is None else max(1, int(threads))
    with tempfile.TemporaryDirectory(prefix="swmm2d-selftest-") as td:
        wd = Path(td)
        cfg = SurfaceConfig(L=400.0, min_level=3, max_level=6, dem_level=6, dtmax=2.0)
        n = 1 << cfg.dem_level
        xs = (np.arange(n) + 0.5) / n * cfg.L
        X, _ = np.meshgrid(xs, xs)
        dem = (50.0 - 0.01 * X).astype(np.float32)
        write_inputs(wd, cfg, dem, [(100.0, 200.0)])
        try:
            with BasiliskSurface(
                command,
                wd,
                1,
                env=solver_child_env(threads=n_threads, command=list(command)),
            ) as s:
                tot = 0.0
                for k in range(1, 11):
                    r = s.step(10.0 * k, np.array([1.0]))
                    tot += float(r.volume[0])
                _, _, vol, _ = s.dump_depth(32, 32)
        except Exception as exc:
            return False, f"self-test failed: {exc}"
        ok = abs(tot - 100.0) < 1e-3 and abs(vol - 100.0) < 0.5
        return (
            ok,
            f"self-test (OMP_NUM_THREADS={n_threads}): "
            f"injected {tot:.3f} m3, surface holds {vol:.3f} m3",
        )


# Only successes are cached (per driver source): if no solver works, the next
# run looks again, so installing Basilisk needs no backend restart.
_SOLVER_CACHE: dict[str, SurfaceSolver] = {}


def resolve_surface_solver(*, refresh: bool = False) -> tuple[Optional[SurfaceSolver], str]:
    """Find a working swmm2d command. Returns (solver or None, log)."""
    global _ACTIVE_OMP_THREADS
    key = _source_hash()
    if not refresh and key in _SOLVER_CACHE:
        s = _SOLVER_CACHE[key]
        return s, s.log

    logs: list[str] = []
    candidates: list[tuple[str, list[str], str]] = []

    env = os.environ.get("SATURDAY_SWMM2D")
    if env:
        candidates.append(("env", [env], f"SATURDAY_SWMM2D={env}"))

    qcc = _native_qcc()
    if qcc:
        exe, log = _build_native(qcc)
        logs.append(log)
        if exe:
            candidates.append(("native", [str(exe)], f"native qcc build ({exe.name})"))

    if IS_WINDOWS and BUNDLED_WIN_EXE.is_file():
        candidates.append(("windows-bundled", [str(BUNDLED_WIN_EXE)], "bundled swmm2d-win64.exe"))

    if IS_WINDOWS and not qcc and _wsl_has_qcc():
        cmd, log = _build_wsl()
        logs.append(log)
        if cmd:
            candidates.append(("wsl", cmd, "WSL qcc build"))

    requested = omp_thread_count()
    for kind, cmd, desc in candidates:
        chosen: Optional[int] = None
        last_msg = ""
        for n in _thread_candidates(requested):
            ok, last_msg = _self_test_stable(cmd, n)
            logs.append(f"{desc} @ OMP_NUM_THREADS={n}: {last_msg}")
            if ok:
                chosen = n
                break
        if chosen is not None:
            _ACTIVE_OMP_THREADS = chosen
            solver = SurfaceSolver(
                kind=kind,
                command=cmd,
                description=describe_solver(desc, threads=chosen),
                log="\n".join(logs),
            )
            _SOLVER_CACHE[key] = solver
            return solver, solver.log

    if not candidates:
        logs.append(
            "No Basilisk surface solver found (no qcc, no bundled Windows binary, "
            "no WSL Basilisk). Using the Python stub surface."
        )
    return None, "\n".join(logs)


# ---------------------------------------------------------------------------
# API used by bootstrap / endpoints
# ---------------------------------------------------------------------------


def build_basilisk(
    project_root: Path,
    surface: HybridSurface,
    coupling: HybridCoupling,
) -> dict[str, Any]:
    """Copy the driver into hybrid/basilisk/ and make sure a solver works."""
    ensure_hybrid_dir(project_root)
    try:
        shutil.copyfile(DRIVER_SOURCE, basilisk_source_path(project_root))
    except OSError:
        pass
    solver, log = resolve_surface_solver()
    basilisk_build_log_path(project_root).write_text(log + "\n", encoding="utf-8")
    if solver is None:
        return {
            "ok": True,
            "message": "Basilisk solver unavailable — using Python surface stub",
            "binary_path": None,
            "log": log[-8000:],
            "used_stub": True,
        }
    return {
        "ok": True,
        "message": f"Basilisk surface ready ({solver.description})",
        "binary_path": " ".join(solver.command),
        "log": log[-8000:],
        "used_stub": False,
    }


def has_native_binary(project_root: Path) -> bool:
    solver, _ = resolve_surface_solver()
    return solver is not None


def build_log_tail(project_root: Path, *, max_chars: int = 4000) -> Optional[str]:
    path = basilisk_build_log_path(project_root)
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[-max_chars:] if text else None


def source_exists(project_root: Path) -> bool:
    return basilisk_source_path(project_root).is_file()


def surface_workdir(project_root: Path) -> Path:
    """Runtime inputs/outputs for the solver (no spaces needed: relative IO)."""
    d = basilisk_dir(project_root) / "run"
    d.mkdir(parents=True, exist_ok=True)
    return d
