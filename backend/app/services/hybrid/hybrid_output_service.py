"""Read/write hybrid 2D depth results (NPZ) for map binary snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.services.hybrid.paths import hybrid_results_path


@dataclass
class HybridBinarySnapshot:
    body: bytes
    triangle_count: int
    period: int
    value_min: float
    value_max: float
    variable: str
    unit: str
    time: Optional[str] = None


class HybridOutputService:
    def __init__(self) -> None:
        self._cache: dict[str, Any] = {}

    def invalidate(self) -> None:
        self._cache.clear()

    def has_results(self, project_root: Path) -> bool:
        return hybrid_results_path(project_root).is_file()

    def _load(self, project_root: Path) -> dict[str, Any]:
        key = str(hybrid_results_path(project_root).resolve())
        if key in self._cache:
            return self._cache[key]
        path = hybrid_results_path(project_root)
        if not path.is_file():
            raise FileNotFoundError(str(path))
        data = np.load(path, allow_pickle=False)
        depths = np.asarray(data["depths"], dtype=np.float32)  # (n_periods, n_cells)
        max_depth = None
        if "max_depth" in data:
            max_depth = np.asarray(data["max_depth"], dtype=np.float32).ravel()
        elif depths.ndim == 2 and depths.shape[0] > 0:
            max_depth = np.nanmax(depths, axis=0).astype(np.float32)
        payload = {
            "depths": depths,
            "max_depth": max_depth,
            "times": np.asarray(data["times"]) if "times" in data else None,
            "nx": int(data["nx"]) if "nx" in data else 0,
            "ny": int(data["ny"]) if "ny" in data else 0,
            "xmin": float(data["xmin"]) if "xmin" in data else 0.0,
            "ymin": float(data["ymin"]) if "ymin" in data else 0.0,
            "xmax": float(data["xmax"]) if "xmax" in data else 1.0,
            "ymax": float(data["ymax"]) if "ymax" in data else 1.0,
        }
        self._cache[key] = payload
        return payload

    def save_results(
        self,
        project_root: Path,
        *,
        depths: np.ndarray,
        times: list[str],
        nx: int,
        ny: int,
        xmin: float,
        ymin: float,
        xmax: float,
        ymax: float,
        max_depth: Optional[np.ndarray] = None,
    ) -> Path:
        path = hybrid_results_path(project_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        arr = np.asarray(depths, dtype=np.float32)
        extra: dict[str, Any] = {}
        if max_depth is not None:
            extra["max_depth"] = np.asarray(max_depth, dtype=np.float32)
        np.savez_compressed(
            path,
            **extra,
            depths=arr,
            times=np.asarray(times),
            nx=np.int32(nx),
            ny=np.int32(ny),
            xmin=np.float64(xmin),
            ymin=np.float64(ymin),
            xmax=np.float64(xmax),
            ymax=np.float64(ymax),
        )
        self.invalidate()
        return path

    def periods(self, project_root: Path) -> dict[str, Any]:
        data = self._load(project_root)
        depths = data["depths"]
        n = int(depths.shape[0]) if depths.ndim == 2 else 0
        times_raw = data.get("times")
        times: list[str] = []
        if times_raw is not None:
            times = [str(t) for t in times_raw.tolist()]
        while len(times) < n:
            times.append(f"period-{len(times)}")
        max_depth = data.get("max_depth")
        if max_depth is not None and np.size(max_depth):
            peak = float(np.nanmax(max_depth))
        else:
            peak = float(np.nanmax(depths)) if depths.size else 0.0
        return {
            "period_count": n,
            "times": times[:n],
            "times_sec": list(range(n)),
            "peak_depth_max": peak,
            "variable": "depth",
            "unit": "m",
        }

    def metadata(self, project_root: Path) -> dict[str, Any]:
        data = self._load(project_root)
        depths = data["depths"]
        n_periods = int(depths.shape[0]) if depths.ndim == 2 else 0
        n_cells = int(depths.shape[1]) if depths.ndim == 2 else 0
        return {
            "period_count": n_periods,
            "cell_count": n_cells,
            "nx": data["nx"],
            "ny": data["ny"],
            "bounds": {
                "xmin": data["xmin"],
                "ymin": data["ymin"],
                "xmax": data["xmax"],
                "ymax": data["ymax"],
            },
            "variable": "depth",
            "unit": "m",
            "engine": "hybrid",
        }

    def snapshot_binary(
        self, project_root: Path, period: int, *, variable: str = "depth"
    ) -> HybridBinarySnapshot:
        data = self._load(project_root)
        depths = data["depths"]
        if depths.ndim != 2 or depths.shape[0] == 0:
            raise FileNotFoundError("No hybrid depth periods")
        p = max(0, min(int(period), int(depths.shape[0]) - 1))
        row = np.asarray(depths[p], dtype=np.float32)
        # Compact mesh uses 2 triangles per cell — duplicate cell depth per triangle.
        tri_vals = np.repeat(row, 2).astype(np.float32, copy=False)
        vmin = float(np.nanmin(row)) if row.size else 0.0
        vmax = float(np.nanmax(row)) if row.size else 0.0
        times_raw = data.get("times")
        time_s: Optional[str] = None
        if times_raw is not None and p < len(times_raw):
            time_s = str(times_raw[p])
        return HybridBinarySnapshot(
            body=tri_vals.tobytes(order="C"),
            triangle_count=int(tri_vals.size),
            period=p,
            value_min=vmin,
            value_max=vmax,
            variable=variable,
            unit="m",
            time=time_s,
        )

    def envelope_binary(
        self, project_root: Path, *, variable: str = "depth"
    ) -> HybridBinarySnapshot:
        """Per-cell max-over-time depth from ``max_depth`` (or nanmax of frames)."""
        data = self._load(project_root)
        row = data.get("max_depth")
        if row is None or not np.size(row):
            depths = data["depths"]
            if depths.ndim != 2 or depths.shape[0] == 0:
                raise FileNotFoundError("No hybrid depth periods")
            row = np.nanmax(depths, axis=0).astype(np.float32)
        else:
            row = np.asarray(row, dtype=np.float32).ravel()
        tri_vals = np.repeat(row, 2).astype(np.float32, copy=False)
        vmin = float(np.nanmin(row)) if row.size else 0.0
        vmax = float(np.nanmax(row)) if row.size else 0.0
        return HybridBinarySnapshot(
            body=tri_vals.tobytes(order="C"),
            triangle_count=int(tri_vals.size),
            period=-1,
            value_min=vmin,
            value_max=vmax,
            variable=variable,
            unit="m",
            time="max envelope",
        )

    def mesh_geojson(self, project_root: Path) -> dict[str, Any]:
        """Build a triangulated grid GeoJSON from stored hybrid grid bounds."""
        data = self._load(project_root)
        nx, ny = int(data["nx"]), int(data["ny"])
        if nx < 1 or ny < 1:
            return {"type": "FeatureCollection", "features": []}
        xmin, ymin, xmax, ymax = (
            float(data["xmin"]),
            float(data["ymin"]),
            float(data["xmax"]),
            float(data["ymax"]),
        )
        dx = (xmax - xmin) / nx
        dy = (ymax - ymin) / ny
        features: list[dict[str, Any]] = []
        idx = 0
        for iy in range(ny):
            for ix in range(nx):
                x0 = xmin + ix * dx
                y0 = ymin + iy * dy
                x1 = x0 + dx
                y1 = y0 + dy
                # Two triangles per cell
                for coords in (
                    [[x0, y0], [x1, y0], [x1, y1], [x0, y0]],
                    [[x0, y0], [x1, y1], [x0, y1], [x0, y0]],
                ):
                    features.append(
                        {
                            "type": "Feature",
                            "id": idx,
                            "properties": {"face_index": idx // 2, "triangle": idx},
                            "geometry": {"type": "Polygon", "coordinates": [coords]},
                        }
                    )
                    idx += 1
        return {
            "type": "FeatureCollection",
            "features": features,
            "properties": {"nx": nx, "ny": ny, "engine": "hybrid"},
        }

    def compact_mesh(self, project_root: Path) -> dict[str, Any]:
        """Vertices + triangle indices for large hybrid grids (cell quads → 2 tris)."""
        data = self._load(project_root)
        nx, ny = int(data["nx"]), int(data["ny"])
        xmin, ymin, xmax, ymax = (
            float(data["xmin"]),
            float(data["ymin"]),
            float(data["xmax"]),
            float(data["ymax"]),
        )
        if nx < 1 or ny < 1:
            return {"vertices": [], "triangles": [], "counts": {"vertices": 0, "triangles": 0}}
        dx = (xmax - xmin) / nx
        dy = (ymax - ymin) / ny
        # One vertex per cell center (depth is per-cell); expand to corner grid for viz
        verts: list[list[float]] = []
        for iy in range(ny + 1):
            for ix in range(nx + 1):
                verts.append([xmin + ix * dx, ymin + iy * dy])
        tris: list[list[int]] = []
        for iy in range(ny):
            for ix in range(nx):
                a = iy * (nx + 1) + ix
                b = a + 1
                c = a + (nx + 1)
                d = c + 1
                tris.append([a, b, d])
                tris.append([a, d, c])
        return {
            "vertices": verts,
            "triangles": tris,
            "counts": {"vertices": len(verts), "triangles": len(tris)},
            "nx": nx,
            "ny": ny,
            "cell_count": nx * ny,
        }


hybrid_output_service = HybridOutputService()
