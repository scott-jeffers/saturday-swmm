"""Line-protocol client for the swmm2d Basilisk surface process.

The driver (``swmm2d.c``) is model-independent: this module writes its inputs
(``config.txt``, ``dem.bin``, ``sources.txt``) into a working directory and
then steps it over stdin/stdout. All quantities on the wire are SI and in
*local* coordinates (metres from the domain origin).
"""

from __future__ import annotations

import os
import subprocess
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

import numpy as np


@dataclass
class SurfaceConfig:
    L: float                 # square domain side [m]
    x0: float = 0.0          # local origin [m]
    y0: float = 0.0
    min_level: int = 5
    max_level: int = 10
    dem_level: int = 10
    manning: float = 0.03
    dry: float = 1e-3        # physical wet/dry depth [m]
    htol: float = 0.01       # adapt_wavelet tolerance on h [m]
    qtol: float = 0.01       # adapt_wavelet tolerance on unit discharge h*u [m2/s]
    dtmax: float = 5.0       # max solver step [s]
    cfl: float = 0.4

    def write(self, path: Path) -> None:
        lines = [f"{k} {getattr(self, k)!r}" for k in (
            "L", "x0", "y0", "min_level", "max_level", "dem_level", "manning",
            "dry", "htol", "qtol", "dtmax", "cfl",
        )]
        path.write_text("\n".join(lines) + "\n", encoding="ascii")


@dataclass
class StepResult:
    t: float
    cells: int
    solver_steps: int
    depth: np.ndarray        # [m] at each source cell
    bed: np.ndarray          # [m] bed elevation of each source cell
    area: np.ndarray         # [m2] area of each source cell
    volume: np.ndarray       # [m3] achieved signed exchange over the interval


def fill_nodata(arr: np.ndarray) -> np.ndarray:
    """Fill NaNs from a coarse-to-fine mean pyramid (no scipy needed)."""
    a = np.asarray(arr, dtype=np.float64)
    mask = np.isfinite(a)
    if mask.all() or not mask.any():
        return np.where(mask, a, 0.0).astype(np.float32)
    levels = [(np.where(mask, a, 0.0), mask.astype(np.float64))]
    while levels[-1][0].shape[0] > 1 and levels[-1][0].shape[1] > 1:
        v, w = levels[-1]
        ny, nx = (v.shape[0] // 2) * 2, (v.shape[1] // 2) * 2
        v, w = v[:ny, :nx], w[:ny, :nx]
        vs = v.reshape(ny // 2, 2, nx // 2, 2).sum(axis=(1, 3))
        ws = w.reshape(ny // 2, 2, nx // 2, 2).sum(axis=(1, 3))
        levels.append((vs, ws))
    est = None
    for v, w in reversed(levels):
        cur = np.where(w > 0, v / np.maximum(w, 1e-12), np.nan)
        if est is not None:
            up = np.repeat(np.repeat(est, 2, axis=0), 2, axis=1)
            pad = np.full(cur.shape, np.nan)
            pad[: up.shape[0], : up.shape[1]] = up[: cur.shape[0], : cur.shape[1]]
            # edge rows/cols lost to odd sizes: copy nearest
            if np.isnan(pad).any():
                pad = np.where(np.isnan(pad), np.nanmean(pad), pad)
            cur = np.where(np.isfinite(cur), cur, pad)
        est = cur
    return np.where(mask, a, est).astype(np.float32)


def write_inputs(
    workdir: Path,
    cfg: SurfaceConfig,
    dem: np.ndarray,
    sources_xy: Sequence[tuple[float, float]],
    *,
    nodata_is_outflow: bool = True,
) -> None:
    """dem: (2^dem_level, 2^dem_level) float32 [m], row 0 = south, NaN = no data.

    With ``nodata_is_outflow`` the no-data area becomes an outflow region:
    its bed is filled smoothly and water reaching it leaves the model.
    Otherwise no-data cells become walls.
    """
    workdir.mkdir(parents=True, exist_ok=True)
    n = 1 << cfg.dem_level
    if dem.shape != (n, n):
        raise ValueError(f"dem must be {n}x{n}, got {dem.shape}")
    arr = np.asarray(dem, dtype=np.float32)
    valid = np.isfinite(arr)
    if nodata_is_outflow and not valid.all():
        fill_nodata(arr).astype(np.float32).tofile(workdir / "dem.bin")
        (~valid).astype(np.uint8).tofile(workdir / "outside.bin")
    else:
        out = arr.copy()
        out[~valid] = 1e20
        out.tofile(workdir / "dem.bin")
        (workdir / "outside.bin").unlink(missing_ok=True)
    cfg.write(workdir / "config.txt")
    with (workdir / "sources.txt").open("w", encoding="ascii") as fh:
        fh.write(f"{len(sources_xy)}\n")
        for x, y in sources_xy:
            fh.write(f"{x:.4f} {y:.4f}\n")


class BasiliskSurface:
    """Owns one swmm2d process."""

    def __init__(self, cmd: Sequence[str], workdir: Path, n_sources: int,
                 env: Optional[dict] = None) -> None:
        self.n = int(n_sources)
        self.workdir = Path(workdir)
        self._stderr_tail: deque[str] = deque(maxlen=60)
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        # Ensure OpenMP / mingw DLLs next to the exe are findable even when cwd
        # is the hybrid run directory (Windows DLL search can miss them otherwise).
        child_env = dict(env) if env is not None else os.environ.copy()
        exe = Path(str(cmd[0])).resolve() if cmd else None
        if exe is not None and exe.parent.is_dir():
            exe_dir = str(exe.parent)
            path_key = "Path" if "Path" in child_env and "PATH" not in child_env else "PATH"
            prev = child_env.get(path_key) or child_env.get("PATH") or ""
            if exe_dir not in prev.split(os.pathsep):
                child_env[path_key] = exe_dir + os.pathsep + prev
        self.proc = subprocess.Popen(
            list(cmd),
            cwd=str(self.workdir),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1 << 16,
            env=child_env,
            **kwargs,
        )
        self._err_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._err_thread.start()

    # -- plumbing -------------------------------------------------------
    def _drain_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            self._stderr_tail.append(line.rstrip())

    def stderr_tail(self) -> str:
        return "\n".join(self._stderr_tail)

    def _send(self, text: str) -> None:
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(text)
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise RuntimeError(self._dead_message()) from exc

    def _dead_message(self) -> str:
        self.proc.poll()
        return (f"Basilisk surface process exited (code {self.proc.returncode}). "
                f"stderr:\n{self.stderr_tail()}")

    def _readline(self) -> str:
        assert self.proc.stdout is not None
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError(self._dead_message())
            if line.startswith("R "):
                return line
            # anything else is diagnostics from Basilisk; keep it
            self._stderr_tail.append(line.rstrip())

    def _read_vector(self) -> np.ndarray:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line and self.n:
            raise RuntimeError(self._dead_message())
        if self.n == 0:
            return np.zeros(0)
        return np.array(line.split(), dtype=float)

    # -- protocol -------------------------------------------------------
    def step(self, t_target: float, rates: np.ndarray) -> StepResult:
        rates = np.asarray(rates, dtype=float)
        if rates.shape != (self.n,):
            raise ValueError("rates has wrong length")
        body = " ".join(f"{q:.6g}" for q in rates) if self.n else ""
        self._send(f"S {t_target:.6f}\n{body}\n")
        head = self._readline().split()
        if head[1] != "S":
            raise RuntimeError(f"unexpected reply: {' '.join(head)}")
        t, cells, steps = float(head[2]), int(head[3]), int(head[4])
        depth = self._read_vector()
        bed = self._read_vector()
        area = self._read_vector()
        vol = self._read_vector()
        return StepResult(t, cells, steps, depth, bed, area, vol)

    def dump_depth(self, nx: int, ny: int) -> tuple[np.ndarray, int, float, float]:
        """Depth raster (ny, nx) float32 [m], row 0 = south.

        Also returns (wet cell count, stored volume m3, cumulative volume that
        left through the outside mask m3).
        """
        name = "frame.bin"  # relative to cwd: project paths may contain spaces
        self._send(f"D {nx} {ny} {name}\n")
        head = self._readline().split()
        arr = np.fromfile(self.workdir / name, dtype=np.float32).reshape(ny, nx)
        lost = float(head[4]) if len(head) > 4 else 0.0
        return arr, int(head[2]), float(head[3]), lost

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self._send("Q\n")
                self._readline()
            except Exception:
                pass
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()

    def __enter__(self) -> "BasiliskSurface":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
