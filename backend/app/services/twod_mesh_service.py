"""Parse OpenSWMM [2D_*] INP sections into mesh GeoJSON."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException

from app.services.inp_model_service import ParsedModel, _f, _is_comment, _tokenize, inp_model_service


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

    @property
    def has_mesh(self) -> bool:
        return len(self.vertices) > 0 and len(self.triangles) > 0

    def bounds(self) -> Optional[tuple[float, float, float, float]]:
        if not self.vertices:
            return None
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        return (min(xs), min(ys), max(xs), max(ys))


class TwoDMeshService:
    def __init__(self) -> None:
        self._cache: Optional[TwoDMesh] = None

    def invalidate(self) -> None:
        self._cache = None

    def load(self, inp_path: Path) -> TwoDMesh:
        model = inp_model_service.load(inp_path)
        mtime = model.mtime
        if (
            self._cache is not None
            and self._cache.path == inp_path
            and math.isclose(self._cache.mtime, mtime, abs_tol=1e-9)
        ):
            return self._cache
        mesh = self._build(model)
        self._cache = mesh
        return mesh

    def has_2d_mesh(self, inp_path: Path) -> bool:
        return self.load(inp_path).has_mesh

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

    def _build(self, model: ParsedModel) -> TwoDMesh:
        return TwoDMesh(
            path=model.path,
            mtime=model.mtime,
            options=self.parse_2d_options(model),
            vertices=self.parse_2d_vertices(model),
            triangles=self.parse_2d_triangles(model),
            vertex_node_map=self.parse_2d_vertex_node_map(model),
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
        return {
            "has_mesh": mesh.has_mesh,
            "vertex_count": len(mesh.vertices),
            "triangle_count": len(mesh.triangles),
            "output_file": mesh.options.output_file,
            "report_2d": mesh.options.report_2d,
            "dry_depth": mesh.options.dry_depth,
            "twod_path": str(h5) if h5 else None,
            "has_results": bool(h5 and h5.is_file()),
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
        return {
            "crs": crs,
            "bounds": bounds,
            "geojson": self.to_geojson(inp_path),
            "counts": {
                "vertices": len(mesh.vertices),
                "triangles": len(mesh.triangles),
            },
            "options": {
                "output_file": mesh.options.output_file,
                "report_2d": mesh.options.report_2d,
                "dry_depth": mesh.options.dry_depth,
            },
        }


twod_mesh_service = TwoDMeshService()
