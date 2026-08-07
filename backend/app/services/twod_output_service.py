"""
Read OpenSWMM 2D HDF5 results (*.2d.h5).

OpenSWMM 6.x Default2DOutputPlugin writes a CF-1.11 / UGRID-1.0 file:

  time                     (n_periods,)          days since simulation start
  Mesh2_face_depth         (n_periods, n_faces)  overland depth [m]
  Mesh2_face_head          (n_periods, n_faces)  hydraulic head [m]
  Mesh2_face_vx/vy         (n_periods, n_faces)  cell velocity [m/s]
  Mesh2_face_nodes         (n_faces, 3)          triangle connectivity
  Mesh2_node_x/y/z         (n_nodes,)            mesh vertices
  Mesh2_face_max_depth     (n_faces,)            envelope max depth
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.models.schemas import (
    OutVariableInfo,
    TimeSeriesResponse,
    TwoDMetadata,
    TwoDPeriodsResponse,
    TwoDSnapshotResponse,
)

logger = logging.getLogger(__name__)

# Logical variable id -> (dataset path, label, unit)
_VARS: dict[str, tuple[str, str, str]] = {
    "depth": ("Mesh2_face_depth", "Depth", "m"),
    "head": ("Mesh2_face_head", "Head", "m"),
    "vx": ("Mesh2_face_vx", "Velocity X", "m/s"),
    "vy": ("Mesh2_face_vy", "Velocity Y", "m/s"),
    "rainfall": ("Mesh2_face_rainfall", "Rainfall", "m/s"),
    "coupling_flux": ("Mesh2_face_coupling_flux", "Coupling flux", "m/s"),
}

# Never load a full time×face cube into RAM above this size (~100 MB float32).
_FULL_LOAD_BYTES_LIMIT = 100 * 1024 * 1024
# Chunk size (periods) for incremental max-over-time when Mesh2_face_max_depth is absent.
_ENVELOPE_CHUNK_PERIODS = 32


@dataclass
class BinarySnapshot:
    """Raw float32 payload + metadata for binary HTTP responses."""

    body: bytes
    triangle_count: int
    period: int
    value_min: float
    value_max: float
    variable: str
    unit: str
    time: Optional[str] = None


def _dataset_size_bytes(ds: Any) -> int:
    try:
        import numpy as np

        dtype = np.dtype(ds.dtype)
        n = int(np.prod(ds.shape))
        return int(n * dtype.itemsize)
    except Exception:
        try:
            shape = ds.shape
            return int(shape[0]) * int(shape[1]) * 4
        except Exception:
            return 0


class TwoDOutputService:
    def __init__(self) -> None:
        self._cache_path: Optional[Path] = None
        self._cache_mtime: float = 0.0
        self._cache_handle: Any = None

    def invalidate(self) -> None:
        if self._cache_handle is not None:
            try:
                self._cache_handle.close()
            except Exception:
                pass
        self._cache_path = None
        self._cache_mtime = 0.0
        self._cache_handle = None

    def _require_h5py(self):
        try:
            import h5py
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=(
                    "2D results unavailable (h5py import failed: "
                    f"{exc}). Restart the backend so h5py loads before OpenSWMM."
                ),
            ) from exc
        return h5py

    def _open(self, h5_path: Optional[Path]):
        if h5_path is None or not h5_path.is_file():
            raise HTTPException(
                status_code=404,
                detail="2D results file not found. Run a simulation with REPORT_2D YES.",
            )
        h5py = self._require_h5py()
        mtime = h5_path.stat().st_mtime
        if (
            self._cache_handle is not None
            and self._cache_path == h5_path
            and abs(self._cache_mtime - mtime) < 1e-9
        ):
            return self._cache_handle
        self.invalidate()
        try:
            handle = h5py.File(str(h5_path), "r", locking=False)
        except TypeError:
            handle = h5py.File(str(h5_path), "r")
        if "Mesh2_face_depth" not in handle:
            handle.close()
            raise HTTPException(
                status_code=400,
                detail="Unrecognized 2D HDF5 layout (missing Mesh2_face_depth).",
            )
        self._cache_path = h5_path
        self._cache_mtime = mtime
        self._cache_handle = handle
        return handle

    def _available_variables(self, handle) -> list[OutVariableInfo]:
        out: list[OutVariableInfo] = []
        for vid, (path, label, unit) in _VARS.items():
            if path in handle:
                out.append(OutVariableInfo(id=vid, label=label, unit=unit))
        return out

    def _period_count(self, handle) -> int:
        return int(handle["Mesh2_face_depth"].shape[0])

    def _triangle_count(self, handle) -> int:
        return int(handle["Mesh2_face_depth"].shape[1])

    def _time_labels(self, handle, n: int) -> tuple[list[str], list[float]]:
        times_sec: list[float] = []
        times: list[str] = []
        if "time" in handle:
            arr = [float(t) for t in handle["time"][:n]]
            t0 = arr[0] if arr else 0.0
            for t in arr:
                # File units claim "days since simulation start" but values are
                # absolute SWMM DateTime days. Use elapsed from first period.
                sec = (t - t0) * 86400.0
                times_sec.append(sec)
                total = int(round(sec))
                h, rem = divmod(max(total, 0), 3600)
                m, s = divmod(rem, 60)
                if h >= 24:
                    d, h2 = divmod(h, 24)
                    times.append(f"{d}d {h2:02d}:{m:02d}:{s:02d}")
                else:
                    times.append(f"{h:02d}:{m:02d}:{s:02d}")
        else:
            times = [str(i) for i in range(n)]
            times_sec = [float(i) for i in range(n)]
        return times, times_sec

    def _resolve_var(self, handle, variable: str) -> tuple[str, str, str]:
        var_key = (variable or "depth").lower()
        if var_key not in _VARS or _VARS[var_key][0] not in handle:
            if "Mesh2_face_depth" not in handle:
                raise HTTPException(
                    status_code=404, detail=f"Unknown 2D variable: {variable}"
                )
            var_key = "depth"
        path, _label, unit = _VARS[var_key]
        return var_key, path, unit

    def _row_to_f32(self, row: Any) -> tuple[Any, float, float]:
        import numpy as np

        arr = np.asarray(row, dtype=np.float32)
        if arr.size == 0:
            return arr, 0.0, 0.0
        vmin = float(arr.min())
        vmax = float(arr.max())
        return arr, vmin, vmax

    def _max_over_time_chunked(self, ds: Any) -> Any:
        """Per-face max along time without loading the full cube."""
        import numpy as np

        n_periods = int(ds.shape[0])
        n_faces = int(ds.shape[1])
        if n_periods < 1 or n_faces < 1:
            return np.zeros(0, dtype=np.float32)
        maxima = np.full(n_faces, -np.inf, dtype=np.float64)
        for start in range(0, n_periods, _ENVELOPE_CHUNK_PERIODS):
            end = min(start + _ENVELOPE_CHUNK_PERIODS, n_periods)
            chunk = np.asarray(ds[start:end, :], dtype=np.float64)
            maxima = np.maximum(maxima, chunk.max(axis=0))
        maxima = np.where(np.isfinite(maxima), maxima, 0.0)
        return maxima.astype(np.float32)

    def metadata(
        self, h5_path: Optional[Path], *, out_path: Optional[Path] = None
    ) -> TwoDMetadata:
        handle = self._open(h5_path)
        period_count = self._period_count(handle)
        out_period_count: Optional[int] = None
        periods_match: Optional[bool] = None
        report_step: Optional[float] = None
        if out_path and out_path.is_file():
            try:
                from openswmm.engine import OutputReader

                with OutputReader(str(out_path)) as out:
                    out_period_count = int(out.period_count)
                    try:
                        from datetime import timedelta

                        step = out.report_step
                        if isinstance(step, timedelta):
                            report_step = step.total_seconds()
                        else:
                            report_step = float(step)
                    except Exception:
                        pass
                periods_match = out_period_count == period_count
            except Exception:
                pass
        if report_step is None and period_count >= 2 and "time" in handle:
            t0 = float(handle["time"][0])
            t1 = float(handle["time"][1])
            report_step = (t1 - t0) * 86400.0
        return TwoDMetadata(
            path=str(h5_path),
            period_count=period_count,
            triangle_count=self._triangle_count(handle),
            variables=self._available_variables(handle),
            report_step_sec=report_step,
            out_period_count=out_period_count,
            periods_match_out=periods_match,
        )

    def periods(self, h5_path: Optional[Path]) -> TwoDPeriodsResponse:
        handle = self._open(h5_path)
        n = self._period_count(handle)
        times, times_sec = self._time_labels(handle, n)
        peak_depth_max: Optional[float] = None
        if "Mesh2_face_max_depth" in handle:
            import numpy as np

            arr = np.asarray(handle["Mesh2_face_max_depth"][:], dtype=np.float64)
            peak_depth_max = float(arr.max()) if arr.size else 0.0
        elif "Mesh2_face_depth" in handle and n > 0:
            # Never load the full time×face cube for peak metadata.
            logger.warning(
                "Mesh2_face_max_depth missing; peak_depth_max omitted "
                "(avoid full HDF5 load). Re-run with REPORT_2D for envelope dataset."
            )
            peak_depth_max = None
        return TwoDPeriodsResponse(
            period_count=n,
            times=times,
            times_sec=times_sec,
            peak_depth_max=peak_depth_max,
        )

    def envelope(
        self,
        h5_path: Optional[Path],
        *,
        variable: str = "depth",
    ) -> TwoDSnapshotResponse:
        """Per-triangle max-over-time (uses Mesh2_face_max_depth when available)."""
        binary = self.envelope_binary(h5_path, variable=variable)
        import numpy as np

        arr = np.frombuffer(binary.body, dtype=np.float32)
        values = [round(float(v), 4) for v in arr]
        return TwoDSnapshotResponse(
            period=binary.period,
            time=binary.time or "max envelope",
            triangle_count=binary.triangle_count,
            values=values,
            value_min=binary.value_min,
            value_max=binary.value_max,
            variable=binary.variable,
            unit=binary.unit,
        )

    def envelope_binary(
        self,
        h5_path: Optional[Path],
        *,
        variable: str = "depth",
    ) -> BinarySnapshot:
        handle = self._open(h5_path)
        var_key = (variable or "depth").lower()
        unit = "m"
        import numpy as np

        if var_key == "depth" and "Mesh2_face_max_depth" in handle:
            arr = np.asarray(handle["Mesh2_face_max_depth"][:], dtype=np.float32)
            unit = "m"
        else:
            var_key, path, unit = self._resolve_var(handle, variable)
            ds = handle[path]
            size = _dataset_size_bytes(ds)
            if size > 0 and size <= _FULL_LOAD_BYTES_LIMIT:
                arr = np.asarray(ds[:], dtype=np.float32).max(axis=0)
            else:
                # Chunked max — never materialize the full cube for large files.
                arr = self._max_over_time_chunked(ds)

        if arr.size == 0:
            body = b""
            vmin = vmax = 0.0
        else:
            vmin = float(arr.min())
            vmax = float(arr.max())
            body = np.asarray(arr, dtype=np.float32).tobytes(order="C")

        return BinarySnapshot(
            body=body,
            triangle_count=int(arr.size),
            period=-1,
            value_min=vmin,
            value_max=vmax,
            variable=var_key,
            unit=unit,
            time="max envelope",
        )

    def snapshot(
        self,
        h5_path: Optional[Path],
        period: int,
        *,
        variable: str = "depth",
    ) -> TwoDSnapshotResponse:
        binary = self.snapshot_binary(h5_path, period, variable=variable)
        import numpy as np

        arr = np.frombuffer(binary.body, dtype=np.float32)
        # Round to mm-scale depth precision — shrinks JSON and improves gzip ratio.
        values = [round(float(v), 4) for v in arr]
        return TwoDSnapshotResponse(
            period=binary.period,
            time=binary.time,
            triangle_count=binary.triangle_count,
            values=values,
            value_min=binary.value_min,
            value_max=binary.value_max,
            variable=binary.variable,
            unit=binary.unit,
        )

    def snapshot_binary(
        self,
        h5_path: Optional[Path],
        period: int,
        *,
        variable: str = "depth",
    ) -> BinarySnapshot:
        handle = self._open(h5_path)
        var_key, path, unit = self._resolve_var(handle, variable)
        ds = handle[path]
        n_periods = int(ds.shape[0])
        if period < 0 or period >= n_periods:
            raise HTTPException(
                status_code=400,
                detail=f"Period {period} out of range (0..{n_periods - 1})",
            )
        arr, vmin, vmax = self._row_to_f32(ds[period, :])
        time_label: Optional[str] = None
        times, _ = self._time_labels(handle, n_periods)
        if period < len(times):
            time_label = times[period]
        return BinarySnapshot(
            body=arr.tobytes(order="C"),
            triangle_count=int(arr.size),
            period=period,
            value_min=vmin,
            value_max=vmax,
            variable=var_key,
            unit=unit,
            time=time_label,
        )

    def face_series(
        self,
        h5_path: Optional[Path],
        face_index: int,
        *,
        variable: str = "depth",
    ) -> TimeSeriesResponse:
        """Time series for one mesh face (triangle), matching 1D TimeSeriesResponse."""
        handle = self._open(h5_path)
        var_key, path, unit = self._resolve_var(handle, variable)
        label = _VARS[var_key][1]
        ds = handle[path]
        n_periods = int(ds.shape[0])
        n_faces = int(ds.shape[1])
        if face_index < 0 or face_index >= n_faces:
            raise HTTPException(
                status_code=404,
                detail=f"Face index {face_index} out of range (0..{n_faces - 1})",
            )
        if n_periods < 1:
            raise HTTPException(status_code=400, detail="2D output has no reporting periods")

        import numpy as np

        col = np.asarray(ds[:, face_index], dtype=np.float64)
        values = [round(float(v), 6) for v in col]
        times, times_sec = self._time_labels(handle, n_periods)
        report_step = 0.0
        if len(times_sec) >= 2:
            report_step = float(times_sec[1] - times_sec[0])
        elif len(times_sec) == 1:
            report_step = float(times_sec[0]) if times_sec[0] > 0 else 0.0

        return TimeSeriesResponse(
            object_id=str(face_index),
            variable=var_key,
            variable_label=label,
            unit=unit,
            report_step_sec=report_step,
            values=values,
            times_sec=times_sec[: len(values)],
            times=times[: len(values)],
        )


twod_output_service = TwoDOutputService()
