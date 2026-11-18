"""US site data for the open model, downloaded for the model's own extent.

* Elevation: USGS 3DEP (best available resolution, lidar-based 1 m where flown)
  from the National Map ImageServer, returned as a GeoTIFF in the model's CRS.
* Impervious cover: NLCD 2021 fractional impervious surface (30 m, lower 48
  states) from the MRLC WCS, summarised per subcatchment.
* Soils: SSURGO map units, hydrologic soil group and surface Ksat from USDA
  NRCS Soil Data Access, turned into infiltration parameters per subcatchment.

Everything is saved in the project folder (``site-data/``), and anything that
changes the model goes through one edit so Ctrl+Z undoes it.
"""

from __future__ import annotations

import json
import math
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

UA = {"User-Agent": "Saturday-SWMM (https://saturday-swmm.com)"}
DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
NLCD_WCS = "https://www.mrlc.gov/geoserver/ows"
NLCD_COVERAGE = "mrlc_download__NLCD_2021_Impervious_L48"
SDA_URL = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest"
MAX_PX = 8000

# Infiltration parameters by hydrologic soil group (US units: in, in/hr).
# Green-Ampt suction and initial deficit after Rawls et al. (1983) for typical
# textures of each group; Horton rates after the SWMM 5 reference manual;
# curve numbers for open space in good condition (TR-55).
HSG_US = {
    "A": {"suction": 1.95, "ksat": 0.45, "imd": 0.40, "max_rate": 5.0, "min_rate": 0.45, "cn": 39},
    "B": {"suction": 3.50, "ksat": 0.25, "imd": 0.33, "max_rate": 4.0, "min_rate": 0.25, "cn": 61},
    "C": {"suction": 6.57, "ksat": 0.10, "imd": 0.30, "max_rate": 3.0, "min_rate": 0.10, "cn": 74},
    "D": {"suction": 8.22, "ksat": 0.03, "imd": 0.25, "max_rate": 2.0, "min_rate": 0.03, "cn": 80},
}
UMS_TO_IN_HR = 0.141732  # µm/s → in/hr


def _fetch(url: str, *, data: Optional[bytes] = None, timeout: int = 120, what: str = "the service") -> bytes:
    req = urllib.request.Request(url, data=data, headers={**UA, **({"Content-Type": "application/json"} if data else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"{what} answered with HTTP {exc.code}. It may be down; try again later.") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=503, detail=f"Could not reach {what}: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=f"{what} did not answer in time. Try a smaller area or coarser resolution.") from exc


def hsg_letter(code: Optional[str]) -> Optional[str]:
    """'A', 'B/D' → the undrained group (D) for dual groups, conservatively."""
    if not code:
        return None
    c = code.strip().upper()
    if "/" in c:
        c = c.split("/")[-1]
    return c[:1] if c[:1] in HSG_US else None


def infiltration_params(hsg: str, ksat_in_hr: Optional[float], method: str, us: bool) -> dict[str, float]:
    """SWMM [INFILTRATION] values for one soil, in the model's units."""
    t = HSG_US[hsg]
    k = ksat_in_hr if ksat_in_hr and ksat_in_hr > 0 else t["ksat"]
    k = min(k, 10.0)  # surface Ksat can be extreme; keep runoff physically plausible
    f = 1.0 if us else 25.4  # in → mm
    m = method.upper()
    if m in ("GREEN_AMPT", "MODIFIED_GREEN_AMPT"):
        return {"suction": t["suction"] * f, "ksat": k * f, "imd": t["imd"]}
    if m == "CURVE_NUMBER":
        return {"cn": float(t["cn"]), "ksat": k * f, "dry_time": 7.0}
    return {"max_rate": t["max_rate"] * f, "min_rate": min(t["min_rate"], k) * f, "decay": 4.0, "dry_time": 7.0, "max_infil": 0.0}


def parse_sda(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """SDA JSON+COLUMNNAME: {"Table": [[names...], [row]...]} → list of dicts."""
    table = payload.get("Table") or []
    if not table:
        return []
    cols = table[0]
    return [dict(zip(cols, row)) for row in table[1:]]


class SiteDataService:
    # ------------------------------------------------------------ helpers
    def _ctx(self) -> dict[str, Any]:
        from app.services.inp_model_service import inp_model_service
        from app.services.project_service import project_service

        root = project_service.require_root()
        inp = project_service.require_inp()
        crs = project_service.get_crs()
        model = inp_model_service.load(inp)
        flow = (inp_model_service.get_flow_units(inp) or "CFS").upper()
        return {"root": root, "inp": inp, "crs": crs, "model": model, "us": flow in ("CFS", "GPM", "MGD")}

    def _dir(self, root: Path) -> Path:
        d = root / "site-data"
        d.mkdir(exist_ok=True)
        return d

    def _extent(self, ctx: dict[str, Any], buffer_frac: float = 0.15) -> tuple[float, float, float, float]:
        m = ctx["model"]
        xs: list[float] = []
        ys: list[float] = []
        for x, y in m.coordinates.values():
            xs.append(x)
            ys.append(y)
        for ring in m.polygons.values():
            for x, y in ring:
                xs.append(x)
                ys.append(y)
        if not xs:
            raise HTTPException(status_code=400, detail="The model has no coordinates to define an area.")
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        pad = max(x1 - x0, y1 - y0) * buffer_frac + 1.0
        return x0 - pad, y0 - pad, x1 + pad, y1 + pad

    def _crs_units_per_m(self, crs: str) -> float:
        from pyproj import CRS

        c = CRS.from_user_input(crs)
        if c.is_geographic:
            raise HTTPException(status_code=400, detail="Set a projected coordinate system for the model first (map → coordinate system).")
        f = c.axis_info[0].unit_conversion_factor or 1.0  # metres per CRS unit
        return 1.0 / f

    def _subcatchments(self, ctx: dict[str, Any]):
        from shapely.geometry import Polygon

        out = {}
        for sid, ring in ctx["model"].polygons.items():
            if sid in ctx["model"].subcatchments and len(ring) >= 3:
                p = Polygon(ring)
                if not p.is_valid:
                    p = p.buffer(0)
                if p.area > 0:
                    out[sid] = p
        return out

    # ---------------------------------------------------------- elevation
    def download_dem(self, resolution_m: float = 3.0) -> dict[str, Any]:
        import numpy as np
        import rasterio

        from app.services.gis_service import gis_service

        ctx = self._ctx()
        crs = ctx["crs"]
        upm = self._crs_units_per_m(crs)
        x0, y0, x1, y1 = self._extent(ctx)
        res = max(0.5, float(resolution_m)) * upm
        w = math.ceil((x1 - x0) / res)
        h = math.ceil((y1 - y0) / res)
        note = None
        if max(w, h) > MAX_PX:
            k = max(w, h) / MAX_PX
            w, h = math.ceil(w / k), math.ceil(h / k)
            note = f"The area is large, so the DEM was fetched at about {resolution_m * k:.1f} m instead of {resolution_m} m."
        epsg = crs.split(":")[-1]
        q = urllib.parse.urlencode(
            {
                "bbox": f"{x0},{y0},{x1},{y1}",
                "bboxSR": epsg,
                "imageSR": epsg,
                "size": f"{w},{h}",
                "format": "tiff",
                "pixelType": "F32",
                "noData": "-9999",
                "interpolation": "RSP_BilinearInterpolation",
                "f": "image",
            }
        )
        raw = _fetch(f"{DEM_URL}?{q}", timeout=300, what="USGS 3DEP")
        if not raw.startswith((b"II*", b"MM\x00*")):
            raise HTTPException(status_code=502, detail=f"USGS 3DEP did not return a GeoTIFF: {raw[:200]!r}")
        d = self._dir(ctx["root"])
        tag = f"{resolution_m:g}m".replace(".", "p")
        path = d / f"usgs_3dep_{tag}.tif"
        path.write_bytes(raw)
        # 3DEP is in metres; convert to the model's length unit so inverts and the DEM agree.
        if ctx["us"]:
            with rasterio.open(path) as src:
                prof = src.profile
                a = src.read(1)
            a = np.where(a <= -9998, -9999, a / 0.3048).astype("float32")
            with rasterio.open(path, "w", **prof) as dst:
                dst.write(a, 1)
        layer = gis_service.ingest_dem(str(path), name=f"USGS 3DEP {resolution_m:g} m", source_crs=crs)
        return {"layer": layer, "file": str(path.relative_to(ctx["root"])), "width": w, "height": h, "vertical_unit": "ft" if ctx["us"] else "m", "note": note}

    # ---------------------------------------------------------- impervious
    def _nlcd_path(self, root: Path) -> Path:
        return self._dir(root) / "nlcd_2021_impervious.tif"

    def download_impervious(self) -> dict[str, Any]:
        from pyproj import Transformer

        ctx = self._ctx()
        x0, y0, x1, y1 = self._extent(ctx)
        t = Transformer.from_crs(ctx["crs"], "EPSG:5070", always_xy=True)
        xs, ys = zip(*[t.transform(x, y) for x, y in ((x0, y0), (x0, y1), (x1, y0), (x1, y1))])
        q = (
            f"service=WCS&version=2.0.1&request=GetCoverage&coverageId={NLCD_COVERAGE}"
            f"&subset=X({min(xs) - 60:.0f},{max(xs) + 60:.0f})&subset=Y({min(ys) - 60:.0f},{max(ys) + 60:.0f})&format=image/geotiff"
        )
        raw = _fetch(f"{NLCD_WCS}?{q}", timeout=300, what="MRLC (NLCD)")
        if not raw.startswith((b"II*", b"MM\x00*")):
            raise HTTPException(status_code=502, detail="MRLC did not return impervious data here. NLCD 2021 covers the lower 48 states only.")
        path = self._nlcd_path(ctx["root"])
        path.write_bytes(raw)
        return {"file": str(path.relative_to(ctx["root"])), **self.impervious_summary()}

    def impervious_summary(self) -> dict[str, Any]:
        import numpy as np
        import rasterio
        from rasterio.mask import mask
        from shapely.geometry import mapping
        from shapely.ops import transform as shp_transform
        from pyproj import Transformer

        ctx = self._ctx()
        path = self._nlcd_path(ctx["root"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Download the NLCD impervious data first.")
        subs = self._subcatchments(ctx)
        rows = []
        with rasterio.open(path) as src:
            t = Transformer.from_crs(ctx["crs"], src.crs.to_string(), always_xy=True)
            for sid, poly in subs.items():
                g = shp_transform(t.transform, poly)
                try:
                    data, _ = mask(src, [mapping(g)], crop=True, filled=False, all_touched=True)
                except ValueError:
                    continue
                a = data[0]
                vals = np.asarray(a[~a.mask] if hasattr(a, "mask") else a).astype(float).ravel()
                vals = vals[(vals >= 0) & (vals <= 100)]
                if vals.size == 0:
                    continue
                cur = ctx["model"].subcatchments[sid].get("pct_imperv")
                rows.append({"id": sid, "current": cur, "nlcd": round(float(vals.mean()), 1), "cells": int(vals.size)})
        return {"source": "NLCD 2021 fractional impervious surface, 30 m (MRLC)", "subcatchments": rows}

    def apply_impervious(self, ids: Optional[list[str]] = None) -> dict[str, Any]:
        s = self.impervious_summary()
        rows = [r for r in s["subcatchments"] if not ids or r["id"] in ids]
        return self._patch_subcatchments({r["id"]: {4: f"{r['nlcd']:g}"} for r in rows}, "SUBCATCHMENTS", f"Set % impervious from NLCD for {len(rows)} subcatchments")

    # --------------------------------------------------------------- soils
    def _soils_path(self, root: Path) -> Path:
        return self._dir(root) / "ssurgo_soils.geojson"

    def download_soils(self) -> dict[str, Any]:
        from pyproj import Transformer
        from shapely import wkt as shp_wkt
        from shapely.geometry import box, mapping
        from shapely.ops import transform as shp_transform

        ctx = self._ctx()
        x0, y0, x1, y1 = self._extent(ctx, 0.05)
        to_wgs = Transformer.from_crs(ctx["crs"], "EPSG:4326", always_xy=True)
        aoi = shp_transform(to_wgs.transform, box(x0, y0, x1, y1).segmentize(max(x1 - x0, y1 - y0) / 8))
        aoi_wkt = aoi.wkt

        def sda(sql: str) -> list[dict[str, Any]]:
            raw = _fetch(SDA_URL, data=json.dumps({"query": sql, "format": "JSON+COLUMNNAME"}).encode(), timeout=180, what="USDA Soil Data Access")
            try:
                return parse_sda(json.loads(raw or b"{}"))
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=502, detail=f"Soil Data Access returned something unexpected: {raw[:200]!r}") from exc

        polys = sda(
            "SELECT P.mukey, P.mupolygongeo.STIntersection(geometry::STGeomFromText('"
            + aoi_wkt
            + "', 4326)).STAsText() AS wkt FROM mupolygon P WHERE P.mupolygongeo.STIntersects(geometry::STGeomFromText('"
            + aoi_wkt
            + "', 4326)) = 1"
        )
        if not polys:
            raise HTTPException(status_code=404, detail="Soil Data Access has no SSURGO map units here (SSURGO covers the US).")
        keys = sorted({str(p["mukey"]) for p in polys})
        attrs = {
            str(r["mukey"]): r
            for r in sda(
                "SELECT m.mukey, m.musym, m.muname, a.hydgrpdcd, a.drclassdcd, "
                "(SELECT SUM(c.comppct_r * h.ksat_r) / NULLIF(SUM(c.comppct_r), 0) FROM component c "
                "INNER JOIN chorizon h ON h.cokey = c.cokey WHERE c.mukey = m.mukey AND h.hzdept_r = 0 AND h.ksat_r IS NOT NULL) AS ksat_surface "
                "FROM mapunit m LEFT JOIN muaggatt a ON a.mukey = m.mukey WHERE m.mukey IN (" + ",".join(keys) + ")"
            )
        }
        feats = []
        for p in polys:
            try:
                g = shp_wkt.loads(p["wkt"])
            except Exception:
                continue
            if g.is_empty:
                continue
            a = attrs.get(str(p["mukey"]), {})
            ks = a.get("ksat_surface")
            feats.append(
                {
                    "type": "Feature",
                    "geometry": mapping(g),
                    "properties": {
                        "mukey": str(p["mukey"]),
                        "musym": a.get("musym"),
                        "muname": a.get("muname"),
                        "hsg": a.get("hydgrpdcd"),
                        "drainage": a.get("drclassdcd"),
                        "ksat_um_s": float(ks) if ks not in (None, "") else None,
                    },
                }
            )
        path = self._soils_path(ctx["root"])
        path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
        layer = self._soils_layer(ctx, feats)
        return {"file": str(path.relative_to(ctx["root"])), "map_units": len(keys), "polygons": len(feats), "layer": layer, **self.soils_summary()}

    def _soils_layer(self, ctx: dict[str, Any], feats: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
        """Show the soils on the map through the normal vector-layer path (a shapefile)."""
        try:
            import geopandas as gpd

            from app.services.gis_service import gis_service

            gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")[["mukey", "musym", "hsg", "geometry"]]
            shp = self._dir(ctx["root"]) / "ssurgo_soils.shp"
            gdf.to_file(shp)
            return gis_service.ingest_vector(str(shp), name="SSURGO soils (hydrologic group)", source_crs="EPSG:4326")
        except Exception:
            return None

    def soils_summary(self) -> dict[str, Any]:
        from pyproj import Transformer
        from shapely.geometry import shape
        from shapely.ops import transform as shp_transform

        ctx = self._ctx()
        path = self._soils_path(ctx["root"])
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Download the SSURGO soils first.")
        method = self._infil_method(ctx)
        to_model = Transformer.from_crs("EPSG:4326", ctx["crs"], always_xy=True)
        soils = []
        for f in json.loads(path.read_text(encoding="utf-8"))["features"]:
            g = shp_transform(to_model.transform, shape(f["geometry"]))
            if not g.is_valid:
                g = g.buffer(0)
            soils.append((g, f["properties"]))
        rows = []
        for sid, poly in self._subcatchments(ctx).items():
            weights: dict[str, float] = {}
            params: dict[str, float] = {}
            tot = 0.0
            for g, p in soils:
                hsg = hsg_letter(p.get("hsg"))
                if not hsg:
                    continue
                a = poly.intersection(g).area
                if a <= 0:
                    continue
                k = p.get("ksat_um_s")
                pr = infiltration_params(hsg, k * UMS_TO_IN_HR if k else None, method, ctx["us"])
                for kk, v in pr.items():
                    params[kk] = params.get(kk, 0.0) + v * a
                weights[hsg] = weights.get(hsg, 0.0) + a
                tot += a
            if tot <= 0:
                continue
            share = {k: round(100 * v / tot, 1) for k, v in sorted(weights.items())}
            rows.append(
                {
                    "id": sid,
                    "hsg": max(weights, key=lambda k: weights[k]),
                    "hsg_share": share,
                    "covered_pct": round(100 * tot / poly.area, 1),
                    "params": {k: round(v / tot, 4) for k, v in params.items()},
                }
            )
        return {"method": method, "units": "in, in/hr" if ctx["us"] else "mm, mm/hr", "subcatchments": rows}

    def _infil_method(self, ctx: dict[str, Any]) -> str:
        text = ctx["inp"].read_text(encoding="utf-8", errors="replace")
        sec = None
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("["):
                sec = s.upper()
            elif sec == "[OPTIONS]" and s and not s.startswith(";"):
                t = s.split()
                if t[0].upper() == "INFILTRATION" and len(t) > 1:
                    return t[1].upper()
        return "HORTON"

    def apply_soils(self, ids: Optional[list[str]] = None) -> dict[str, Any]:
        s = self.soils_summary()
        m = s["method"].upper()
        order = (
            ["suction", "ksat", "imd"]
            if "GREEN" in m
            else ["cn", "ksat", "dry_time"]
            if m == "CURVE_NUMBER"
            else ["max_rate", "min_rate", "decay", "dry_time", "max_infil"]
        )
        rows = [r for r in s["subcatchments"] if not ids or r["id"] in ids]
        values = {r["id"]: {i + 1: f"{r['params'][k]:.4g}" for i, k in enumerate(order)} for r in rows}
        return self._patch_subcatchments(values, "INFILTRATION", f"Set infiltration from SSURGO for {len(rows)} subcatchments", width=len(order) + 1)

    # ------------------------------------------------------------- writing
    def _patch_subcatchments(self, values: dict[str, dict[int, str]], section: str, label: str, width: int = 0) -> dict[str, Any]:
        from app.services.edit_history import edit_history
        from app.services.fs_utils import atomic_write_text
        from app.services.inp_model_service import inp_model_service
        from app.services.network_tools_service import _Model

        ctx = self._ctx()
        m = _Model(ctx["inp"].read_text(encoding="utf-8", errors="replace"))
        rows = m.rows(section)
        changed = []
        for sid, cols in values.items():
            t = m.toks(section, sid)
            if t is None:
                if section != "INFILTRATION":
                    continue
                t = [sid]
            while len(t) < max([*cols.keys(), width - 1]) + 1:
                t.append("0")
            for i, v in cols.items():
                t[i] = v
            if sid in rows:
                m.set_toks(section, sid, t)
            else:
                rows[sid] = ["  ".join(t)]
            changed.append(sid)
        edit_history.set_label(label)
        atomic_write_text(ctx["inp"], m.text())
        inp_model_service.invalidate()
        return {"changed": changed}


site_data_service = SiteDataService()
