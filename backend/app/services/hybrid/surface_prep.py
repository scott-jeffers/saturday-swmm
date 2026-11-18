"""Prepare Basilisk surface inputs: units, square domain, DEM on the AMR grid.

Basilisk runs in SI with local coordinates (metres from the domain's SW
corner). The SWMM model runs in its own units (US or SI). This module owns
every conversion between the two.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np

from app.models.schemas import HybridSurface

# SWMM flow units -> m3/s
FLOW_TO_CMS = {
    "CFS": 0.028316846592,
    "GPM": 6.30901964e-5,
    "MGD": 0.0438126364,
    "CMS": 1.0,
    "LPS": 0.001,
    "MLD": 0.011574074074,
}
US_FLOW_UNITS = frozenset({"CFS", "GPM", "MGD"})
FT = 0.3048  # SWMM's US length unit (international foot)


@dataclass
class Units:
    flow_units: str
    q_to_cms: float          # SWMM flow -> m3/s
    len_to_m: float          # SWMM length/elevation -> m
    xy_to_m: float           # project CRS horizontal unit -> m
    crs: Optional[str]       # project CRS (e.g. "EPSG:2272")

    @property
    def area_to_m2(self) -> float:
        return self.xy_to_m * self.xy_to_m


@dataclass
class Domain:
    """Square Basilisk domain in project CRS units."""
    xmin: float
    ymin: float
    size: float              # side length, project units

    def to_local(self, x: float, y: float, xy_to_m: float) -> tuple[float, float]:
        return (x - self.xmin) * xy_to_m, (y - self.ymin) * xy_to_m

    @property
    def xmax(self) -> float:
        return self.xmin + self.size

    @property
    def ymax(self) -> float:
        return self.ymin + self.size


def read_flow_units(inp_text_head: str) -> str:
    for line in inp_text_head.splitlines():
        toks = line.split()
        if len(toks) >= 2 and toks[0].upper() == "FLOW_UNITS":
            return toks[1].upper()
    return "CFS"


def project_crs(project_root: Path) -> Optional[str]:
    meta = project_root / ".saturday-swmm.json"
    if meta.is_file():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            crs = data.get("crs")
            if crs:
                return str(crs)
        except Exception:
            pass
    layers = project_root / "gis" / "layers.json"
    if layers.is_file():
        try:
            return json.loads(layers.read_text(encoding="utf-8")).get("project_crs")
        except Exception:
            pass
    return None


def crs_xy_to_m(crs: Optional[str], flow_units: str) -> float:
    if crs:
        try:
            from pyproj import CRS

            c = CRS.from_user_input(crs)
            f = c.axis_info[0].unit_conversion_factor if c.axis_info else None
            if f and f > 0 and not c.is_geographic:
                return float(f)
        except Exception:
            pass
    return FT if flow_units in US_FLOW_UNITS else 1.0


def resolve_units(project_root: Path, inp_path: Path) -> Units:
    with inp_path.open("r", encoding="utf-8", errors="replace") as fh:
        head = fh.read(20000)
    fu = read_flow_units(head)
    crs = project_crs(project_root)
    return Units(
        flow_units=fu,
        q_to_cms=FLOW_TO_CMS.get(fu, 1.0),
        len_to_m=FT if fu in US_FLOW_UNITS else 1.0,
        xy_to_m=crs_xy_to_m(crs, fu),
        crs=crs,
    )


def square_domain(surface: HybridSurface) -> Domain:
    ring = surface.domain_polygon or []
    xs = [float(p[0]) for p in ring]
    ys = [float(p[1]) for p in ring]
    if not xs:
        raise ValueError("hybrid surface has no domain polygon")
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    size = max(w, h, 1.0)
    cx, cy = 0.5 * (max(xs) + min(xs)), 0.5 * (max(ys) + min(ys))
    return Domain(xmin=cx - size / 2, ymin=cy - size / 2, size=size)


def find_dem(project_root: Path, surface: HybridSurface) -> Optional[Path]:
    """surface.dem_path, else the surface's GIS layer id, else first DEM layer."""
    if surface.dem_path:
        p = Path(surface.dem_path)
        if not p.is_absolute():
            p = project_root / p
        if p.is_file():
            return p
    layers_json = project_root / "gis" / "layers.json"
    if not layers_json.is_file():
        return None
    try:
        layers = json.loads(layers_json.read_text(encoding="utf-8")).get("layers", [])
    except Exception:
        return None
    dems = [l for l in layers if str(l.get("type", "")).lower() == "dem"]
    if surface.dem_layer_id:
        dems = [l for l in dems if l.get("id") == surface.dem_layer_id] or dems
    for layer in dems:
        for key in ("source_rel",):
            rel = layer.get(key)
            if rel:
                p = project_root / "gis" / rel
                if p.is_file():
                    return p
        sp = layer.get("source_path")
        if sp and Path(sp).is_file():
            return Path(sp)
    return None


def dem_z_to_m(surface: HybridSurface, units: Units) -> float:
    mode = getattr(surface, "dem_z_units", "auto") or "auto"
    if mode == "m":
        return 1.0
    if mode == "ft":
        return FT
    return units.len_to_m  # DEM elevations assumed in model length units


def warp_dem_to_grid(
    dem_path: Path, domain: Domain, n: int, dst_crs: Optional[str]
) -> np.ndarray:
    """Average-resample the DEM onto an n x n grid over the square domain.

    Returns float32 (n, n), row 0 = south, NaN where there is no data.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT

    cell = domain.size / n
    transform = from_origin(domain.xmin, domain.ymax, cell, cell)
    with rasterio.open(dem_path) as src:
        crs = dst_crs or src.crs
        nodata = src.nodata
        with WarpedVRT(
            src,
            crs=crs,
            transform=transform,
            width=n,
            height=n,
            resampling=Resampling.average,
            src_nodata=nodata,
            nodata=np.nan,
            dtype="float32",
        ) as vrt:
            arr = vrt.read(1, out_dtype="float32")
    arr = np.asarray(arr, dtype=np.float32)
    if nodata is not None:
        arr[arr == np.float32(nodata)] = np.nan
    arr[arr < -1e4] = np.nan
    return np.flipud(arr).copy()


def dem_cache_key(dem_path: Path, domain: Domain, n: int, crs: Optional[str], zf: float) -> str:
    st = dem_path.stat()
    raw = f"{dem_path.resolve()}|{st.st_size}|{st.st_mtime}|{domain.xmin:.3f}|{domain.ymin:.3f}|{domain.size:.3f}|{n}|{crs}|{zf}"
    return hashlib.sha1(raw.encode()).hexdigest()


def prepare_dem_bin(
    workdir: Path,
    dem_path: Path,
    domain: Domain,
    level: int,
    crs: Optional[str],
    z_to_m: float,
) -> dict[str, Any]:
    """Write workdir/dem.bin (float32, SI) unless an identical one is cached."""
    n = 1 << level
    key = dem_cache_key(dem_path, domain, n, crs, z_to_m)
    stamp = workdir / "dem.key"
    out = workdir / "dem.bin"
    if out.is_file() and stamp.is_file() and stamp.read_text().strip() == key:
        info = json.loads((workdir / "dem.json").read_text())
        info["cached"] = True
        return info
    arr = warp_dem_to_grid(dem_path, domain, n, crs)
    valid = np.isfinite(arr)
    if not valid.any():
        raise ValueError(
            f"DEM {dem_path.name} does not overlap the hybrid domain "
            f"(check the DEM layer CRS vs project CRS {crs})"
        )
    zm = np.where(valid, arr * z_to_m, np.nan).astype(np.float32)
    workdir.mkdir(parents=True, exist_ok=True)
    np.where(valid, zm, np.float32(1e20)).astype(np.float32).tofile(out)
    info = {
        "n": n,
        "level": level,
        "valid_fraction": float(valid.mean()),
        "z_min_m": float(np.nanmin(zm)),
        "z_max_m": float(np.nanmax(zm)),
        "cell_m": domain.size / n * 0,  # filled by caller
        "dem": str(dem_path),
        "cached": False,
    }
    (workdir / "dem.json").write_text(json.dumps(info))
    stamp.write_text(key)
    return info


def bed_at(dem_bin: Path, n: int, xy_local_m: Sequence[tuple[float, float]], L_m: float) -> np.ndarray:
    """Sample dem.bin (SI) at local points — used for diagnostics/tests."""
    arr = np.fromfile(dem_bin, dtype=np.float32).reshape(n, n)
    out = []
    for x, y in xy_local_m:
        i = min(n - 1, max(0, int(math.floor(x / L_m * n))))
        j = min(n - 1, max(0, int(math.floor(y / L_m * n))))
        out.append(float(arr[j, i]))
    return np.array(out)
