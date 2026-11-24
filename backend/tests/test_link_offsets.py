"""LINK_OFFSETS ELEVATION: offsets are elevations, and everything that draws or
checks pipes needs them as heights above the node inverts."""

from pathlib import Path

from app.services.inp_model_service import inp_model_service

INP = """[OPTIONS]
FLOW_UNITS CFS
LINK_OFFSETS {mode}

[JUNCTIONS]
J1  100  10  0 0 0
J2  95   10  0 0 0

[OUTFALLS]
O1  90  FREE  NO

[CONDUITS]
C1  J1  J2  100  0.013  {in1}  {out1}  0  0
C2  J2  O1  100  0.013  *  90  0  0

[XSECTIONS]
C1  CIRCULAR  1  0 0 0 1
C2  CIRCULAR  1  0 0 0 1

[COORDINATES]
J1  0  0
J2  100  0
O1  200  0
"""


def _load(tmp_path: Path, mode: str, in1: str, out1: str):
    p = tmp_path / f"m_{mode}.inp"
    p.write_text(INP.format(mode=mode, in1=in1, out1=out1))
    return inp_model_service.load(p)


def test_elevation_offsets_become_heights(tmp_path: Path) -> None:
    m = _load(tmp_path, "ELEVATION", "102", "96")
    assert m.offsets_are_elevations()
    c1 = m.all_links()["C1"]
    assert m.offset_depths(c1) == {"in_offset_depth": 2.0, "out_offset_depth": 1.0}
    # "*" and elevations below the invert mean at the invert.
    c2 = m.all_links()["C2"]
    assert m.offset_depths(c2)["in_offset_depth"] == 0.0
    feats = {f["properties"]["id"]: f["properties"] for f in inp_model_service.to_geojson(m)["features"] if f["properties"]["object_type"] == "link"}
    assert feats["C1"]["in_offset_depth"] == 2.0


def test_depth_offsets_unchanged(tmp_path: Path) -> None:
    m = _load(tmp_path, "DEPTH", "2", "1")
    assert not m.offsets_are_elevations()
    assert m.offset_depths(m.all_links()["C1"]) == {"in_offset_depth": 2.0, "out_offset_depth": 1.0}
