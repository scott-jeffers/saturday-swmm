"""DEM-only flow accumulation (GIS-style): fill → D8 → upstream area.

Used as a third simulation engine so Run produces a floodplain-looking map
without opening SWMM or Basilisk.
"""

from __future__ import annotations

import heapq
import json
import math
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Optional

import numpy as np
from fastapi import HTTPException

from app.models.schemas import RunStatus, RunStatusResponse

# Cap the long side so a township DEM stays interactive without extra deps.
MAX_EDGE = 2000
# Stream cells: high percentile so only main creek corridors light up.
STREAM_AREA_PCT = 99.5
# Min stream drainage area [m²] (main channels, not hillside rills).
STREAM_AREA_MIN_M2 = 80_000.0
# HAND floodplain depth as a fraction of DEM relief (clamped below).
# Keep corridors tight so they read as creek/floodpath bands, not a township wash.
HAND_RELIEF_FRAC = 0.025
HAND_MIN = 2.0   # DEM vertical units (ft or m)
HAND_MAX = 12.0
# Drop floodplain polygons smaller than this many cells when vectorizing.
MIN_POLYGON_CELLS = 80
# Binary closing radius (cells) to stitch narrow corridor gaps before polygonize.
CLOSE_RADIUS = 2

# D8: N, NE, E, SE, S, SW, W, NW  (row, col) with row 0 = north (rasterio).
_D8_DR = (-1, -1, 0, 1, 1, 1, 0, -1)
_D8_DC = (0, 1, 1, 1, 0, -1, -1, -1)
_D8_DIST = (
    1.0,
    math.sqrt(2.0),
    1.0,
    math.sqrt(2.0),
    1.0,
    math.sqrt(2.0),
    1.0,
    math.sqrt(2.0),
)
# Reverse D8 index: flow toward the cell that discovered us via direction d.
_D8_REVERSE = (4, 5, 6, 7, 0, 1, 2, 3)


def flow_dir(project_root: Path) -> Path:
    d = project_root / "gis" / "flow"
    d.mkdir(parents=True, exist_ok=True)
    return d


def flow_accum_tif_path(project_root: Path) -> Path:
    return flow_dir(project_root) / "flow_accum.tif"


def flow_accum_png_path(project_root: Path) -> Path:
    return flow_dir(project_root) / "flow_accum.png"


def flow_accum_bounds_path(project_root: Path) -> Path:
    return flow_dir(project_root) / "flow_accum_bounds.json"


def flow_accum_meta_path(project_root: Path) -> Path:
    return flow_dir(project_root) / "flow_accum_meta.json"


def flow_floodplain_geojson_path(project_root: Path) -> Path:
    return flow_dir(project_root) / "flow_floodplain.geojson"


def flow_floodplain_tif_path(project_root: Path) -> Path:
    return flow_dir(project_root) / "flow_floodplain.tif"


def has_flow_accum_results(project_root: Path) -> bool:
    """True when a map overlay exists (PNG and/or GeoJSON floodplain)."""
    root_ok = flow_accum_bounds_path(project_root).is_file()
    if not root_ok:
        return False
    return (
        flow_accum_png_path(project_root).is_file()
        or flow_floodplain_geojson_path(project_root).is_file()
    )


def _xy_to_m(crs: Optional[str]) -> float:
    if not crs:
        return 1.0
    try:
        from pyproj import CRS

        c = CRS.from_user_input(crs)
        f = c.axis_info[0].unit_conversion_factor if c.axis_info else None
        if f and f > 0 and not c.is_geographic:
            return float(f)
    except Exception:
        pass
    return 1.0


def _load_dem_grid(
    dem_path: Path,
    project_crs: str,
    *,
    max_edge: int = MAX_EDGE,
) -> tuple[np.ndarray, Any, float, float, dict[str, float]]:
    """Resample DEM into project CRS; long side ≤ max_edge.

    Returns elev (float64, NaN=nodata), transform, cell_x, cell_y (project units),
    and WGS84 bounds dict.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.warp import transform_bounds
    from rasterio.vrt import WarpedVRT

    from app.services.gis_service import gis_service

    with rasterio.open(dem_path) as src:
        src_crs = src.crs
        dst_crs = project_crs or (str(src_crs) if src_crs else None)
        if not dst_crs:
            raise HTTPException(
                status_code=400,
                detail="Project CRS is required to compute flow accumulation",
            )
        left, bottom, right, top = transform_bounds(
            src_crs, dst_crs, *src.bounds, densify_pts=21
        )
        width_m = abs(right - left)
        height_m = abs(top - bottom)
        if width_m <= 0 or height_m <= 0:
            raise HTTPException(status_code=400, detail="DEM bounds are empty")
        if width_m >= height_m:
            out_w = max_edge
            out_h = max(1, int(round(max_edge * height_m / width_m)))
        else:
            out_h = max_edge
            out_w = max(1, int(round(max_edge * width_m / height_m)))
        transform = from_bounds(left, bottom, right, top, out_w, out_h)
        nodata = src.nodata
        with WarpedVRT(
            src,
            crs=dst_crs,
            transform=transform,
            width=out_w,
            height=out_h,
            resampling=Resampling.average,
            src_nodata=nodata,
            nodata=np.nan,
            dtype="float32",
        ) as vrt:
            elev = vrt.read(1, out_dtype="float32").astype(np.float64)
        if nodata is not None:
            elev[elev == float(nodata)] = np.nan
        elev[elev < -1e4] = np.nan
        cell_x = abs(transform.a)
        cell_y = abs(transform.e)
        bounds = gis_service._project_to_wgs84_bounds(
            left, bottom, right, top, str(dst_crs)
        )
        return elev, transform, cell_x, cell_y, bounds


def _priority_flood_with_flow(
    elev: np.ndarray,
    cancelled: threading.Event,
) -> tuple[np.ndarray, np.ndarray]:
    """Barnes priority-flood: fill depressions and assign D8 flow to outlets.

    Unlike steepest-descent on the filled surface (which leaves tens of thousands
    of flat sinks with fdir=-1), this assigns every interior cell a path toward
    the domain edge while flooding, so accumulation consolidates along valleys.
    """
    h, w = elev.shape
    filled = elev.copy()
    valid = np.isfinite(filled)
    fdir = np.full((h, w), -1, dtype=np.int8)
    if not np.any(valid):
        return filled, fdir

    visited = np.zeros((h, w), dtype=bool)
    heap: list[tuple[float, int, int]] = []

    def seed(r: int, c: int) -> None:
        if not valid[r, c] or visited[r, c]:
            return
        visited[r, c] = True
        fdir[r, c] = -1  # outlet
        heapq.heappush(heap, (float(filled[r, c]), r, c))

    for c in range(w):
        seed(0, c)
        if h > 1:
            seed(h - 1, c)
    for r in range(1, h - 1):
        seed(r, 0)
        if w > 1:
            seed(r, w - 1)

    # Nodata cells act as local outlets for adjacent terrain.
    for r, c in zip(*np.where(~valid)):
        for d in range(8):
            nr, nc = int(r) + _D8_DR[d], int(c) + _D8_DC[d]
            if 0 <= nr < h and 0 <= nc < w and valid[nr, nc] and not visited[nr, nc]:
                visited[nr, nc] = True
                fdir[nr, nc] = -1
                heapq.heappush(heap, (float(filled[nr, nc]), nr, nc))

    steps = 0
    while heap:
        if steps % 200_000 == 0 and cancelled.is_set():
            raise InterruptedError("cancelled")
        z, r, c = heapq.heappop(heap)
        for d in range(8):
            nr, nc = r + _D8_DR[d], c + _D8_DC[d]
            if not (0 <= nr < h and 0 <= nc < w):
                continue
            if not valid[nr, nc] or visited[nr, nc]:
                continue
            visited[nr, nc] = True
            nz = float(filled[nr, nc])
            if nz < z:
                filled[nr, nc] = z
                nz = z
            # Neighbor drains toward the discoverer (path to outlet).
            fdir[nr, nc] = _D8_REVERSE[d]
            heapq.heappush(heap, (nz, nr, nc))
        steps += 1

    fdir[~valid] = -1
    return filled, fdir


def _flow_accumulation_from_mask(
    fdir: np.ndarray,
    active: np.ndarray,
    cell_area_m2: float,
    cancelled: threading.Event,
) -> np.ndarray:
    """Upstream contributing area [m²] via topological pass on flat indices."""
    h, w = fdir.shape
    n = h * w
    area_flat = np.zeros(n, dtype=np.float64)
    active_flat = active.ravel()
    area_flat[active_flat] = cell_area_m2
    fdir_flat = fdir.ravel().astype(np.int16)

    # Receiver flat index (-1 = outlet / off-grid / inactive neighbor).
    receivers = np.full(n, -1, dtype=np.int32)
    rows = np.arange(h, dtype=np.int32)[:, None]
    cols = np.arange(w, dtype=np.int32)[None, :]
    for d in range(8):
        mask = (fdir == d) & active
        if not np.any(mask):
            continue
        nr = rows + _D8_DR[d]
        nc = cols + _D8_DC[d]
        ok = mask & (nr >= 0) & (nr < h) & (nc >= 0) & (nc < w)
        # Neighbor must be active to receive flow.
        dest = nr * w + nc
        flat_src = (rows * w + cols)[ok]
        flat_dst = dest[ok]
        # Filter inactive destinations
        keep = active_flat[flat_dst]
        receivers[flat_src[keep]] = flat_dst[keep]

    indeg = np.zeros(n, dtype=np.int32)
    valid_recv = receivers >= 0
    np.add.at(indeg, receivers[valid_recv], 1)

    # Kahn queue of sources (active cells with indegree 0).
    queue = np.flatnonzero(active_flat & (indeg == 0)).tolist()
    head = 0
    while head < len(queue):
        if head % 250_000 == 0 and cancelled.is_set():
            raise InterruptedError("cancelled")
        i = queue[head]
        head += 1
        j = int(receivers[i])
        if j < 0:
            continue
        area_flat[j] += area_flat[i]
        indeg[j] -= 1
        if indeg[j] == 0:
            queue.append(j)

    area = area_flat.reshape(h, w)
    area[~active] = np.nan
    return area


def _write_accum_tif(
    path: Path,
    area: np.ndarray,
    transform: Any,
    crs: str,
) -> None:
    import rasterio

    profile = {
        "driver": "GTiff",
        "height": area.shape[0],
        "width": area.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": np.float32(np.nan),
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    data = area.astype(np.float32)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)
        dst.update_tags(AREA_UNITS="m2")


def _stream_mask(area: np.ndarray, active: np.ndarray) -> tuple[np.ndarray, float]:
    """Boolean stream network from contributing-area threshold."""
    vals = area[active & np.isfinite(area) & (area > 0)]
    if vals.size == 0:
        return np.zeros(area.shape, dtype=bool), STREAM_AREA_MIN_M2
    thresh = max(float(np.percentile(vals, STREAM_AREA_PCT)), STREAM_AREA_MIN_M2)
    return (active & np.isfinite(area) & (area >= thresh)), thresh


def _hand_from_streams(
    filled: np.ndarray,
    fdir: np.ndarray,
    streams: np.ndarray,
    active: np.ndarray,
    cancelled: threading.Event,
) -> np.ndarray:
    """Height Above Nearest Drainage along the D8 flow network."""
    from collections import deque

    h, w = filled.shape
    n = h * w
    drain_z = np.full(n, np.nan, dtype=np.float64)
    streams_flat = streams.ravel()
    filled_flat = filled.ravel()
    active_flat = active.ravel()
    drain_z[streams_flat] = filled_flat[streams_flat]

    # Receiver flat index for each cell (-1 = outlet / inactive).
    receivers = np.full(n, -1, dtype=np.int32)
    rows = np.arange(h, dtype=np.int32)[:, None]
    cols = np.arange(w, dtype=np.int32)[None, :]
    for d in range(8):
        mask = (fdir == d) & active
        if not np.any(mask):
            continue
        nr = rows + _D8_DR[d]
        nc = cols + _D8_DC[d]
        ok = mask & (nr >= 0) & (nr < h) & (nc >= 0) & (nc < w)
        flat_src = (rows * w + cols)[ok]
        flat_dst = (nr * w + nc)[ok]
        keep = active_flat[flat_dst]
        receivers[flat_src[keep]] = flat_dst[keep]

    # Reverse edges: who flows into each cell.
    parents: list[list[int]] = [[] for _ in range(n)]
    for i in range(n):
        j = int(receivers[i])
        if j >= 0:
            parents[j].append(i)

    q: deque[int] = deque(int(i) for i in np.flatnonzero(streams_flat))
    seen = 0
    while q:
        if seen % 250_000 == 0 and cancelled.is_set():
            raise InterruptedError("cancelled")
        i = q.popleft()
        z = drain_z[i]
        for p in parents[i]:
            if not np.isfinite(drain_z[p]):
                drain_z[p] = z
                q.append(p)
        seen += 1

    hand = filled_flat - drain_z
    hand[~active_flat] = np.nan
    # Negative HAND (below stream) clamp to 0 — still in the valley floor.
    hand = np.where(np.isfinite(hand), np.maximum(hand, 0.0), np.nan)
    return hand.reshape(h, w)


def _hand_threshold(filled: np.ndarray, active: np.ndarray) -> float:
    vals = filled[active]
    if vals.size < 10:
        return HAND_MIN
    relief = float(np.nanpercentile(vals, 95) - np.nanpercentile(vals, 5))
    return float(np.clip(HAND_RELIEF_FRAC * max(relief, 0.0), HAND_MIN, HAND_MAX))


def _dilate_mask(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    """Binary dilation to widen stream corridors."""
    if radius < 1 or not np.any(mask):
        return mask
    try:
        from scipy import ndimage  # optional

        struct = ndimage.generate_binary_structure(2, 1)
        if radius > 1:
            struct = ndimage.iterate_structure(struct, radius)
        return np.asarray(ndimage.binary_dilation(mask, structure=struct), dtype=bool)
    except Exception:
        out = mask.copy()
        for _ in range(radius):
            padded = np.pad(out.astype(np.uint8), 1, mode="constant")
            h, w = mask.shape
            neigh = (
                padded[0:h, 0:w]
                + padded[0:h, 1 : w + 1]
                + padded[0:h, 2 : w + 2]
                + padded[1 : h + 1, 0:w]
                + padded[1 : h + 1, 1 : w + 1]
                + padded[1 : h + 1, 2 : w + 2]
                + padded[2 : h + 2, 0:w]
                + padded[2 : h + 2, 1 : w + 1]
                + padded[2 : h + 2, 2 : w + 2]
            )
            out = neigh > 0
        return out


def _close_mask(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    """Binary closing (dilate then erode) to fill pinholes for cleaner polygons."""
    if radius < 1 or not np.any(mask):
        return mask
    try:
        from scipy import ndimage  # optional; fall back if missing

        struct = ndimage.generate_binary_structure(2, 1)
        if radius > 1:
            struct = ndimage.iterate_structure(struct, radius)
        closed = ndimage.binary_closing(mask, structure=struct)
        return np.asarray(closed, dtype=bool)
    except Exception:
        # Approximate closing via dilate then majority erode.
        out = _dilate_mask(mask, radius)
        padded = np.pad(out.astype(np.uint8), 1, mode="constant")
        h, w = mask.shape
        for _ in range(radius):
            neigh = (
                padded[0:h, 0:w]
                + padded[0:h, 1 : w + 1]
                + padded[0:h, 2 : w + 2]
                + padded[1 : h + 1, 0:w]
                + padded[1 : h + 1, 1 : w + 1]
                + padded[1 : h + 1, 2 : w + 2]
                + padded[2 : h + 2, 0:w]
                + padded[2 : h + 2, 1 : w + 1]
                + padded[2 : h + 2, 2 : w + 2]
            )
            out = neigh >= 5
            padded = np.pad(out.astype(np.uint8), 1, mode="constant")
        return out | mask


def _write_floodplain_png(
    path: Path,
    hand: np.ndarray,
    floodplain: np.ndarray,
    hand_max: float,
    area: Optional[np.ndarray] = None,
) -> None:
    """Valley-corridor overlay: pink/orange along channels (like a floodpath map)."""
    from PIL import Image

    rgba = np.zeros((*hand.shape, 4), dtype=np.uint8)
    if not np.any(floodplain):
        Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)
        return

    # Intensity: high accumulation near thalweg (pink) → fringe (pale yellow).
    if area is not None:
        vals = area[floodplain & np.isfinite(area) & (area > 0)]
        if vals.size:
            loga = np.full(area.shape, np.nan, dtype=np.float64)
            loga[floodplain & np.isfinite(area) & (area > 0)] = np.log10(
                np.maximum(area[floodplain & np.isfinite(area) & (area > 0)], 1.0)
            )
            lo = float(np.nanpercentile(loga[floodplain], 20))
            hi = float(np.nanpercentile(loga[floodplain], 98))
            if hi <= lo:
                hi = lo + 1e-6
            t = np.clip((loga - lo) / (hi - lo), 0.0, 1.0)
        else:
            t = np.clip(1.0 - hand / max(hand_max, 1e-6), 0.0, 1.0)
    else:
        # t=1 at channel (low HAND).
        t = np.clip(1.0 - hand / max(hand_max, 1e-6), 0.0, 1.0)

    # Pale yellow → orange → magenta-pink (matches typical floodpath cartography).
    r = (255 - t * 30).astype(np.float64)
    g = (210 - t * 150).astype(np.float64)
    b = (90 + t * 80).astype(np.float64)
    a = (140 + t * 100).astype(np.float64)
    rgba[..., 0] = np.where(floodplain, np.clip(r, 0, 255), 0).astype(np.uint8)
    rgba[..., 1] = np.where(floodplain, np.clip(g, 0, 255), 0).astype(np.uint8)
    rgba[..., 2] = np.where(floodplain, np.clip(b, 0, 255), 0).astype(np.uint8)
    rgba[..., 3] = np.where(floodplain, np.clip(a, 0, 255), 0).astype(np.uint8)
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=True)


def _write_floodplain_geojson(
    path: Path,
    floodplain: np.ndarray,
    transform: Any,
    project_crs: str,
    *,
    hand: np.ndarray,
    hand_max: float,
    stream_area_m2: float,
) -> int:
    """Polygonize the floodplain mask to WGS84 GeoJSON. Returns feature count."""
    import rasterio
    from rasterio import features as rio_features
    from shapely.geometry import mapping, shape
    from shapely.ops import transform as shp_transform
    from shapely.ops import unary_union

    mask_u8 = floodplain.astype(np.uint8)
    shapes = list(
        rio_features.shapes(mask_u8, mask=floodplain, transform=transform)
    )
    geoms = [shape(geom) for geom, val in shapes if int(val) == 1 and shape(geom).area > 0]
    if not geoms:
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": []}),
            encoding="utf-8",
        )
        return 0

    # Drop speckles (area in projected units² ≈ cells * cell_area).
    cell_area = abs(transform.a * transform.e)
    min_area = max(cell_area * MIN_POLYGON_CELLS, cell_area)
    geoms = [g for g in geoms if g.area >= min_area]
    if not geoms:
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": []}),
            encoding="utf-8",
        )
        return 0

    merged = unary_union(geoms)
    # Smooth jagged raster stairsteps (buffer in / out by ~1 cell), then simplify.
    cell = max(abs(transform.a), abs(transform.e))
    try:
        merged = merged.buffer(cell * 0.75).buffer(-cell * 0.75)
    except Exception:
        pass
    tol = cell * 1.25
    if merged.geom_type == "Polygon":
        parts = [merged.simplify(tol, preserve_topology=True)]
    elif merged.geom_type == "MultiPolygon":
        parts = [g.simplify(tol, preserve_topology=True) for g in merged.geoms]
    else:
        parts = []

    parts = [g for g in parts if (not g.is_empty) and g.area >= min_area]
    # Keep the largest valleys that hold most of the floodplain area (FEMA-like).
    parts = sorted(parts, key=lambda g: g.area, reverse=True)
    if parts:
        total_a = sum(g.area for g in parts)
        kept: list[Any] = []
        acc_a = 0.0
        for g in parts:
            kept.append(g)
            acc_a += g.area
            if acc_a >= 0.90 * total_a and len(kept) >= 3:
                break
        # Always keep at least the top few sizable polygons.
        parts = kept if kept else parts[:12]

    from pyproj import Transformer

    to_wgs = Transformer.from_crs(project_crs, "EPSG:4326", always_xy=True)

    def _to_ll(x: float, y: float, z: float | None = None) -> tuple:
        lng, lat = to_wgs.transform(x, y)
        return (lng, lat) if z is None else (lng, lat, z)

    features: list[dict[str, Any]] = []
    for i, g in enumerate(parts):
        if g.is_empty:
            continue
        g_ll = shp_transform(_to_ll, g)
        # Mean HAND inside this polygon for labeling.
        # Sample via raster mask of this part in project CRS (pre-transform).
        try:
            part_mask = rio_features.geometry_mask(
                [mapping(g)],
                out_shape=floodplain.shape,
                transform=transform,
                invert=True,
            )
            hand_vals = hand[part_mask & np.isfinite(hand)]
            mean_hand = float(np.mean(hand_vals)) if hand_vals.size else None
        except Exception:
            mean_hand = None

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"fp-{i + 1}",
                    "name": f"Flow path {i + 1}",
                    "hand_max": hand_max,
                    "mean_hand": mean_hand,
                    "stream_area_m2": stream_area_m2,
                    "kind": "floodplain",
                },
                "geometry": mapping(g_ll),
            }
        )

    fc = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": features,
    }
    path.write_text(json.dumps(fc), encoding="utf-8")
    return len(features)


def compute_flow_accumulation(
    project_root: Path,
    *,
    progress: Optional[Callable[[float, str], None]] = None,
    cancelled: Optional[threading.Event] = None,
    dem_layer_id: Optional[str] = None,
) -> dict[str, Any]:
    """Run fill → D8 → accumulation → HAND floodplain; write gis/flow artifacts."""
    from app.services.gis_service import gis_service
    from app.services.project_service import project_service

    cancel = cancelled or threading.Event()

    def report(pct: float, msg: str) -> None:
        if progress:
            progress(pct, msg)

    report(2.0, "Loading DEM")
    dem_path = gis_service._resolve_dem_path(dem_layer_id)
    project_crs = project_service.get_crs()
    elev, transform, cell_x, cell_y, bounds = _load_dem_grid(dem_path, project_crs)
    if cancel.is_set():
        raise InterruptedError("cancelled")

    active = np.isfinite(elev)
    if not np.any(active):
        raise HTTPException(status_code=400, detail="DEM has no valid elevation cells")

    report(15.0, "Filling depressions and assigning flow paths")
    filled, fdir = _priority_flood_with_flow(elev, cancel)
    fdir[~active] = -1
    if cancel.is_set():
        raise InterruptedError("cancelled")

    report(55.0, "Accumulating upstream area")
    xy_m = _xy_to_m(project_crs)
    cell_area_m2 = float(cell_x * xy_m * cell_y * xy_m)
    area = _flow_accumulation_from_mask(fdir, active, cell_area_m2, cancel)
    if cancel.is_set():
        raise InterruptedError("cancelled")

    report(65.0, "Delineating stream network")
    streams, stream_thresh = _stream_mask(area, active)
    if not np.any(streams):
        # Fall back: top 1% of cells by area.
        flat = area.copy()
        flat[~active] = -np.inf
        k = max(1, int(0.01 * np.count_nonzero(active)))
        thresh_idx = np.argpartition(flat.ravel(), -k)[-k:]
        streams = np.zeros(area.shape, dtype=bool)
        streams.ravel()[thresh_idx] = True
        stream_thresh = float(np.nanmin(area[streams]))

    report(72.0, "Computing height above drainage (HAND)")
    hand = _hand_from_streams(filled, fdir, streams, active, cancel)
    hand_max = _hand_threshold(filled, active)
    # Map corridors: high-accumulation channels widened into continuous bands
    # (~5–8 cells ≈ 70–120 ft) so they read like known creek/floodpath maps.
    corridor = active & np.isfinite(area) & (area >= stream_thresh)
    corridor = _dilate_mask(corridor, radius=6)
    hand_band = active & np.isfinite(hand) & (hand <= hand_max)
    # Keep HAND only near the channel network (not random hillside pockets).
    near_channel = _dilate_mask(streams, radius=8)
    floodplain = (corridor | (hand_band & near_channel)) & active
    floodplain = _close_mask(floodplain, radius=2)
    if cancel.is_set():
        raise InterruptedError("cancelled")

    report(85.0, "Writing floodplain rasters")
    flow_dir(project_root)
    tif = flow_accum_tif_path(project_root)
    fp_tif = flow_floodplain_tif_path(project_root)
    png = flow_accum_png_path(project_root)
    geojson_path = flow_floodplain_geojson_path(project_root)
    bounds_path = flow_accum_bounds_path(project_root)
    meta_path = flow_accum_meta_path(project_root)

    _write_accum_tif(tif, area, transform, project_crs)
    # HAND raster (nodata outside floodplain for GIS use).
    hand_out = np.where(floodplain, hand, np.nan).astype(np.float32)
    _write_accum_tif(fp_tif, hand_out, transform, project_crs)

    report(90.0, "Building floodpath map overlay")
    _write_floodplain_png(png, hand, floodplain, hand_max, area=area)

    report(94.0, "Polygonizing flow paths")
    n_features = _write_floodplain_geojson(
        geojson_path,
        floodplain,
        transform,
        project_crs,
        hand=hand,
        hand_max=hand_max,
        stream_area_m2=stream_thresh,
    )
    bounds_path.write_text(json.dumps(bounds, indent=2), encoding="utf-8")

    finite = area[np.isfinite(area)]
    meta = {
        "dem_path": str(dem_path),
        "crs": project_crs,
        "width": int(area.shape[1]),
        "height": int(area.shape[0]),
        "cell_x": cell_x,
        "cell_y": cell_y,
        "cell_area_m2": cell_area_m2,
        "min_area_m2": float(np.min(finite)) if finite.size else None,
        "max_area_m2": float(np.max(finite)) if finite.size else None,
        "stream_area_m2": stream_thresh,
        "hand_max": hand_max,
        "floodplain_cells": int(np.count_nonzero(floodplain)),
        "polygon_count": n_features,
        "bounds": bounds,
        "tif": str(tif.relative_to(project_root)).replace("\\", "/"),
        "floodplain_tif": str(fp_tif.relative_to(project_root)).replace("\\", "/"),
        "png": str(png.relative_to(project_root)).replace("\\", "/"),
        "geojson": str(geojson_path.relative_to(project_root)).replace("\\", "/"),
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    report(100.0, "Flow accumulation complete")
    return meta


class FlowAccumRunService:
    """Background DEM flow-accumulation job (same status shape as RunService)."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="flow-accum"
        )
        self._future: Optional[Future] = None
        self._cancel = threading.Event()
        self._status = RunStatus.idle
        self._progress = 0.0
        self._message = ""
        self._error: Optional[str] = None

    def status(self) -> RunStatusResponse:
        with self._lock:
            return RunStatusResponse(
                status=self._status,
                progress=self._progress,
                message=self._message,
                error=self._error,
                live_rendering=False,
            )

    def start(self, project_root: Path) -> RunStatusResponse:
        with self._lock:
            if self._status == RunStatus.running:
                raise HTTPException(status_code=409, detail="A run is already in progress")
            self._cancel.clear()
            self._status = RunStatus.running
            self._progress = 0.0
            self._message = "Starting DEM flow accumulation"
            self._error = None
            self._future = self._executor.submit(self._run_job, project_root)
            return self.status()

    def cancel(self) -> RunStatusResponse:
        with self._lock:
            if self._status != RunStatus.running:
                raise HTTPException(status_code=400, detail="No run in progress")
            self._cancel.set()
            self._message = "Cancel requested"
            return self.status()

    def _set(
        self,
        *,
        status: Optional[RunStatus] = None,
        progress: Optional[float] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        with self._lock:
            if status is not None:
                self._status = status
            if progress is not None:
                self._progress = progress
            if message is not None:
                self._message = message
            if error is not None:
                self._error = error

    def _run_job(self, project_root: Path) -> None:
        try:

            def progress(pct: float, msg: str) -> None:
                self._set(progress=pct, message=msg)

            compute_flow_accumulation(
                project_root,
                progress=progress,
                cancelled=self._cancel,
            )
            if self._cancel.is_set():
                self._set(
                    status=RunStatus.cancelled,
                    progress=0.0,
                    message="Flow accumulation cancelled",
                )
                return
            self._set(
                status=RunStatus.completed,
                progress=100.0,
                message="Flow accumulation complete",
            )
        except InterruptedError:
            self._set(
                status=RunStatus.cancelled,
                progress=0.0,
                message="Flow accumulation cancelled",
            )
        except HTTPException as exc:
            self._set(
                status=RunStatus.failed,
                progress=0.0,
                message="Flow accumulation failed",
                error=str(exc.detail),
            )
        except Exception as exc:
            self._set(
                status=RunStatus.failed,
                progress=0.0,
                message="Flow accumulation failed",
                error=f"{exc}\n{traceback.format_exc()}",
            )


flow_accum_run_service = FlowAccumRunService()
