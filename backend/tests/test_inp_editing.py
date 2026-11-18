"""Round-trip tests for INP editing: patch, delete cascade, tokenizer."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.inp_model_service import (
    InpModelService,
    _tokenize,
)

MODEL = """\
[TITLE]
Editing test

[OPTIONS]
FLOW_UNITS           CMS

[RAINGAGES]
;;Name  Format    Interval SCF  Source
RG1     VOLUME    0:05     1.0  FILE   "C:\\My Data\\rain fall.dat" ST1 MM

[SUBCATCHMENTS]
;;Name  Raingage  Outlet  Area  %Imperv  Width  Slope  CurbLen
S1      RG1       J1      1.0   50       100    0.5    0
S2      RG1       S1      2.0   30       100    0.5    0

[SUBAREAS]
S1      0.01  0.1  1  5  25  OUTLET
S2      0.01  0.1  1  5  25  OUTLET

[INFILTRATION]
S1      3.0  0.5  4
S2      3.0  0.5  4

[COVERAGES]
S2      Residential  100

[JUNCTIONS]
;;Name  Elev   MaxDepth  InitDepth  SurDepth  Aponded
J1      10.0   3.0       0          0         0       ; upstream manhole
J2      9.0    3.0       0          0         0
J3      8.5    3.0       0          0         0

[OUTFALLS]
O1      8.0    FREE

[CONDUITS]
C1      J1  J2  100  0.013  0  0
C2      J2  O1  100  0.013  0  0
C3      J3  O1  50   0.013  0  0

[XSECTIONS]
C1      CIRCULAR  1  0  0  0  1
C2      CIRCULAR  1  0  0  0  1
C3      CIRCULAR  1  0  0  0  1

[LOSSES]
C1      0.5  0.5  0  NO

[INFLOWS]
J2      FLOW  ""  FLOW  1.0  1.0  0.2

[DWF]
J2      FLOW  0.01

[CONTROLS]
RULE R1
IF NODE J2 DEPTH > 1
THEN CONDUIT C2 STATUS = CLOSED

[TAGS]
Node    J2   Manhole
Link    C2   Trunk
Subcatch S2  Residential

[COORDINATES]
J1  0    0
J2  100  0
J3  100  50
O1  200  0

[VERTICES]
C2  150  10

[Polygons]
S1  0 0
S1  10 0
S1  10 10
S2  20 0
S2  30 0
S2  30 10
"""


@pytest.fixture()
def inp(tmp_path: Path) -> Path:
    p = tmp_path / "model.inp"
    p.write_text(MODEL, encoding="utf-8")
    return p


def rows(text: str, section: str) -> list[str]:
    out: list[str] = []
    cur = None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            cur = s[1:-1]
            continue
        if cur == section and s and not s.startswith(";"):
            out.append(s)
    return out


def test_tokenize_quotes_and_inline_comments():
    assert _tokenize('RG1 VOLUME 0:05 1.0 FILE "C:\\a b\\r.dat" ST1 MM') == [
        "RG1", "VOLUME", "0:05", "1.0", "FILE", "C:\\a b\\r.dat", "ST1", "MM",
    ]
    assert _tokenize("J1  10.0  3.0 ; note with ; more") == ["J1", "10.0", "3.0"]
    assert _tokenize('X "has ; semicolon" 1') == ["X", "has ; semicolon", "1"]


def test_patch_preserves_inline_comment_and_spacing(inp: Path):
    svc = InpModelService()
    svc.apply_patch(inp, "node", "J1", {"init_depth": 0.5})
    text = inp.read_text(encoding="utf-8")
    j1 = next(r for r in rows(text, "JUNCTIONS") if r.startswith("J1"))
    assert "; upstream manhole" in j1
    assert _tokenize(j1)[3] == "0.5"
    # untouched rows are byte-identical
    assert "J2      9.0    3.0       0          0         0\n" in text


def test_raingage_file_with_spaces_is_parsed(inp: Path):
    svc = InpModelService()
    rg = svc.list_raingages(inp)[0]
    assert rg["filename"] == "C:\\My Data\\rain fall.dat"
    assert rg["station"] == "ST1"
    assert rg["units"] == "MM"


def test_delete_node_removes_all_references(inp: Path):
    svc = InpModelService()
    res = svc.delete_object(inp, "node", "J2", cascade=True)
    assert sorted(res["cascaded_link_ids"]) == ["C1", "C2"]
    assert any("R1" in w for w in res["warnings"])
    text = inp.read_text(encoding="utf-8")
    for sec in ("JUNCTIONS", "INFLOWS", "DWF", "COORDINATES"):
        assert not any(r.split()[0] == "J2" for r in rows(text, sec)), sec
    for sec in ("CONDUITS", "XSECTIONS", "LOSSES", "VERTICES"):
        assert not any(r.split()[0] in ("C1", "C2") for r in rows(text, sec)), sec
    tags = rows(text, "TAGS")
    assert not any(t.split()[1] in ("J2", "C2") for t in tags)
    assert any(t.split()[1] == "S2" for t in tags)
    # unrelated objects are untouched
    assert any(r.startswith("C3") for r in rows(text, "CONDUITS"))
    assert any(r.startswith("J3") for r in rows(text, "COORDINATES"))


def test_delete_node_with_draining_subcatchment_is_blocked(inp: Path):
    svc = InpModelService()
    with pytest.raises(HTTPException) as exc:
        svc.delete_object(inp, "node", "J1", cascade=True)
    assert exc.value.status_code == 409
    assert exc.value.detail["subcatchment_ids"] == ["S1"]
    assert inp.read_text(encoding="utf-8") == MODEL  # nothing written


def test_delete_node_without_cascade_reports_links(inp: Path):
    svc = InpModelService()
    with pytest.raises(HTTPException) as exc:
        svc.delete_object(inp, "node", "J3")
    assert exc.value.status_code == 409
    assert exc.value.detail["connected_link_ids"] == ["C3"]


def test_delete_link_removes_losses_tags_vertices(inp: Path):
    svc = InpModelService()
    svc.delete_object(inp, "link", "C2")
    text = inp.read_text(encoding="utf-8")
    for sec in ("CONDUITS", "XSECTIONS", "VERTICES"):
        assert not any(r.split()[0] == "C2" for r in rows(text, sec))
    assert not any(t.split()[1] == "C2" for t in rows(text, "TAGS"))
    assert any(r.startswith("C1") for r in rows(text, "LOSSES"))


def test_delete_subcatchment_reroutes_upstream(inp: Path):
    svc = InpModelService()
    svc.delete_object(inp, "subcatchment", "S2")
    text = inp.read_text(encoding="utf-8")
    for sec in ("SUBCATCHMENTS", "SUBAREAS", "INFILTRATION", "COVERAGES", "Polygons"):
        assert not any(r.split()[0] == "S2" for r in rows(text, sec)), sec

    svc2 = InpModelService()
    inp.write_text(MODEL, encoding="utf-8")
    res = svc2.delete_object(inp, "subcatchment", "S1")
    assert res["rerouted_subcatchment_ids"] == ["S2"]
    s2 = next(r for r in rows(inp.read_text(encoding="utf-8"), "SUBCATCHMENTS") if r.startswith("S2"))
    assert _tokenize(s2)[2] == "J1"


def test_write_is_atomic_no_temp_left(inp: Path):
    svc = InpModelService()
    svc.delete_object(inp, "link", "C3")
    leftovers = [p.name for p in inp.parent.iterdir() if p.name.endswith(".tmp")]
    assert leftovers == []
