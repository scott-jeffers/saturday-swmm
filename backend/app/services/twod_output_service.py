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

from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.models.schemas import (
    OutVariableInfo,
    TwoDMetadata,
    TwoDPeriodsResponse,
    TwoDSnapshotResponse,
)

# Logical variable id -> (dataset path, label, unit)
_VARS: dict[str, tuple[str, str, str]] = {
    "depth": ("Mesh2_face_depth", "Depth", "m"),
    "head": ("Mesh2_face_head", "Head", "m"),
    "vx": ("Mesh2_face_vx", "Velocity X", "m/s"),
    "vy": ("Mesh2_face_vy", "Velocity Y", "m/s"),
    "rainfall": ("Mesh2_face_rainfall", "Rainfall", "m/s"),
    "coupling_flux": ("Mesh2_face_coupling_flux", "Coupling flux", "m/s"),
}


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
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="h5py is not installed. Add h5py to backend dependencies.",
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
        return TwoDPeriodsResponse(
            period_count=n, times=times, times_sec=times_sec
        )

    def snapshot(
        self,
        h5_path: Optional[Path],
        period: int,
        *,
        variable: str = "depth",
    ) -> TwoDSnapshotResponse:
        handle = self._open(h5_path)
        var_key = (variable or "depth").lower()
        if var_key not in _VARS or _VARS[var_key][0] not in handle:
            if "Mesh2_face_depth" not in handle:
                raise HTTPException(status_code=404, detail=f"Unknown 2D variable: {variable}")
            var_key = "depth"
        path, _label, unit = _VARS[var_key]
        ds = handle[path]
        n_periods = int(ds.shape[0])
        if period < 0 or period >= n_periods:
            raise HTTPException(
                status_code=400,
                detail=f"Period {period} out of range (0..{n_periods - 1})",
            )
        row = ds[period, :]
        values = [float(v) for v in row]
        vmin = min(values) if values else 0.0
        vmax = max(values) if values else 0.0

        time_label: Optional[str] = None
        times, _ = self._time_labels(handle, n_periods)
        if period < len(times):
            time_label = times[period]

        return TwoDSnapshotResponse(
            period=period,
            time=time_label,
            triangle_count=len(values),
            values=values,
            value_min=vmin,
            value_max=vmax,
            variable=var_key,
            unit=unit,
        )


twod_output_service = TwoDOutputService()
