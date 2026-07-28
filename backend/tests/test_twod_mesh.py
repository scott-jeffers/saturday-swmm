"""Unit tests for OpenSWMM 2D INP mesh parsing."""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.services.inp_model_service import InpModelService
from app.services.twod_mesh_service import TwoDMeshService

MINI_INP = """\
[TITLE]
;; Mini 2D test

[OPTIONS]
FLOW_UNITS           CMS

[JUNCTIONS]
J1               0      2      0      0      0

[COORDINATES]
J1               0.0      0.0

[2D_OPTIONS]
REPORT_2D                 YES
OUTPUT_FILE               mini.2d.h5
DRY_DEPTH                 0.001

[2D_VERTICES]
;;  X            Y            Z
       0.000        0.000       1.0000
       1.000        0.000       1.0000
       0.000        1.000       1.2000
       1.000        1.000       1.0000

[2D_TRIANGLES]
;;  V1   V2   V3   MANNINGS_N
      0     1     2   0.030
      1     3     2   0.035

[2D_VERTEX_NODE_MAP]
      0   J1      0.650  0.400
"""


def test_parse_2d_mesh_geojson():
    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "mini.inp"
        inp.write_text(MINI_INP, encoding="utf-8")

        mesh_svc = TwoDMeshService()
        info = mesh_svc.info(inp)
        assert info["has_mesh"] is True
        assert info["vertex_count"] == 4
        assert info["triangle_count"] == 2
        assert info["output_file"] == "mini.2d.h5"
        assert info["report_2d"] is True
        assert info["has_results"] is False
        assert info["twod_path"] == str(inp.parent / "mini.2d.h5")

        geo = mesh_svc.to_geojson(inp)
        assert geo["type"] == "FeatureCollection"
        assert len(geo["features"]) == 2

        f0 = geo["features"][0]
        assert f0["properties"]["triangle_index"] == 0
        assert f0["properties"]["mannings_n"] == 0.03
        assert f0["properties"]["coupled_node"] == "J1"
        assert f0["geometry"]["type"] == "Polygon"
        ring = f0["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1]
        assert len(ring) == 4

        f1 = geo["features"][1]
        assert f1["properties"]["mannings_n"] == 0.035
        assert abs(f1["properties"]["z_max"] - 1.2) < 1e-9

        bounds = mesh_svc.load(inp).bounds()
        assert bounds == (0.0, 0.0, 1.0, 1.0)


def test_network_bounds_union_2d():
    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "mini.inp"
        inp.write_text(MINI_INP, encoding="utf-8")
        svc = InpModelService()
        payload = svc.network_payload(inp, crs="EPSG:25832")
        b = payload["bounds"]
        assert b is not None
        # 1D node at (0,0) plus mesh to (1,1)
        assert b["minx"] <= 0.0
        assert b["maxx"] >= 1.0
        assert b["maxy"] >= 1.0


def test_no_2d_mesh_classic_inp():
    classic = """\
[TITLE]
Classic

[JUNCTIONS]
J1               0      2      0      0      0

[COORDINATES]
J1               10.0      20.0
"""
    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "classic.inp"
        inp.write_text(classic, encoding="utf-8")
        mesh_svc = TwoDMeshService()
        info = mesh_svc.info(inp)
        assert info["has_mesh"] is False
        assert info["triangle_count"] == 0
        assert info["has_results"] is False


if __name__ == "__main__":
    test_parse_2d_mesh_geojson()
    test_network_bounds_union_2d()
    test_no_2d_mesh_classic_inp()
    print("ok")
