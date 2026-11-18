"""Export hybrid flood depths as DEM-aligned GeoTIFFs (project CRS)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.services.hybrid.paths import ensure_hybrid_dir, hybrid_results_path
from app.services.hybrid.surface_model import load_surface
from app.services.hybrid.surface_prep import FT, find_dem, project_crs


def export_dir(project_root: Path) -> Path:
    d = ensure_hybrid_dir(project_root) / "export"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_max_depth_grid(project_root: Path) -> tuple[np.ndarray, dict[str, float], int, int]:
    path = hybrid_results_path(project_root)
    if not path.is_file():
        raise FileNotFoundError(f"No hybrid results: {path}")
    data = np.load(path, allow_pickle=False)
    nx = int(data["nx"])
    ny = int(data["ny"])
    bounds = {
        "xmin": float(data["xmin"]),
        "ymin": float(data["ymin"]),
        "xmax": float(data["xmax"]),
        "ymax": float(data["ymax"]),
    }
    if "max_depth" in data:
        flat = np.asarray(data["max_depth"], dtype=np.float32).ravel()
    else:
        depths = np.asarray(data["depths"], dtype=np.float32)
        flat = np.nanmax(depths, axis=0).astype(np.float32)
    if flat.size != nx * ny:
        raise ValueError(f"max_depth size {flat.size} != {nx}*{ny}")
    return flat.reshape(ny, nx), bounds, nx, ny


def _dem_layer_meta(project_root: Path) -> Optional[dict[str, Any]]:
    path = project_root / "gis" / "layers.json"
    if not path.is_file():
        return None
    try:
        layers = json.loads(path.read_text(encoding="utf-8")).get("layers", [])
    except Exception:
        return None
    for layer in layers:
        if str(layer.get("type", "")).lower() == "dem":
            return layer
    return None


def _dem_bounds_project_crs(
    project_root: Path, crs: str, dem_w: int, dem_h: int
) -> tuple[float, float, float, float]:
    """xmin, ymin, xmax, ymax in project CRS for the DEM pixel array."""
    meta = _dem_layer_meta(project_root)
    if meta and meta.get("bounds"):
        from pyproj import Transformer

        b = meta["bounds"]
        to_proj = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        x0, y0 = to_proj.transform(float(b["west"]), float(b["south"]))
        x1, y1 = to_proj.transform(float(b["east"]), float(b["north"]))
        return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)

    _, hb, _, _ = _load_max_depth_grid(project_root)
    return hb["xmin"], hb["ymin"], hb["xmax"], hb["ymax"]


def export_flood_rasters(
    project_root: Path,
    *,
    dry_depth_m: Optional[float] = None,
) -> dict[str, Any]:
    """Upsample peak flood depth onto the DEM pixel grid in project CRS.

    Writes under ``hybrid/export/``:
    - ``max_depth_m.tif`` — peak depth [m], nodata where dry
    - ``max_wse_m.tif`` — water-surface elevation [m] = DEM_m + depth (wet only)
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject

    surface = load_surface(project_root)
    dem_path = find_dem(project_root, surface)
    if dem_path is None or not dem_path.is_file():
        raise FileNotFoundError("No DEM layer found for flood raster export")

    dry = float(dry_depth_m if dry_depth_m is not None else (surface.dry_depth or 0.001))
    crs = project_crs(project_root) or "EPSG:2272"
    grid, hbounds, nx, ny = _load_max_depth_grid(project_root)

    with rasterio.open(dem_path) as dem:
        dem_h, dem_w = dem.height, dem.width
        dem_z = dem.read(1, out_dtype=np.float32)
        dem_nodata = dem.nodata

    dxmin, dymin, dxmax, dymax = _dem_bounds_project_crs(project_root, crs, dem_w, dem_h)
    dem_transform = from_bounds(dxmin, dymin, dxmax, dymax, dem_w, dem_h)
    src_transform = from_bounds(
        hbounds["xmin"], hbounds["ymin"], hbounds["xmax"], hbounds["ymax"], nx, ny
    )

    z_mode = getattr(surface, "dem_z_units", "auto") or "auto"
    z_to_m = 1.0 if z_mode == "m" else FT
    dem_m = dem_z.astype(np.float64) * z_to_m
    if dem_nodata is not None:
        dem_m = np.where(dem_z == np.float32(dem_nodata), np.nan, dem_m)
    dem_m = np.where(np.isfinite(dem_m) & (dem_m > -1e4), dem_m, np.nan)

    # Hybrid grid is south-row-0; rasterio expects north-up
    src_depth = np.flipud(grid).astype(np.float32)
    depth_on_dem = np.full((dem_h, dem_w), np.nan, dtype=np.float32)
    reproject(
        source=src_depth,
        destination=depth_on_dem,
        src_transform=src_transform,
        src_crs=crs,
        src_nodata=np.nan,
        dst_transform=dem_transform,
        dst_crs=crs,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )

    wet = np.isfinite(depth_on_dem) & (depth_on_dem >= dry) & np.isfinite(dem_m)
    depth_out = np.where(wet, depth_on_dem, np.nan).astype(np.float32)
    wse_out = np.where(wet, dem_m + depth_on_dem, np.nan).astype(np.float32)

    out_dir = export_dir(project_root)
    depth_path = out_dir / "max_depth_m.tif"
    wse_path = out_dir / "max_wse_m.tif"
    profile = {
        "driver": "GTiff",
        "height": dem_h,
        "width": dem_w,
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": dem_transform,
        "nodata": np.nan,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    with rasterio.open(depth_path, "w", **profile) as dst:
        dst.write(depth_out, 1)
        dst.update_tags(
            description="Hybrid peak flood depth (m), upsampled onto DEM grid",
            units="m",
            source_nx=str(nx),
            source_ny=str(ny),
            dry_depth_m=str(dry),
        )
    with rasterio.open(wse_path, "w", **profile) as dst:
        dst.write(wse_out, 1)
        dst.update_tags(
            description="Hybrid peak WSE (m) = DEM_m + depth",
            units="m",
            dem=str(dem_path.name),
            dem_z_to_m=str(z_to_m),
        )

    wet_frac = float(wet.mean()) if wet.size else 0.0
    return {
        "ok": True,
        "crs": str(crs),
        "dem": str(dem_path),
        "depth_tif": str(depth_path),
        "wse_tif": str(wse_path),
        "dem_shape": [dem_h, dem_w],
        "source_shape": [ny, nx],
        "wet_fraction": wet_frac,
        "depth_max_m": float(np.nanmax(depth_out)) if np.isfinite(depth_out).any() else 0.0,
        "wse_min_m": float(np.nanmin(wse_out)) if np.isfinite(wse_out).any() else None,
        "wse_max_m": float(np.nanmax(wse_out)) if np.isfinite(wse_out).any() else None,
        "dem_bounds_project": [dxmin, dymin, dxmax, dymax],
        "hybrid_bounds": [
            hbounds["xmin"],
            hbounds["ymin"],
            hbounds["xmax"],
            hbounds["ymax"],
        ],
    }
