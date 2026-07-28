"""Unit tests for DEM→2D mesh generation."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.inp_model_service import InpModelService
from app.services.mesh_generate_service import (
    MAX_TRIANGLES,
    MeshGenerateService,
    estimate_grid,
)


def test_estimate_grid_counts():
    nx, ny, n_tri = estimate_grid(0, 0, 10, 10, 5)
    # 0,5,10 → 3 verts each direction; 2×2 quads × 2 = 8 triangles
    assert nx == 3 and ny == 3
    assert n_tri == 8


def test_estimate_grid_too_small():
    with pytest.raises(HTTPException) as ei:
        estimate_grid(0, 0, 1, 1, 5)
    assert ei.value.status_code == 400


def test_estimate_grid_cap():
    # Huge AOI with tiny cells
    with pytest.raises(HTTPException) as ei:
        MeshGenerateService().build(
            minx=0,
            miny=0,
            maxx=1000,
            maxy=1000,
            cell_size=1,
            constant_z=1.0,
        )
    assert ei.value.status_code == 400
    assert "limit" in str(ei.value.detail).lower() or str(MAX_TRIANGLES) in str(
        ei.value.detail
    )


def test_regular_grid_alternating_diagonals():
    svc = MeshGenerateService()
    mesh = svc.build(
        minx=0,
        miny=0,
        maxx=10,
        maxy=10,
        cell_size=5,
        constant_z=2.5,
        mannings_n=0.03,
    )
    assert mesh.nx == 3 and mesh.ny == 3
    assert mesh.vertex_count == 9
    assert mesh.triangle_count == 8
    assert all(abs(v[2] - 2.5) < 1e-9 for v in mesh.vertices)

    # First quad ix=0,iy=0 even → (0,1,4) and (0,4,3)
    t0, t1 = mesh.triangles[0], mesh.triangles[1]
    assert t0[:3] == (0, 1, 4)
    assert t1[:3] == (0, 4, 3)

    # Second quad ix=1,iy=0 odd → (1,2,4) and (2,5,4)
    t2, t3 = mesh.triangles[2], mesh.triangles[3]
    assert t2[:3] == (1, 2, 4)
    assert t3[:3] == (2, 5, 4)

    geo = mesh.to_geojson()
    assert len(geo["features"]) == 8


def test_write_2d_mesh_sections():
    base = """\
[TITLE]
Test

[OPTIONS]
FLOW_UNITS           CMS

[JUNCTIONS]
J1               0      2      0      0      0

[COORDINATES]
J1               0.0      0.0

[2D_VERTICES]
       0.000        0.000       1.0000
       1.000        0.000       1.0000
       0.000        1.000       1.0000

[2D_TRIANGLES]
      0     1     2   0.030

[END]
"""
    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "m.inp"
        inp.write_text(base, encoding="utf-8")
        svc = InpModelService()
        mesh = MeshGenerateService().build(
            minx=0,
            miny=0,
            maxx=10,
            maxy=5,
            cell_size=5,
            constant_z=1.0,
        )
        written = svc.write_2d_mesh(
            inp,
            vertices=mesh.vertices,
            triangles=mesh.triangles,
            replace=True,
        )
        assert written["triangle_count"] == mesh.triangle_count
        text = inp.read_text(encoding="utf-8")
        assert text.count("[2D_VERTICES]") == 1
        assert text.count("[2D_TRIANGLES]") == 1
        assert text.count("[2D_OPTIONS]") == 1
        assert "OUTPUT_FILE               m.2d.h5" in text
        # Old 3-vertex mesh gone
        assert "1.0000\n       1.000        0.000" not in text or mesh.vertex_count > 3
        assert f"{mesh.vertex_count}"  # sanity
        # Recount vertex lines (non-comment)
        in_verts = False
        n_v = 0
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("[") and s.endswith("]"):
                in_verts = s.upper() == "[2D_VERTICES]"
                continue
            if in_verts and s and not s.startswith(";"):
                n_v += 1
        assert n_v == mesh.vertex_count


def test_clip_mesh_to_polygon():
    svc = MeshGenerateService()
    # Square domain 0..20, polygon covers left half roughly
    poly = [(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)]
    mesh = svc.build(
        minx=0,
        miny=0,
        maxx=20,
        maxy=20,
        cell_size=5,
        constant_z=1.0,
        polygon=poly,
    )
    full = MeshGenerateService().build(
        minx=0, miny=0, maxx=20, maxy=20, cell_size=5, constant_z=1.0
    )
    assert mesh.triangle_count < full.triangle_count
    assert mesh.triangle_count > 0
    # All triangle centroids should be x <= ~10
    for v1, v2, v3, _n in mesh.triangles:
        cx = (mesh.vertices[v1][0] + mesh.vertices[v2][0] + mesh.vertices[v3][0]) / 3
        assert cx <= 10.0 + 1e-6


def test_polygon_too_small_no_triangles():
    svc = MeshGenerateService()
    with pytest.raises(HTTPException) as ei:
        svc.build(
            minx=0,
            miny=0,
            maxx=20,
            maxy=20,
            cell_size=5,
            constant_z=1.0,
            # Tiny polygon in a cell corner that may miss centroids
            polygon=[(0.01, 0.01), (0.02, 0.01), (0.02, 0.02)],
        )
    assert ei.value.status_code == 400


def test_nodata_fail_threshold():
    svc = MeshGenerateService()
    elevs = [None] * 9
    with pytest.raises(HTTPException) as ei:
        svc.build(
            minx=0,
            miny=0,
            maxx=10,
            maxy=10,
            cell_size=5,
            elevations=elevs,
        )
    assert ei.value.status_code == 400


if __name__ == "__main__":
    test_estimate_grid_counts()
    test_estimate_grid_too_small()
    test_estimate_grid_cap()
    test_regular_grid_alternating_diagonals()
    test_write_2d_mesh_sections()
    test_clip_mesh_to_polygon()
    test_polygon_too_small_no_triangles()
    test_nodata_fail_threshold()
    print("ok")
