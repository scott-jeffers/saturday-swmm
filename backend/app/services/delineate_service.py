"""Delineate the area draining to a point from the project's DEM.

Click an outlet on the map: the point snaps to the strongest flow path within
a short distance, every DEM cell that drains to it is traced, and the result
comes back as a subcatchment-ready polygon with its area, mean slope, longest
flow path, SWMM width (area / flow length) and, if NLCD impervious data has
been downloaded for the project, its mean imperviousness.

Uses the same depression filling and D8 flow directions as the flow
accumulation engine (flow_accum_service), on the DEM resampled to the
project's coordinate system.
"""

from __future__ import annotations

import math
import threading
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import HTTPException

from app.services.flow_accum_service import _D8_DC, _D8_DIST, _D8_DR, _load_dem_grid, _priority_flood_with_flow, _xy_to_m

#: Grid size for delineation: detailed enough for parcels, quick enough to click.
MAX_EDGE = 900

_cache: dict[str, Any] = {}
_lock = threading.Lock()


def _grid(dem_path: Path, crs: str) -> dict[str, Any]:
    """DEM, flow directions, receivers and topological order, cached per DEM file."""
    key = f"{dem_path}|{dem_path.stat().st_mtime_ns}|{crs}"
    with _lock:
        if _cache.get("key") == key:
            return _cache["grid"]
    import rasterio

    # Never finer than the DEM itself: resampling up adds cells, not detail.
    with rasterio.open(dem_path) as src:
        native = max(src.width, src.height)
    elev, transform, cx, cy, _ = _load_dem_grid(dem_path, crs, max_edge=min(MAX_EDGE, native))
    active = np.isfinite(elev)
    if not active.any():
        raise HTTPException(status_code=400, detail="The DEM has no elevations here")
    _filled, fdir = _priority_flood_with_flow(elev, threading.Event())
    h, w = fdir.shape
    n = h * w
    receivers = np.full(n, -1, dtype=np.int64)
    step = np.zeros(n, dtype=np.float64)
    rows = np.arange(h)[:, None]
    cols = np.arange(w)[None, :]
    for d in range(8):
        m = (fdir == d) & active
        nr, nc = rows + _D8_DR[d], cols + _D8_DC[d]
        ok = m & (nr >= 0) & (nr < h) & (nc >= 0) & (nc < w)
        src = (rows * w + cols)[ok]
        dst = (nr * w + nc)[ok]
        keep = active.ravel()[dst]
        receivers[src[keep]] = dst[keep]
        # Diagonal steps are longer; cells may not be square.
        step[src[keep]] = math.hypot(cx * abs(_D8_DC[d]), cy * abs(_D8_DR[d])) if _D8_DIST[d] > 1 else (cx if _D8_DC[d] else cy)
    # Topological order (Kahn): sources first, outlets last; and cell counts.
    indeg = np.zeros(n, dtype=np.int64)
    np.add.at(indeg, receivers[receivers >= 0], 1)
    count = active.ravel().astype(np.float64)
    order: list[int] = np.flatnonzero(active.ravel() & (indeg == 0)).tolist()
    head = 0
    while head < len(order):
        i = order[head]
        head += 1
        j = int(receivers[i])
        if j < 0:
            continue
        count[j] += count[i]
        indeg[j] -= 1
        if indeg[j] == 0:
            order.append(j)
    grid = {
        "elev": elev, "active": active, "transform": transform, "cx": cx, "cy": cy,
        "receivers": receivers, "step": step, "order": np.asarray(order, dtype=np.int64), "count": count.reshape(h, w),
    }
    with _lock:
        _cache.clear()
        _cache.update(key=key, grid=grid)
    return grid


def delineate(x: float, y: float, snap: float | None = None) -> dict[str, Any]:
    """The area draining to project coordinate (x, y)."""
    import rasterio.features
    from pyproj import Transformer
    from shapely.geometry import mapping, shape

    from app.services.gis_service import gis_service
    from app.services.project_service import project_service

    root = Path(project_service.require_root())
    crs = gis_service.project_crs()
    if not crs:
        raise HTTPException(status_code=400, detail="Set the project's coordinate system first")
    dem_path = gis_service._resolve_dem_path()
    g = _grid(dem_path, crs)
    elev, active, tr, cx, cy = g["elev"], g["active"], g["transform"], g["cx"], g["cy"]
    h, w = elev.shape
    col, row = ~tr * (x, y)
    r0, c0 = int(math.floor(row)), int(math.floor(col))
    if not (0 <= r0 < h and 0 <= c0 < w) or not active[r0, c0]:
        raise HTTPException(status_code=400, detail="That point is outside the DEM. Click inside the area the DEM covers.")
    # Snap to the cell with the most upstream area within `snap` (project units).
    # Default: a few cells, and at least about 30 ft / 10 m.
    if snap is None:
        snap = max(6 * max(cx, cy), 10.0 / _xy_to_m(crs))
    rr = max(1, int(round(snap / cy)))
    rc = max(1, int(round(snap / cx)))
    win = g["count"][max(0, r0 - rr) : r0 + rr + 1, max(0, c0 - rc) : c0 + rc + 1]
    k = int(np.nanargmax(win))
    r, c = max(0, r0 - rr) + k // win.shape[1], max(0, c0 - rc) + k % win.shape[1]
    outlet = r * w + c

    # Everything upstream: walk the order from outlets back to sources.
    receivers, order, step = g["receivers"], g["order"], g["step"]
    inside = np.zeros(h * w, dtype=bool)
    dist = np.zeros(h * w, dtype=np.float64)
    inside[outlet] = True
    for i in order[::-1]:
        j = receivers[i]
        if j >= 0 and inside[j] and i != outlet:
            inside[i] = True
            dist[i] = dist[j] + step[i]
    mask = inside.reshape(h, w)
    cells = int(mask.sum())
    if cells < 3:
        raise HTTPException(status_code=400, detail="Almost nothing drains to that point. Click on or near a flow path.")

    # Polygon: the largest piece, simplified to about a cell.
    polys = [shape(geom) for geom, v in rasterio.features.shapes(mask.astype(np.uint8), mask=mask, transform=tr) if v == 1]
    poly = max(polys, key=lambda p: p.area).simplify(max(cx, cy) * 0.75, preserve_topology=True)
    if poly.geom_type != "Polygon":
        poly = poly.convex_hull
    ring = [[round(px, 3), round(py, 3)] for px, py in list(poly.exterior.coords)[:-1]]

    # Numbers SWMM needs. Elevations are in the DEM's vertical unit, which the
    # project's site data keeps equal to its horizontal unit.
    us = str(project_service.current().flow_units or "CFS").upper() in ("CFS", "GPM", "MGD")
    area_units = cells * cx * cy
    m_per_unit = _xy_to_m(crs)
    area_m2 = area_units * m_per_unit**2
    gy, gx = np.gradient(np.where(active, elev, np.nan), cy, cx)
    slope_pct = float(np.nanmean(np.hypot(gx, gy)[mask]) * 100)
    flow_len = float(dist.reshape(h, w)[mask].max()) + max(cx, cy) / 2
    width = area_units / flow_len if flow_len > 0 else None

    imperv = None
    try:
        import rasterio
        import rasterio.mask
        from shapely.ops import transform as stransform

        from app.services.site_data_service import site_data_service

        nlcd = site_data_service._nlcd_path(root)
        if nlcd.is_file():
            with rasterio.open(nlcd) as src:
                t = Transformer.from_crs(crs, src.crs, always_xy=True)
                arr, _ = rasterio.mask.mask(src, [mapping(stransform(t.transform, poly))], crop=True, filled=False)
                vals = arr[0].compressed()
                vals = vals[(vals >= 0) & (vals <= 100)]
                if vals.size:
                    imperv = round(float(vals.mean()), 1)
    except Exception:  # noqa: BLE001 (imperviousness is a bonus; delineation stands without it)
        imperv = None

    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    ox, oy = tr * (c + 0.5, r + 0.5)
    return {
        "polygon": ring,
        "polygon_wgs84": [[*to_wgs.transform(px, py)] for px, py in ring],
        "outlet": [round(ox, 3), round(oy, 3)],
        "outlet_wgs84": [*to_wgs.transform(ox, oy)],
        "snapped": bool((r, c) != (r0, c0)),
        "cells": cells,
        "area": round(area_m2 / 4046.8564224, 4) if us else round(area_m2 / 10000, 4),
        "area_units": "ac" if us else "ha",
        "slope_pct": round(slope_pct, 2),
        "flow_length": round(flow_len, 1),
        "width": round(width, 1) if width else None,
        "pct_imperv": imperv,
        "cell_size": round(max(cx, cy), 2),
    }
