"""Generate a regular OpenSWMM 2D triangle mesh from a DEM AOI."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import HTTPException

MAX_TRIANGLES = 100_000
NODATA_FAIL_FRAC = 0.05


@dataclass
class GeneratedMesh:
    nx: int
    ny: int
    cell_size: float
    minx: float
    miny: float
    maxx: float
    maxy: float
    vertices: list[tuple[float, float, float]]  # x, y, z
    triangles: list[tuple[int, int, int, float]]  # v1, v2, v3, mannings_n
    mannings_n: float
    dem_layer_id: Optional[str] = None
    warnings: list[str] = field(default_factory=list)

    @property
    def vertex_count(self) -> int:
        return len(self.vertices)

    @property
    def triangle_count(self) -> int:
        return len(self.triangles)

    def bounds(self) -> dict[str, float]:
        if not self.vertices:
            return {
                "minx": self.minx,
                "miny": self.miny,
                "maxx": self.maxx,
                "maxy": self.maxy,
            }
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        return {
            "minx": min(xs),
            "miny": min(ys),
            "maxx": max(xs),
            "maxy": max(ys),
        }

    def to_geojson(self) -> dict[str, Any]:
        features: list[dict[str, Any]] = []
        for ti, (v1, v2, v3, n) in enumerate(self.triangles):
            p1, p2, p3 = self.vertices[v1], self.vertices[v2], self.vertices[v3]
            ring = [
                [p1[0], p1[1]],
                [p2[0], p2[1]],
                [p3[0], p3[1]],
                [p1[0], p1[1]],
            ]
            zs = [p1[2], p2[2], p3[2]]
            features.append(
                {
                    "type": "Feature",
                    "id": f"triangle:{ti}",
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                    "properties": {
                        "object_type": "triangle",
                        "triangle_index": ti,
                        "id": str(ti),
                        "mannings_n": n,
                        "z_min": min(zs),
                        "z_max": max(zs),
                        "preview": True,
                    },
                }
            )
        return {"type": "FeatureCollection", "features": features}


def estimate_grid(
    minx: float, miny: float, maxx: float, maxy: float, cell_size: float
) -> tuple[int, int, int]:
    """Return (nx, ny, triangle_count)."""
    if cell_size <= 0:
        raise HTTPException(status_code=400, detail="cell_size must be > 0")
    width = maxx - minx
    height = maxy - miny
    if width <= 0 or height <= 0:
        raise HTTPException(
            status_code=400, detail="AOI must have positive width and height"
        )
    nx = int(width / cell_size) + 1
    ny = int(height / cell_size) + 1
    if nx < 2 or ny < 2:
        raise HTTPException(
            status_code=400,
            detail="AOI too small for cell_size — need at least a 2×2 vertex grid",
        )
    n_tri = (nx - 1) * (ny - 1) * 2
    return nx, ny, n_tri


def normalize_polygon(ring: list[list[float]]) -> list[tuple[float, float]]:
    """Validate and return open ring of (x, y)."""
    if not ring or len(ring) < 3:
        raise HTTPException(
            status_code=400, detail="polygon must have at least 3 vertices"
        )
    pts: list[tuple[float, float]] = []
    for i, p in enumerate(ring):
        if len(p) < 2:
            raise HTTPException(status_code=400, detail=f"polygon vertex {i} invalid")
        pts.append((float(p[0]), float(p[1])))
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        raise HTTPException(
            status_code=400, detail="polygon must have at least 3 distinct vertices"
        )
    return pts


def polygon_bbox(pts: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def _fill_nodata_nearest_list(
    xs: list[float],
    ys: list[float],
    zs: list[Optional[float]],
) -> tuple[list[float], list[str]]:
    """Fill None Z from nearest valid sample (euclidean in XY)."""
    n = len(zs)
    missing = [i for i, z in enumerate(zs) if z is None]
    warnings: list[str] = []
    if not missing:
        return [float(z) for z in zs], warnings  # type: ignore[arg-type]

    frac = len(missing) / max(n, 1)
    if frac > NODATA_FAIL_FRAC:
        raise HTTPException(
            status_code=400,
            detail=(
                f"DEM nodata at {len(missing)}/{n} vertices ({frac:.1%}). "
                f"Limit is {NODATA_FAIL_FRAC:.0%}. Adjust AOI or use a DEM that covers the area."
            ),
        )

    valid_idx = [i for i, z in enumerate(zs) if z is not None]
    if not valid_idx:
        raise HTTPException(
            status_code=400, detail="DEM returned no valid elevations in the AOI"
        )

    filled = list(zs)
    for i in missing:
        best_j = valid_idx[0]
        best_d = (xs[i] - xs[best_j]) ** 2 + (ys[i] - ys[best_j]) ** 2
        for j in valid_idx:
            d = (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2
            if d < best_d:
                best_d = d
                best_j = j
        filled[i] = filled[best_j]
    warnings.append(
        f"Filled {len(missing)} nodata vertices from nearest valid DEM samples"
    )
    return [float(z) for z in filled], warnings  # type: ignore[arg-type]


def _fill_nodata_nearest(
    xs: list[float],
    ys: list[float],
    zs: list[Optional[float]],
    nx: int,
    ny: int,
) -> tuple[list[float], list[str]]:
    """Grid-aware Manhattan fill (used for rectangular meshes)."""
    del ny  # unused; kept for call-site compatibility
    n = len(zs)
    missing = [i for i, z in enumerate(zs) if z is None]
    warnings: list[str] = []
    if not missing:
        return [float(z) for z in zs], warnings  # type: ignore[arg-type]

    frac = len(missing) / n
    if frac > NODATA_FAIL_FRAC:
        raise HTTPException(
            status_code=400,
            detail=(
                f"DEM nodata at {len(missing)}/{n} vertices ({frac:.1%}). "
                f"Limit is {NODATA_FAIL_FRAC:.0%}. Adjust AOI or use a DEM that covers the area."
            ),
        )

    valid_idx = [i for i, z in enumerate(zs) if z is not None]
    if not valid_idx:
        raise HTTPException(
            status_code=400, detail="DEM returned no valid elevations in the AOI"
        )

    filled = list(zs)
    for i in missing:
        ix, iy = i % nx, i // nx
        best_j = valid_idx[0]
        best_d = abs(best_j % nx - ix) + abs(best_j // nx - iy)
        for j in valid_idx:
            d = abs(j % nx - ix) + abs(j // nx - iy)
            if d < best_d:
                best_d = d
                best_j = j
                if d == 0:
                    break
        filled[i] = filled[best_j]
    warnings.append(
        f"Filled {len(missing)} nodata vertices from nearest valid DEM samples"
    )
    return [float(z) for z in filled], warnings  # type: ignore[arg-type]


def clip_mesh_to_polygon(
    vertices: list[tuple[float, float, float]],
    triangles: list[tuple[int, int, int, float]],
    polygon: list[tuple[float, float]],
) -> tuple[
    list[tuple[float, float, float]], list[tuple[int, int, int, float]], list[str]
]:
    """Keep triangles whose centroid lies inside polygon; compact vertex indices."""
    from shapely.geometry import Point, Polygon

    poly = Polygon(polygon)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.area <= 0:
        raise HTTPException(status_code=400, detail="polygon has no area")

    kept: list[tuple[int, int, int, float]] = []
    for v1, v2, v3, n in triangles:
        p1, p2, p3 = vertices[v1], vertices[v2], vertices[v3]
        cx = (p1[0] + p2[0] + p3[0]) / 3.0
        cy = (p1[1] + p2[1] + p3[1]) / 3.0
        if poly.covers(Point(cx, cy)):
            kept.append((v1, v2, v3, n))

    if not kept:
        raise HTTPException(
            status_code=400,
            detail="No triangles fall inside the polygon — enlarge AOI or reduce cell_size",
        )

    used: set[int] = set()
    for v1, v2, v3, _n in kept:
        used.add(v1)
        used.add(v2)
        used.add(v3)
    old_to_new = {old: new for new, old in enumerate(sorted(used))}
    new_verts = [vertices[i] for i in sorted(used)]
    new_tris = [
        (old_to_new[v1], old_to_new[v2], old_to_new[v3], n) for v1, v2, v3, n in kept
    ]
    warnings = [
        f"Clipped mesh to polygon: kept {len(new_tris)} / {len(triangles)} triangles"
    ]
    return new_verts, new_tris, warnings


class MeshGenerateService:
    def build(
        self,
        *,
        minx: float,
        miny: float,
        maxx: float,
        maxy: float,
        cell_size: float,
        mannings_n: float = 0.03,
        dem_layer_id: Optional[str] = None,
        constant_z: Optional[float] = None,
        elevations: Optional[list[Optional[float]]] = None,
        polygon: Optional[list[tuple[float, float]]] = None,
    ) -> GeneratedMesh:
        """
        Build a row-major regular grid with alternating diagonals.

        If `polygon` is set, keep only triangles whose centroid is inside it.
        """
        nx, ny, n_tri = estimate_grid(minx, miny, maxx, maxy, cell_size)
        if n_tri > MAX_TRIANGLES:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Mesh would have {n_tri:,} triangles (limit {MAX_TRIANGLES:,}). "
                    "Increase cell_size or shrink the AOI."
                ),
            )

        maxx_s = minx + (nx - 1) * cell_size
        maxy_s = miny + (ny - 1) * cell_size

        xs: list[float] = []
        ys: list[float] = []
        for iy in range(ny):
            y = miny + iy * cell_size
            for ix in range(nx):
                x = minx + ix * cell_size
                xs.append(x)
                ys.append(y)

        warnings: list[str] = []
        if elevations is not None:
            if len(elevations) != len(xs):
                raise HTTPException(
                    status_code=400, detail="elevations length must match vertex count"
                )
            raw_z = list(elevations)
        elif constant_z is not None:
            raw_z = [constant_z] * len(xs)
            warnings.append(f"Used constant Z={constant_z}")
            dem_layer_id = None
        else:
            from app.services.gis_service import gis_service

            raw_z = gis_service.sample_dem_grid(xs, ys, layer_id=dem_layer_id)

        n = mannings_n if mannings_n > 0 else 0.03
        triangles: list[tuple[int, int, int, float]] = []
        for iy in range(ny - 1):
            for ix in range(nx - 1):
                v00 = iy * nx + ix
                v10 = iy * nx + (ix + 1)
                v01 = (iy + 1) * nx + ix
                v11 = (iy + 1) * nx + (ix + 1)
                if (ix + iy) % 2 == 0:
                    triangles.append((v00, v10, v11, n))
                    triangles.append((v00, v11, v01, n))
                else:
                    triangles.append((v00, v10, v01, n))
                    triangles.append((v10, v11, v01, n))

        opt_z: list[Optional[float]] = list(raw_z)

        if polygon is not None:
            temp_verts = [(xs[i], ys[i], 0.0) for i in range(len(xs))]
            temp_verts, triangles, clip_warnings = clip_mesh_to_polygon(
                temp_verts, triangles, polygon
            )
            warnings.extend(clip_warnings)
            xy_to_z: dict[tuple[float, float], Optional[float]] = {
                (xs[i], ys[i]): opt_z[i] for i in range(len(xs))
            }
            new_xs = [v[0] for v in temp_verts]
            new_ys = [v[1] for v in temp_verts]
            new_opt = [xy_to_z.get((x, y)) for x, y in zip(new_xs, new_ys)]
            zs, fill_warnings = _fill_nodata_nearest_list(new_xs, new_ys, new_opt)
            warnings.extend(fill_warnings)
            vertices = [(new_xs[i], new_ys[i], zs[i]) for i in range(len(new_xs))]
        else:
            zs, fill_warnings = _fill_nodata_nearest(xs, ys, opt_z, nx, ny)
            warnings.extend(fill_warnings)
            vertices = [(xs[i], ys[i], zs[i]) for i in range(len(xs))]

        return GeneratedMesh(
            nx=nx,
            ny=ny,
            cell_size=cell_size,
            minx=minx,
            miny=miny,
            maxx=maxx_s,
            maxy=maxy_s,
            vertices=vertices,
            triangles=triangles,
            mannings_n=n,
            dem_layer_id=dem_layer_id,
            warnings=warnings,
        )

    def preview_payload(
        self,
        mesh: GeneratedMesh,
        *,
        crs: str = "EPSG:25832",
    ) -> dict[str, Any]:
        return {
            "crs": crs,
            "bounds": mesh.bounds(),
            "geojson": mesh.to_geojson(),
            "counts": {
                "vertices": mesh.vertex_count,
                "triangles": mesh.triangle_count,
                "nx": mesh.nx,
                "ny": mesh.ny,
            },
            "warnings": mesh.warnings,
            "cell_size": mesh.cell_size,
            "mannings_n": mesh.mannings_n,
            "dem_layer_id": mesh.dem_layer_id,
        }


mesh_generate_service = MeshGenerateService()
