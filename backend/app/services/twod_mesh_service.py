"""Parse OpenSWMM [2D_*] INP / .2dm sections into mesh GeoJSON."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.inp_model_service import ParsedModel, _f, _is_comment, _tokenize, inp_model_service

# Above this triangle count, skip per-feature GeoJSON and ship indexed arrays.
# Keep in sync with frontend MESH_LARGE_THRESHOLD / docs/ARCHITECTURE.md.
MESH_GEOJSON_TRIANGLE_LIMIT = 20_000
_GEOJSON_TRIANGLE_LIMIT = MESH_GEOJSON_TRIANGLE_LIMIT  # alias for callers


@dataclass
class TwoDOptions:
    output_file: Optional[str] = None
    report_2d: bool = True
    dry_depth: Optional[float] = None
    raw: dict[str, str] = field(default_factory=dict)


@dataclass
class TwoDMesh:
    path: Path
    mtime: float
    options: TwoDOptions
    vertices: list[tuple[float, float, float]]  # (x, y, z)
    triangles: list[tuple[int, int, int, float]]  # (v1, v2, v3, mannings_n)
    vertex_node_map: dict[int, dict[str, Any]] = field(default_factory=dict)
    # (triangle_index, edge 0..2) -> {bc_type, param1, param2, group}
    boundary_conditions: dict[tuple[int, int], dict[str, Any]] = field(default_factory=dict)
    mesh_file: Optional[str] = None

    @property
    def has_mesh(self) -> bool:
        return len(self.vertices) > 0 and len(self.triangles) > 0

    def bounds(self) -> Optional[tuple[float, float, float, float]]:
        if not self.vertices:
            return None
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        return (min(xs), min(ys), max(xs), max(ys))


# OpenSWMM / SWMM6 2D edge BC types (INP strings).
BC_TYPES = (
    "WALL",
    "NORMAL_FLOW",
    "SPECIFIED_STAGE",
    "SPECIFIED_FLOW",
    "RATING_CURVE",
    "TS_STAGE",
    "TS_FLOW",
)
DEFAULT_BC_TYPE = "WALL"


class TwoDMeshService:
    def __init__(self) -> None:
        self._cache: Optional[TwoDMesh] = None

    def invalidate(self) -> None:
        self._cache = None

    def load(self, inp_path: Path) -> TwoDMesh:
        model = inp_model_service.load(inp_path)
        mesh_ref = self.resolve_mesh_file(model)
        mtime = model.mtime
        if mesh_ref is not None and mesh_ref.is_file():
            mtime = max(mtime, mesh_ref.stat().st_mtime)
        if (
            self._cache is not None
            and self._cache.path == inp_path
            and math.isclose(self._cache.mtime, mtime, abs_tol=1e-9)
        ):
            return self._cache
        mesh = self._build(model, cache_mtime=mtime)
        self._cache = mesh
        return mesh

    def has_2d_mesh(self, inp_path: Path) -> bool:
        return self.load(inp_path).has_mesh

    def parse_2d_mesh_file_ref(self, model: ParsedModel) -> Optional[str]:
        """Return the FILE= path from [2D_MESH_FILE], if present."""
        for _, raw in model.sections.get("2D_MESH_FILE", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) >= 2 and toks[0].upper() == "FILE":
                return toks[1]
            if len(toks) == 1 and not toks[0].startswith("["):
                return toks[0]
        return None

    def resolve_mesh_file(self, model: ParsedModel) -> Optional[Path]:
        ref = self.parse_2d_mesh_file_ref(model)
        if not ref:
            return None
        candidate = Path(ref)
        if not candidate.is_absolute():
            candidate = model.path.parent / candidate
        return candidate

    def parse_2d_options(self, model: ParsedModel) -> TwoDOptions:
        opts = TwoDOptions()
        for _, raw in model.sections.get("2D_OPTIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 2:
                continue
            key = toks[0].upper()
            value = toks[1]
            opts.raw[key] = value
            if key == "OUTPUT_FILE":
                opts.output_file = value
            elif key == "REPORT_2D":
                opts.report_2d = value.upper() in {"YES", "Y", "TRUE", "1"}
            elif key == "DRY_DEPTH":
                opts.dry_depth = _f(value)
        return opts

    def parse_2d_vertices(self, model: ParsedModel) -> list[tuple[float, float, float]]:
        verts: list[tuple[float, float, float]] = []
        for _, raw in model.sections.get("2D_VERTICES", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 2:
                continue
            x, y = _f(toks[0]), _f(toks[1])
            if x is None or y is None:
                continue
            z = _f(toks[2], 0.0) if len(toks) >= 3 else 0.0
            verts.append((x, y, z if z is not None else 0.0))
        return verts

    def parse_2d_triangles(
        self, model: ParsedModel
    ) -> list[tuple[int, int, int, float]]:
        tris: list[tuple[int, int, int, float]] = []
        for _, raw in model.sections.get("2D_TRIANGLES", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            try:
                v1, v2, v3 = int(toks[0]), int(toks[1]), int(toks[2])
            except ValueError:
                continue
            n = _f(toks[3], 0.0) if len(toks) >= 4 else 0.0
            tris.append((v1, v2, v3, n if n is not None else 0.0))
        return tris

    def parse_2d_vertex_node_map(
        self, model: ParsedModel
    ) -> dict[int, dict[str, Any]]:
        mapping: dict[int, dict[str, Any]] = {}
        for _, raw in model.sections.get("2D_VERTEX_NODE_MAP", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 2:
                continue
            try:
                vid = int(toks[0])
            except ValueError:
                continue
            entry: dict[str, Any] = {"coupled_node": toks[1]}
            if len(toks) >= 3:
                cd = _f(toks[2])
                if cd is not None:
                    entry["cd"] = cd
            if len(toks) >= 4:
                area = _f(toks[3])
                if area is not None:
                    entry["area"] = area
            mapping[vid] = entry
        return mapping

    def parse_2d_boundary_conditions(
        self, model: ParsedModel
    ) -> dict[tuple[int, int], dict[str, Any]]:
        """Parse [2D_BOUNDARY_CONDITIONS]: TRI EDGE TYPE [PARAM1 [PARAM2 [GROUP]]]."""
        out: dict[tuple[int, int], dict[str, Any]] = {}
        for _, raw in model.sections.get("2D_BOUNDARY_CONDITIONS", []):
            if _is_comment(raw):
                continue
            toks = _tokenize(raw)
            if len(toks) < 3:
                continue
            try:
                tri = int(toks[0])
                edge = int(toks[1])
            except ValueError:
                continue
            if edge < 0 or edge > 2:
                continue
            bc_type = toks[2].upper()
            entry: dict[str, Any] = {"bc_type": bc_type}
            if len(toks) >= 4:
                p1 = _f(toks[3])
                if p1 is not None:
                    entry["param1"] = p1
                elif toks[3] != "*":
                    entry["param2"] = toks[3]
            if len(toks) >= 5:
                if toks[4] != "*":
                    entry["param2"] = toks[4]
            if len(toks) >= 6:
                entry["group"] = toks[5]
            out[(tri, edge)] = entry
        return out

    def open_boundary_edges(
        self, mesh: TwoDMesh
    ) -> list[tuple[int, int, int, int]]:
        """Return exterior edges as (triangle_index, edge, va, vb).

        Edge 0 = v1-v2, 1 = v2-v3, 2 = v3-v1 (matches OpenSWMM local edge order).
        """
        n_verts = len(mesh.vertices)
        # undirected key -> list of (tri, edge, va, vb)
        occ: dict[tuple[int, int], list[tuple[int, int, int, int]]] = {}
        for ti, (v1, v2, v3, _) in enumerate(mesh.triangles):
            if min(v1, v2, v3) < 0 or max(v1, v2, v3) >= n_verts:
                continue
            for edge, (a, b) in enumerate(((v1, v2), (v2, v3), (v3, v1))):
                key = (a, b) if a < b else (b, a)
                occ.setdefault(key, []).append((ti, edge, a, b))
        open_edges: list[tuple[int, int, int, int]] = []
        for entries in occ.values():
            if len(entries) == 1:
                open_edges.append(entries[0])
        return open_edges

    def _build(self, model: ParsedModel, *, cache_mtime: float) -> TwoDMesh:
        options = self.parse_2d_options(model)
        vertices = self.parse_2d_vertices(model)
        triangles = self.parse_2d_triangles(model)
        vertex_node_map = self.parse_2d_vertex_node_map(model)
        boundary_conditions = self.parse_2d_boundary_conditions(model)
        mesh_file: Optional[str] = None

        mesh_path = self.resolve_mesh_file(model)
        if (not vertices or not triangles) and mesh_path is not None:
            if mesh_path.is_file():
                side = inp_model_service.parse_file_uncached(
                    mesh_path, sections_only=True
                )
                if not vertices:
                    vertices = self.parse_2d_vertices(side)
                if not triangles:
                    triangles = self.parse_2d_triangles(side)
                if not vertex_node_map:
                    vertex_node_map = self.parse_2d_vertex_node_map(side)
                if not boundary_conditions:
                    boundary_conditions = self.parse_2d_boundary_conditions(side)
                mesh_file = str(mesh_path)
            else:
                # Keep reference visible in info even when the sidecar is missing.
                mesh_file = str(mesh_path)

        return TwoDMesh(
            path=model.path,
            mtime=cache_mtime,
            options=options,
            vertices=vertices,
            triangles=triangles,
            vertex_node_map=vertex_node_map,
            boundary_conditions=boundary_conditions,
            mesh_file=mesh_file,
        )

    def resolve_h5_path(self, inp_path: Path) -> Optional[Path]:
        """Resolve OUTPUT_FILE relative to the INP directory, if configured."""
        mesh = self.load(inp_path)
        if not mesh.has_mesh:
            return None
        name = mesh.options.output_file
        if not name:
            return None
        candidate = Path(name)
        if not candidate.is_absolute():
            candidate = inp_path.parent / candidate
        return candidate

    def info(self, inp_path: Path) -> dict[str, Any]:
        mesh = self.load(inp_path)
        h5 = self.resolve_h5_path(inp_path) if mesh.has_mesh else None
        boundary_edge_count = 0
        if mesh.has_mesh:
            boundary_edge_count = len(self.open_boundary_edges(mesh))
        return {
            "has_mesh": mesh.has_mesh,
            "vertex_count": len(mesh.vertices),
            "triangle_count": len(mesh.triangles),
            "output_file": mesh.options.output_file,
            "report_2d": mesh.options.report_2d,
            "dry_depth": mesh.options.dry_depth,
            "twod_path": str(h5) if h5 else None,
            "has_results": bool(h5 and h5.is_file()),
            "mesh_file": mesh.mesh_file,
            "boundary_edge_count": boundary_edge_count,
        }

    def face_info(self, inp_path: Path, face_index: int) -> dict[str, Any]:
        """Return static mesh properties for one triangle."""
        mesh = self.load(inp_path)
        if not mesh.has_mesh:
            raise HTTPException(status_code=404, detail="Project has no 2D mesh")
        n = len(mesh.triangles)
        if face_index < 0 or face_index >= n:
            raise HTTPException(
                status_code=404,
                detail=f"Face index {face_index} out of range (0..{n - 1})",
            )
        v1, v2, v3, mannings_n = mesh.triangles[face_index]
        p1, p2, p3 = mesh.vertices[v1], mesh.vertices[v2], mesh.vertices[v3]
        zs = [p1[2], p2[2], p3[2]]
        # Shoelace area in projected CRS units²
        area = abs(
            (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]))
            / 2.0
        )
        out: dict[str, Any] = {
            "triangle_index": face_index,
            "mannings_n": float(mannings_n),
            "z_min": float(min(zs)),
            "z_max": float(max(zs)),
            "z_mean": float(sum(zs) / 3.0),
            "area": float(area),
            "vertices": [
                [float(p1[0]), float(p1[1]), float(p1[2])],
                [float(p2[0]), float(p2[1]), float(p2[2])],
                [float(p3[0]), float(p3[1]), float(p3[2])],
            ],
        }
        for vid in (v1, v2, v3):
            if vid in mesh.vertex_node_map:
                entry = mesh.vertex_node_map[vid]
                out["coupled_node"] = entry.get("coupled_node")
                if "cd" in entry:
                    out["cd"] = entry["cd"]
                if "area" in entry:
                    out["coupling_area"] = entry["area"]
                break
        return out

    def boundaries_payload(self, inp_path: Path, crs: str = "EPSG:25832") -> dict[str, Any]:
        mesh = self.load(inp_path)
        if not mesh.has_mesh:
            raise HTTPException(status_code=404, detail="Project has no 2D mesh")

        features: list[dict[str, Any]] = []
        for ti, edge, va, vb in self.open_boundary_edges(mesh):
            p0 = mesh.vertices[va]
            p1 = mesh.vertices[vb]
            explicit = mesh.boundary_conditions.get((ti, edge))
            if explicit:
                bc_type = str(explicit.get("bc_type") or DEFAULT_BC_TYPE).upper()
                param1 = explicit.get("param1")
                param2 = explicit.get("param2")
                group = explicit.get("group")
                is_default = False
            else:
                bc_type = DEFAULT_BC_TYPE
                param1 = None
                param2 = None
                group = None
                is_default = True
            fid = f"{ti}:{edge}"
            features.append(
                {
                    "type": "Feature",
                    "id": f"2d_boundary:{fid}",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[p0[0], p0[1]], [p1[0], p1[1]]],
                    },
                    "properties": {
                        "object_type": "2d_boundary",
                        "id": fid,
                        "triangle_index": ti,
                        "edge": edge,
                        "bc_type": bc_type,
                        "param1": param1,
                        "param2": param2,
                        "group": group,
                        "is_default": is_default,
                    },
                }
            )

        return {
            "crs": crs,
            "geojson": {"type": "FeatureCollection", "features": features},
            "count": len(features),
            "bc_types": list(BC_TYPES),
        }

    def to_geojson(self, inp_path: Path) -> dict[str, Any]:
        mesh = self.load(inp_path)
        if not mesh.has_mesh:
            raise HTTPException(status_code=404, detail="Project has no 2D mesh")

        # Map vertex index -> coupled node (if any vertex of a triangle is coupled)
        vert_coupled = mesh.vertex_node_map
        features: list[dict[str, Any]] = []
        n_verts = len(mesh.vertices)

        for ti, (v1, v2, v3, mannings_n) in enumerate(mesh.triangles):
            if v1 < 0 or v2 < 0 or v3 < 0 or v1 >= n_verts or v2 >= n_verts or v3 >= n_verts:
                continue
            p1, p2, p3 = mesh.vertices[v1], mesh.vertices[v2], mesh.vertices[v3]
            ring = [
                [p1[0], p1[1]],
                [p2[0], p2[1]],
                [p3[0], p3[1]],
                [p1[0], p1[1]],
            ]
            zs = [p1[2], p2[2], p3[2]]
            props: dict[str, Any] = {
                "object_type": "triangle",
                "triangle_index": ti,
                "id": str(ti),
                "mannings_n": mannings_n,
                "z_min": min(zs),
                "z_max": max(zs),
            }
            for vid in (v1, v2, v3):
                if vid in vert_coupled:
                    props["coupled_node"] = vert_coupled[vid]["coupled_node"]
                    if "cd" in vert_coupled[vid]:
                        props["cd"] = vert_coupled[vid]["cd"]
                    if "area" in vert_coupled[vid]:
                        props["coupling_area"] = vert_coupled[vid]["area"]
                    break
            features.append(
                {
                    "type": "Feature",
                    "id": f"triangle:{ti}",
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                    "properties": props,
                }
            )

        return {"type": "FeatureCollection", "features": features}

    def mesh_payload(self, inp_path: Path, crs: str = "EPSG:25832") -> dict[str, Any]:
        mesh = self.load(inp_path)
        if not mesh.has_mesh:
            raise HTTPException(status_code=404, detail="Project has no 2D mesh")
        b = mesh.bounds()
        bounds = None
        if b:
            bounds = {"minx": b[0], "miny": b[1], "maxx": b[2], "maxy": b[3]}

        n_tris = len(mesh.triangles)
        # Compact XY verts + triangle indices for large meshes (client builds GeoJSON).
        vertices_xy = [[v[0], v[1]] for v in mesh.vertices]
        triangles_idx = [[t[0], t[1], t[2]] for t in mesh.triangles]

        if n_tris > _GEOJSON_TRIANGLE_LIMIT:
            geojson: dict[str, Any] = {"type": "FeatureCollection", "features": []}
        else:
            geojson = self.to_geojson(inp_path)

        return {
            "crs": crs,
            "bounds": bounds,
            "geojson": geojson,
            "vertices": vertices_xy,
            "triangles": triangles_idx,
            "counts": {
                "vertices": len(mesh.vertices),
                "triangles": n_tris,
            },
            "options": {
                "output_file": mesh.options.output_file,
                "report_2d": mesh.options.report_2d,
                "dry_depth": mesh.options.dry_depth,
            },
            "mesh_file": mesh.mesh_file,
        }


twod_mesh_service = TwoDMeshService()
