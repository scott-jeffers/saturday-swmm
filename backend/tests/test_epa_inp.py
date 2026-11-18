"""Tests for INP sanitizing (OpenSWMM 2D sections, PCSWMM '*' outlets)."""

from app.services.epa_inp import (
    SURFACE_OUTFALL_ID,
    read_connect2d_nodes,
    sanitize_for_pyswmm,
    strip_openswmm_2d_sections,
    surface_outlet_subcatchments,
)


def test_strips_2d_sections_keeps_junctions():
    text = """[TITLE]
Test
[JUNCTIONS]
J1  100  3  0  0  0
[2D_OPTIONS]
REPORT_2D YES
[2D_VERTICES]
1  0  0  1
[CONDUITS]
C1  J1  J2  10  0.01  0  0  0  0
[2D_VERTEX_NODE_MAP]
1  J1  0.67  1
"""
    cleaned, removed = strip_openswmm_2d_sections(text)
    assert "2D_OPTIONS" in removed
    assert "2D_VERTICES" in removed
    assert "2D_VERTEX_NODE_MAP" in removed
    assert "[JUNCTIONS]" in cleaned
    assert "[CONDUITS]" in cleaned
    assert "2D_OPTIONS" not in cleaned
    assert "REPORT_2D" not in cleaned


def test_noop_when_no_2d():
    text = "[JUNCTIONS]\nJ1  0  0\n"
    cleaned, removed = strip_openswmm_2d_sections(text)
    assert removed == []
    assert "[JUNCTIONS]" in cleaned


PCSWMM = """[SUBCATCHMENTS]
;;Name  Gage  Outlet  Area
S1      RG1   *       2.5   0.3  159  6.6  0
S2      RG1   J1      1.4   20   171  8.7  0

[JUNCTIONS]
;;Name  Elev  MaxD  Init  Sur  Aponded
J1      100   3     0     30   0
J2      99    3     0     30   0

[OUTFALLS]
OF1     90    FREE  NO

[TAGS]
Node       J1               Connect2D
Node       OF1              2D_OUT
Subcatch   S1               WDT

[POLYGONS]
S1  0  0
S1  1  0
"""


def test_pcswmm_star_outlets_and_connect2d():
    assert read_connect2d_nodes(PCSWMM) == {"J1"}
    assert surface_outlet_subcatchments(PCSWMM) == ["S1"]
    text, rep = sanitize_for_pyswmm(PCSWMM, zero_surcharge_nodes={"J1"})
    assert rep.surface_subcatchments == ["S1"]
    assert rep.surcharge_zeroed == 1
    assert rep.added_outfall == SURFACE_OUTFALL_ID
    lines = {ln.split()[0]: ln.split() for ln in text.splitlines()
             if ln.strip() and not ln.startswith(("[", ";"))}
    assert lines["S1"][2] == SURFACE_OUTFALL_ID       # '*' re-pointed
    assert lines["S2"][2] == "J1"                     # untouched
    assert lines["J1"][4] == "0"                      # coupled: SurDepth -> 0
    assert lines["J2"][4] == "30"                     # uncoupled: unchanged
    assert SURFACE_OUTFALL_ID in lines                # outfall exists
    assert "[TAGS]" not in text and "[POLYGONS]" not in text
    assert " * " not in text
