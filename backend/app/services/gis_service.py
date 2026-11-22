from __future__ import annotations

import json
import math
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.project_service import project_service

DEFAULT_PROJECT_CRS = "EPSG:25832"
MAX_PREVIEW_EDGE = 2048
SIMPLIFY_TOLERANCE_M = 1.5
MAX_PREVIEW_VERTICES = 50_000


class NeedsCrsError(Exception):
    """Raised when source CRS cannot be detected and caller must supply source_crs."""

    def __init__(self, message: str = "Source CRS unknown; provide source_crs") -> None:
        super().__init__(message)
        self.message = message


VECTOR_SUFFIXES = (".shp", ".zip", ".geojson", ".json", ".gpkg", ".kml", ".kmz", ".fgb", ".gml")


def _field_names(features: list[dict[str, Any]], limit: int = 200) -> list[str]:
    """Attribute names, in first-seen order, from the first features."""
    seen: dict[str, None] = {}
    for f in features[:limit]:
        for k in (f.get("properties") or {}):
            seen.setdefault(str(k), None)
    return list(seen)


def _slug(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip())[:40].strip("_")
    return s.lower() or "layer"


def _normalize_epsg(crs: Optional[str]) -> Optional[str]:
    if crs is None:
        return None
    s = str(crs).strip()
    if not s:
        return None
    if s.upper().startswith("EPSG:"):
        return f"EPSG:{s.split(':', 1)[1].strip()}"
    if s.isdigit():
        return f"EPSG:{s}"
    return s


class GisService:
    def project_crs(self) -> str:
        try:
            return project_service.get_crs()
        except Exception:
            return DEFAULT_PROJECT_CRS

    def set_project_crs(self, crs: str) -> None:
        """Keep gis/layers.json project_crs in sync with project settings."""
        code = _normalize_epsg(crs) or DEFAULT_PROJECT_CRS
        man = self._read_manifest()
        man["project_crs"] = code
        self._write_manifest(man)

    def _gis_root(self) -> Path:
        root = project_service.require_root()
        gis = root / "gis"
        (gis / "source").mkdir(parents=True, exist_ok=True)
        (gis / "preview").mkdir(parents=True, exist_ok=True)
        return gis

    def _manifest_path(self) -> Path:
        return self._gis_root() / "layers.json"

    def _read_manifest(self) -> dict[str, Any]:
        path = self._manifest_path()
        if not path.is_file():
            return {"layers": [], "project_crs": self.project_crs()}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"layers": [], "project_crs": self.project_crs()}
        if not isinstance(data, dict):
            return {"layers": [], "project_crs": self.project_crs()}
        data.setdefault("layers", [])
        data.setdefault("project_crs", self.project_crs())
        return data

    def _write_manifest(self, data: dict[str, Any]) -> None:
        path = self._manifest_path()
        path.write_text(json.dumps(data, indent=2), encoding="utf-8", newline="\n")

    def _layer_to_api(self, layer: dict[str, Any]) -> dict[str, Any]:
        lid = layer["id"]
        ltype = layer.get("type", "vector")
        out = {
            "id": lid,
            "name": layer.get("name", lid),
            "type": ltype,
            "crs": layer.get("crs", self.project_crs()),
            "source_crs": layer.get("source_crs"),
            "visible": bool(layer.get("visible", True)),
            "opacity": float(layer.get("opacity", 0.7)),
            "z_order": int(layer.get("z_order", 0)),
            "bounds": layer.get("bounds"),
            "feature_count": layer.get("feature_count"),
            "geometry_types": layer.get("geometry_types") or [],
            "cell_size": layer.get("cell_size"),
            "warning": layer.get("warning"),
            "preview_url": (
                f"/api/gis/preview/{lid}/hillshade.png"
                if ltype == "dem"
                else None
                if ltype == "tiles"
                else f"/api/gis/preview/{lid}/vector.geojson"
            ),
            "style": layer.get("style"),
            "web": layer.get("web"),
            "fields": layer.get("fields") or [],
        }
        return out

    def list_layers(self) -> dict[str, Any]:
        man = self._read_manifest()
        layers = sorted(man.get("layers", []), key=lambda L: int(L.get("z_order", 0)))
        return {
            "layers": [self._layer_to_api(L) for L in layers],
            "project_crs": man.get("project_crs", self.project_crs()),
        }

    def get_layer(self, layer_id: str) -> dict[str, Any]:
        man = self._read_manifest()
        for L in man.get("layers", []):
            if L.get("id") == layer_id:
                info = self._layer_to_api(L)
                info["source_path"] = L.get("source_path")
                return info
        raise HTTPException(status_code=404, detail=f"Layer not found: {layer_id}")

    def patch_layer(self, layer_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        man = self._read_manifest()
        found = None
        for L in man.get("layers", []):
            if L.get("id") == layer_id:
                found = L
                break
        if found is None:
            raise HTTPException(status_code=404, detail=f"Layer not found: {layer_id}")
        if patch.get("visible") is not None:
            found["visible"] = bool(patch["visible"])
        if patch.get("opacity") is not None:
            found["opacity"] = max(0.0, min(1.0, float(patch["opacity"])))
        if patch.get("z_order") is not None:
            found["z_order"] = int(patch["z_order"])
        if patch.get("name") is not None:
            found["name"] = str(patch["name"]).strip() or found["name"]
        if patch.get("style") is not None:
            style = dict(found.get("style") or {})
            for k, v in patch["style"].items():
                if v is None:
                    continue
                style[k] = v
            # an empty label field turns labels off
            if style.get("label_field") == "":
                style.pop("label_field")
            found["style"] = style
        self._write_manifest(man)
        return self._layer_to_api(found)

    def delete_layer(self, layer_id: str) -> dict[str, Any]:
        man = self._read_manifest()
        layers = man.get("layers", [])
        found = None
        remaining = []
        for L in layers:
            if L.get("id") == layer_id:
                found = L
            else:
                remaining.append(L)
        if found is None:
            raise HTTPException(status_code=404, detail=f"Layer not found: {layer_id}")
        man["layers"] = remaining
        self._write_manifest(man)
        gis = self._gis_root()
        for key in ("source_rel", "preview_rel", "bounds_rel", "meta_rel"):
            rel = found.get(key)
            if not rel:
                continue
            p = gis / rel
            if p.is_file():
                try:
                    p.unlink()
                except OSError:
                    pass
        folder = gis / "source" / layer_id
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
        return self.list_layers()

    def preview_path(self, layer_id: str, kind: str) -> Path:
        man = self._read_manifest()
        for L in man.get("layers", []):
            if L.get("id") != layer_id:
                continue
            if kind == "hillshade" and L.get("type") == "dem":
                rel = L.get("preview_rel")
                if not rel:
                    break
                path = self._gis_root() / rel
                if path.is_file():
                    return path
            if kind == "vector" and L.get("type") == "vector":
                rel = L.get("preview_rel")
                if not rel:
                    break
                path = self._gis_root() / rel
                if path.is_file():
                    return path
            if kind == "bounds" and L.get("type") == "dem":
                rel = L.get("bounds_rel")
                if not rel:
                    break
                path = self._gis_root() / rel
                if path.is_file():
                    return path
        raise HTTPException(status_code=404, detail=f"Preview not found for {layer_id}")

    def _new_id(self, prefix: str, name: str) -> str:
        return f"{prefix}_{_slug(name)}_{uuid.uuid4().hex[:8]}"

    def _validate_source_path(self, source_path: str) -> Path:
        try:
            p = Path(source_path).expanduser().resolve()
        except OSError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid path: {exc}") from exc
        if not p.is_file():
            raise HTTPException(status_code=404, detail=f"File not found: {p}")
        return p

    def _project_to_wgs84_bounds(
        self, minx: float, miny: float, maxx: float, maxy: float, crs: str
    ) -> dict[str, float]:
        from pyproj import Transformer

        transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        corners = [
            transformer.transform(minx, miny),
            transformer.transform(maxx, miny),
            transformer.transform(minx, maxy),
            transformer.transform(maxx, maxy),
        ]
        lngs = [c[0] for c in corners]
        lats = [c[1] for c in corners]
        return {
            "west": min(lngs),
            "south": min(lats),
            "east": max(lngs),
            "north": max(lats),
        }

    # ------------------------------------------------------------------ DEM
    def _cog_profile(self, base: dict[str, Any], **updates: Any) -> dict[str, Any]:
        """Tiled Deflate GeoTIFF profile for streaming reads / large DEMs."""
        profile = dict(base)
        profile.update(
            compress="deflate",
            tiled=True,
            blockxsize=512,
            blockysize=512,
            BIGTIFF="IF_SAFER",
        )
        profile.update(updates)
        return profile

    def _copy_raster_windowed(self, src: Any, dest_tif: Path, profile: dict[str, Any]) -> None:
        """Copy raster in windows — never materialize the full array."""
        import rasterio
        from rasterio.windows import Window

        width = int(profile["width"])
        height = int(profile["height"])
        count = int(profile.get("count", src.count))
        block = int(profile.get("blockxsize", 512))
        with rasterio.open(dest_tif, "w", **profile) as dst:
            for i in range(1, count + 1):
                for row in range(0, height, block):
                    h = min(block, height - row)
                    for col in range(0, width, block):
                        w = min(block, width - col)
                        window = Window(col, row, w, h)
                        data = src.read(i, window=window)
                        dst.write(data, i, window=window)

    def ingest_dem(
        self,
        source_path: str,
        *,
        name: Optional[str] = None,
        source_crs: Optional[str] = None,
        copy: bool = True,
    ) -> dict[str, Any]:
        import numpy as np
        import rasterio
        from rasterio.crs import CRS
        from rasterio.enums import Resampling
        from rasterio.warp import calculate_default_transform, reproject

        src_file = self._validate_source_path(source_path)
        if src_file.suffix.lower() not in (".tif", ".tiff", ".geotiff"):
            raise HTTPException(
                status_code=400,
                detail="DEM must be a GeoTIFF (.tif / .tiff)",
            )

        layer_name = (name or src_file.stem).strip() or "DEM"
        layer_id = self._new_id("dem", layer_name)
        gis = self._gis_root()
        dest_tif = gis / "source" / f"{layer_id}.tif"
        preview_png = gis / "preview" / f"{layer_id}_hillshade.png"
        bounds_json = gis / "preview" / f"{layer_id}_bounds.json"

        forced = _normalize_epsg(source_crs)
        project_crs = self.project_crs()
        detected = None
        external_ref = False

        with rasterio.open(src_file) as src:
            if src.crs is not None:
                try:
                    epsg = src.crs.to_epsg()
                    detected = f"EPSG:{epsg}" if epsg else src.crs.to_string()
                except Exception:
                    detected = str(src.crs)
            if detected is None and forced is None:
                raise NeedsCrsError(
                    "DEM has no CRS tag; provide source_crs (e.g. EPSG:25832)"
                )
            in_crs = CRS.from_user_input(forced or detected)
            dst_crs = CRS.from_user_input(project_crs)
            same_crs = False
            try:
                same_crs = in_crs == dst_crs or (
                    in_crs.to_epsg() is not None and in_crs.to_epsg() == dst_crs.to_epsg()
                )
            except Exception:
                same_crs = False

            if not copy:
                if not same_crs:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "copy=false requires DEM CRS to match project CRS. "
                            "Reproject on ingest (copy=true) or set matching source_crs."
                        ),
                    )
                # Reference external file — no project copy.
                dem_path_for_preview = src_file
                external_ref = True
                source_rel = None
                stored_source_path = str(src_file)
            elif same_crs:
                profile = self._cog_profile(
                    src.profile,
                    crs=dst_crs,
                    width=src.width,
                    height=src.height,
                    transform=src.transform,
                )
                self._copy_raster_windowed(src, dest_tif, profile)
                dem_path_for_preview = dest_tif
                source_rel = f"source/{dest_tif.name}"
                stored_source_path = str(dest_tif)
            else:
                transform, width, height = calculate_default_transform(
                    in_crs,
                    dst_crs,
                    src.width,
                    src.height,
                    *src.bounds,
                )
                profile = self._cog_profile(
                    src.profile,
                    crs=dst_crs,
                    transform=transform,
                    width=width,
                    height=height,
                )
                with rasterio.open(dest_tif, "w", **profile) as dst:
                    for i in range(1, src.count + 1):
                        reproject(
                            source=rasterio.band(src, i),
                            destination=rasterio.band(dst, i),
                            src_transform=src.transform,
                            src_crs=in_crs,
                            dst_transform=transform,
                            dst_crs=dst_crs,
                            resampling=Resampling.bilinear,
                        )
                dem_path_for_preview = dest_tif
                source_rel = f"source/{dest_tif.name}"
                stored_source_path = str(dest_tif)

        # Build downsampled hillshade preview (always from readable path)
        with rasterio.open(dem_path_for_preview) as dem:
            scale = max(dem.width, dem.height) / MAX_PREVIEW_EDGE
            if scale < 1:
                scale = 1.0
            out_w = max(1, int(dem.width / scale))
            out_h = max(1, int(dem.height / scale))
            elev = dem.read(
                1,
                out_shape=(out_h, out_w),
                resampling=Resampling.bilinear,
            ).astype("float64")
            nodata = dem.nodata
            if nodata is not None:
                elev = np.where(elev == nodata, np.nan, elev)
            # Approximate cell size in meters (project CRS)
            cell_x = abs(dem.transform.a) * scale
            cell_y = abs(dem.transform.e) * scale
            cell_size = float((cell_x + cell_y) / 2.0) if scale else float(
                (abs(dem.transform.a) + abs(dem.transform.e)) / 2.0
            )
            # Use pixel spacing for gradient
            gy, gx = np.gradient(elev, cell_y or 1.0, cell_x or 1.0)
            slope = np.pi / 2.0 - np.arctan(np.hypot(gx, gy))
            aspect = np.arctan2(-gx, gy)
            azimuth = 315.0 * math.pi / 180.0
            altitude = 45.0 * math.pi / 180.0
            shaded = np.sin(altitude) * np.sin(slope) + np.cos(altitude) * np.cos(
                slope
            ) * np.cos(azimuth - aspect)
            shaded = np.clip(shaded, 0, 1)
            shaded = np.nan_to_num(shaded, nan=0.0)
            img = (shaded * 255).astype("uint8")

            from PIL import Image

            Image.fromarray(img, mode="L").save(preview_png, format="PNG", optimize=True)

            b = dem.bounds
            bounds = self._project_to_wgs84_bounds(
                b.left, b.bottom, b.right, b.top, project_crs
            )
            bounds_json.write_text(json.dumps(bounds, indent=2), encoding="utf-8")

        man = self._read_manifest()
        z_order = max((int(L.get("z_order", 0)) for L in man["layers"]), default=-1) + 1
        entry: dict[str, Any] = {
            "id": layer_id,
            "name": layer_name,
            "type": "dem",
            "crs": project_crs,
            "source_crs": forced or detected,
            "visible": True,
            "opacity": 0.65,
            "z_order": z_order,
            "bounds": bounds,
            "cell_size": cell_size,
            "preview_rel": f"preview/{preview_png.name}",
            "bounds_rel": f"preview/{bounds_json.name}",
            "source_path": stored_source_path,
            "external": external_ref,
        }
        if source_rel:
            entry["source_rel"] = source_rel
        man["layers"].append(entry)
        self._write_manifest(man)
        return self._layer_to_api(entry)

    # -------------------------------------------------------------- Vector
    def ingest_vector(
        self,
        source_path: str,
        *,
        name: Optional[str] = None,
        source_crs: Optional[str] = None,
    ) -> dict[str, Any]:
        import tempfile

        import pyogrio
        from pyproj import Transformer
        from shapely.geometry import mapping, shape
        from shapely.ops import transform as shp_transform

        src_file = self._validate_source_path(source_path)
        layer_name = (name or src_file.stem).strip() or "Vector"
        layer_id = self._new_id("vec", layer_name)
        gis = self._gis_root()
        dest_source = gis / "source" / f"{layer_id}{src_file.suffix.lower()}"
        preview_geojson = gis / "preview" / f"{layer_id}.geojson"
        meta_json = gis / "preview" / f"{layer_id}_meta.json"

        suffix = src_file.suffix.lower()
        if suffix not in VECTOR_SUFFIXES:
            raise HTTPException(
                status_code=400,
                detail="Unsupported vector file. Use a shapefile (.shp or .zip), GeoJSON, GeoPackage, KML/KMZ, FlatGeobuf or GML.",
            )
        # Copy the original into the project; a .shp brings its sidecar files.
        if suffix == ".shp":
            dest_source = gis / "source" / layer_id / src_file.name
            dest_source.parent.mkdir(parents=True, exist_ok=True)
            for side in src_file.parent.glob(src_file.stem + ".*"):
                shutil.copy2(side, dest_source.parent / side.name)
        else:
            shutil.copy2(src_file, dest_source)

        work_path = dest_source
        tmp_dir: Optional[tempfile.TemporaryDirectory[str]] = None
        try:
            if suffix in (".zip", ".kmz"):
                tmp_dir = tempfile.TemporaryDirectory(prefix="swmm_vec_")
                with zipfile.ZipFile(dest_source, "r") as zf:
                    zf.extractall(tmp_dir.name)
                inside = [
                    p
                    for ext in (".shp", ".gpkg", ".geojson", ".json", ".kml", ".fgb", ".gml")
                    for p in sorted(Path(tmp_dir.name).rglob(f"*{ext}"))
                    if not p.name.startswith(".")
                ]
                if not inside:
                    raise HTTPException(
                        status_code=400,
                        detail="The archive has no shapefile, GeoPackage, GeoJSON or KML in it",
                    )
                work_path = inside[0]

            info = pyogrio.read_info(str(work_path))
            detected = None
            crs_meta = info.get("crs")
            if crs_meta:
                detected = str(crs_meta)
                m = re.search(r"EPSG[:\s]*(\d+)", detected, re.I)
                if m:
                    detected = f"EPSG:{m.group(1)}"

            forced = _normalize_epsg(source_crs)
            if detected is None and forced is None and work_path.suffix.lower() in (".geojson", ".json", ".kml"):
                detected = "EPSG:4326"  # GeoJSON and KML are lon/lat by definition
            if detected is None and forced is None:
                raise NeedsCrsError(
                    "This file has no coordinate system (.prj); provide source_crs (e.g. EPSG:25832)"
                )
            in_crs = forced or detected or self.project_crs()
            project_crs = self.project_crs()

            # Prefer geopandas path; fall back to pyogrio.raw
            geometries: list[Any] = []
            props_list: list[dict[str, Any]] = []
            try:
                gdf = pyogrio.read_dataframe(str(work_path))
                geometries = list(gdf.geometry)
                records = gdf.drop(columns=["geometry"], errors="ignore")
                props_list = records.to_dict(orient="records")
            except Exception:
                from pyogrio.raw import read as raw_read
                from shapely import from_wkb

                meta, arrs = raw_read(str(work_path))
                # Last array is typically geometry WKB
                geom_arr = arrs[-1]
                geometries = [
                    from_wkb(g) if g is not None else None for g in geom_arr
                ]
                fields = meta.get("fields") or []
                field_names = [f[0] if isinstance(f, (list, tuple)) else str(f) for f in fields]
                for i in range(len(geometries)):
                    props: dict[str, Any] = {}
                    for fi, fname in enumerate(field_names):
                        try:
                            props[str(fname)] = arrs[fi][i]
                        except Exception:
                            pass
                    props_list.append(props)

            to_project = Transformer.from_crs(in_crs, project_crs, always_xy=True)
            to_wgs = Transformer.from_crs(project_crs, "EPSG:4326", always_xy=True)

            def to_proj_xy(x: float, y: float, z: float | None = None) -> tuple[float, ...]:
                return to_project.transform(x, y)

            def to_wgs_xy(x: float, y: float, z: float | None = None) -> tuple[float, ...]:
                return to_wgs.transform(x, y)

            features: list[dict[str, Any]] = []
            geom_types: set[str] = set()
            vertex_count = 0
            minx = miny = float("inf")
            maxx = maxy = float("-inf")
            warning = None

            def count_vertices(g: Any) -> int:
                try:
                    return len(g.coords)  # type: ignore[attr-defined]
                except Exception:
                    pass
                total = 0
                for part in getattr(g, "geoms", []) or []:
                    total += count_vertices(part)
                if hasattr(g, "exterior") and g.exterior is not None:
                    total += len(g.exterior.coords)
                    for ring in g.interiors:
                        total += len(ring.coords)
                return total or 1

            for i, geom in enumerate(geometries):
                if geom is None or geom.is_empty:
                    continue
                g_proj = shp_transform(to_proj_xy, geom)
                if SIMPLIFY_TOLERANCE_M > 0:
                    try:
                        g_proj = g_proj.simplify(
                            SIMPLIFY_TOLERANCE_M, preserve_topology=True
                        )
                    except Exception:
                        pass
                g_wgs = shp_transform(to_wgs_xy, g_proj)
                geom_types.add(g_wgs.geom_type)
                vertex_count += count_vertices(g_wgs)

                bx = g_proj.bounds
                minx = min(minx, bx[0])
                miny = min(miny, bx[1])
                maxx = max(maxx, bx[2])
                maxy = max(maxy, bx[3])

                props = props_list[i] if i < len(props_list) else {}
                clean: dict[str, Any] = {}
                for k, v in props.items():
                    if v is None:
                        continue
                    if hasattr(v, "item"):
                        try:
                            v = v.item()
                        except Exception:
                            pass
                    if isinstance(v, (str, int, float, bool)):
                        clean[str(k)] = v
                    else:
                        clean[str(k)] = str(v)

                features.append(
                    {
                        "type": "Feature",
                        "properties": clean,
                        "geometry": mapping(g_wgs),
                    }
                )

            if vertex_count > MAX_PREVIEW_VERTICES:
                warning = (
                    f"Preview has ~{vertex_count} vertices "
                    f"(>{MAX_PREVIEW_VERTICES}); further simplified for display. "
                    "Full source kept on disk."
                )
                # Extra simplify
                for f in features:
                    try:
                        g = shape(f["geometry"])
                        # Already in WGS84 — rough degree tolerance
                        g2 = g.simplify(0.00005, preserve_topology=True)
                        f["geometry"] = mapping(g2)
                    except Exception:
                        pass

            if not features:
                raise HTTPException(status_code=400, detail="No geometries found in this file")

            fc = {"type": "FeatureCollection", "features": features}
            preview_geojson.write_text(
                json.dumps(fc), encoding="utf-8", newline="\n"
            )

            bounds = self._project_to_wgs84_bounds(
                minx, miny, maxx, maxy, project_crs
            )
            meta = {
                "feature_count": len(features),
                "geometry_types": sorted(geom_types),
                "source_crs": in_crs,
                "crs": project_crs,
                "vertex_count": vertex_count,
                "warning": warning,
            }
            meta_json.write_text(json.dumps(meta, indent=2), encoding="utf-8")

            man = self._read_manifest()
            z_order = (
                max((int(L.get("z_order", 0)) for L in man["layers"]), default=-1) + 1
            )
            entry = {
                "id": layer_id,
                "name": layer_name,
                "type": "vector",
                "crs": project_crs,
                "source_crs": in_crs,
                "visible": True,
                "opacity": 0.55,
                "z_order": z_order,
                "bounds": bounds,
                "feature_count": len(features),
                "geometry_types": sorted(geom_types),
                "fields": _field_names(features),
                "warning": warning,
                "source_rel": str(dest_source.relative_to(gis)).replace("\\", "/"),
                "preview_rel": f"preview/{preview_geojson.name}",
                "meta_rel": f"preview/{meta_json.name}",
                "source_path": str(dest_source),
            }
            man["layers"].append(entry)
            self._write_manifest(man)
            return self._layer_to_api(entry)
        finally:
            if tmp_dir is not None:
                tmp_dir.cleanup()

    def _append_layer(self, entry: dict[str, Any]) -> dict[str, Any]:
        man = self._read_manifest()
        entry["z_order"] = max((int(L.get("z_order", 0)) for L in man["layers"]), default=-1) + 1
        man["layers"].append(entry)
        self._write_manifest(man)
        return self._layer_to_api(entry)

    def add_web_layer(self, name: str, web: dict[str, Any]) -> dict[str, Any]:
        """A layer drawn from a tile, WMS or ArcGIS map service (nothing stored but the address)."""
        url = str(web.get("url", "")).strip()
        if not re.match(r"^https?://", url, re.I):
            raise HTTPException(status_code=400, detail="The address must start with http:// or https://")
        name = name.strip() or "Web layer"
        entry = {
            "id": self._new_id("web", name),
            "name": name,
            "type": "tiles",
            "crs": "EPSG:3857",
            "visible": True,
            "opacity": 0.8,
            "web": {k: v for k, v in {**web, "url": url}.items() if v not in (None, "")},
        }
        return self._append_layer(entry)

    def add_geojson_layer(self, name: str, geojson: dict[str, Any], source: Optional[str] = None) -> dict[str, Any]:
        """A vector layer from GeoJSON in lon/lat (e.g. an ArcGIS feature service query)."""
        from shapely.geometry import shape

        feats = [f for f in (geojson.get("features") or []) if isinstance(f, dict) and f.get("geometry")]
        if not feats:
            raise HTTPException(status_code=400, detail="No features to add")
        minx = miny = float("inf")
        maxx = maxy = float("-inf")
        kinds: set[str] = set()
        for f in feats:
            g = shape(f["geometry"])
            kinds.add(g.geom_type)
            b = g.bounds
            minx, miny, maxx, maxy = min(minx, b[0]), min(miny, b[1]), max(maxx, b[2]), max(maxy, b[3])
        if not (-180 <= minx <= 180 and -90 <= miny <= 90 and -180 <= maxx <= 180 and -90 <= maxy <= 90):
            raise HTTPException(status_code=400, detail="Coordinates aren't longitude/latitude")
        name = name.strip() or "Layer"
        layer_id = self._new_id("vec", name)
        gis = self._gis_root()
        preview = gis / "preview" / f"{layer_id}.geojson"
        preview.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8", newline="\n")
        entry = {
            "id": layer_id,
            "name": name,
            "type": "vector",
            "crs": self.project_crs(),
            "source_crs": "EPSG:4326",
            "visible": True,
            "opacity": 0.7,
            "bounds": {"west": minx, "south": miny, "east": maxx, "north": maxy},
            "feature_count": len(feats),
            "geometry_types": sorted(kinds),
            "fields": _field_names(feats),
            "preview_rel": f"preview/{preview.name}",
            "source": source,
        }
        return self._append_layer(entry)

    def sample_dem_elevation(self, x: float, y: float, layer_id: Optional[str] = None) -> Optional[float]:
        """Sample elevation (project CRS) from a DEM layer. Returns None if no DEM / nodata."""
        try:
            zs = self.sample_dem_grid([x], [y], layer_id=layer_id)
        except HTTPException:
            return None
        return zs[0] if zs else None

    def _resolve_dem_path(self, layer_id: Optional[str] = None) -> Path:
        man = self._read_manifest()
        dems = [L for L in man.get("layers", []) if L.get("type") == "dem"]
        if layer_id:
            dems = [L for L in dems if L.get("id") == layer_id]
        if not dems:
            raise HTTPException(
                status_code=404,
                detail="No DEM layer in project. Add a DEM under Background layers first.",
            )
        layer = dems[0]
        rel = layer.get("source_rel")
        if rel:
            path = self._gis_root() / rel
            if path.is_file():
                return path
        # External reference (copy=false) or legacy absolute path
        abs_path = layer.get("source_path")
        if abs_path:
            p = Path(str(abs_path))
            if p.is_file():
                return p
        raise HTTPException(
            status_code=404,
            detail=f"DEM file missing for layer {layer.get('id')}",
        )

    def list_dem_layers(self) -> list[dict[str, Any]]:
        man = self._read_manifest()
        out: list[dict[str, Any]] = []
        for L in man.get("layers", []):
            if L.get("type") != "dem":
                continue
            out.append(
                {
                    "id": L.get("id"),
                    "name": L.get("name"),
                    "crs": L.get("crs"),
                }
            )
        return out

    def sample_dem_grid(
        self,
        xs: list[float],
        ys: list[float],
        *,
        layer_id: Optional[str] = None,
    ) -> list[Optional[float]]:
        """Bulk-sample DEM elevations in project CRS. One open; returns None for nodata."""
        import math as _math

        import rasterio

        if len(xs) != len(ys):
            raise HTTPException(status_code=400, detail="xs and ys length mismatch")
        if not xs:
            return []

        path = self._resolve_dem_path(layer_id)
        result: list[Optional[float]] = [None] * len(xs)
        with rasterio.open(path) as src:
            nodata = src.nodata
            coords = list(zip(xs, ys))
            try:
                samples = list(src.sample(coords))
            except Exception as exc:
                raise HTTPException(
                    status_code=400, detail=f"DEM sample failed: {exc}"
                ) from exc
            for i, row in enumerate(samples):
                try:
                    v = float(row[0])
                except Exception:
                    result[i] = None
                    continue
                if nodata is not None and v == nodata:
                    result[i] = None
                elif _math.isnan(v):
                    result[i] = None
                else:
                    result[i] = v
        return result


gis_service = GisService()
