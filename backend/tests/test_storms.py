from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.project_service import project_service
from app.services.run_archive_service import run_archive_service
from app.services.storm_service import MODEL, apply_storm, parse_rain_text, storm_service

INP = """[TITLE]
demo

[OPTIONS]
FLOW_UNITS           CFS
START_DATE           01/01/2020
START_TIME           00:00:00
END_DATE             01/01/2020
END_TIME             06:00:00

[RAINGAGES]
;;Name Format Interval SCF Source
RG1    INTENSITY 0:15 1.0 TIMESERIES TS1
RG2    VOLUME 1:00 1.0 FILE "rain.dat" STA IN

[TIMESERIES]
TS1 0:00 0.5

[JUNCTIONS]
J1 0 5
"""

RAIN = """; a storm
STORM 2024 6 1 0 0 0.1
STORM 2024 6 1 0 5 0.3
STORM 2024 6 1 0 10 0.2
"""


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "demo.inp").write_text(INP, encoding="utf-8")
    (tmp_path / "rain.dat").write_text("STA 2020 1 1 0 0 0.1\n", encoding="utf-8")
    project_service.open_project(str(tmp_path))
    return tmp_path


def test_parse_rain_text_normalises_dates() -> None:
    p = parse_rain_text("06/01/2024 00:00 0.1\n06/01/2024 00:05 0.2\n")
    assert p["station"] == "STORM" and p["records"] == 2
    assert p["text"].splitlines()[0].split() == ["STORM", "2024", "6", "1", "0", "0", "0.1"]
    with pytest.raises(HTTPException):
        parse_rain_text("nothing here")
    with pytest.raises(HTTPException):
        parse_rain_text("A 2024 1 1 0 0 1\nB 2024 1 1 0 5 1\n")


def test_apply_storm_rewrites_gages_and_window() -> None:
    from datetime import datetime

    out = apply_storm(INP, "/x/storms/s.dat", "STORM", "VOLUME", "0:05", "IN", datetime(2024, 6, 1), datetime(2024, 6, 1, 12, 10))
    gages = [ln for ln in out.split("[RAINGAGES]")[1].split("[TIMESERIES]")[0].splitlines() if ln.strip() and not ln.startswith(";")]
    assert len(gages) == 2 and all('FILE       "/x/storms/s.dat" STORM IN' in g for g in gages)
    opts = out.split("[OPTIONS]")[1].split("[RAINGAGES]")[0]
    assert "START_DATE           06/01/2024" in opts and "END_TIME             12:10:00" in opts
    assert "REPORT_START_DATE    06/01/2024" in opts  # added when missing
    assert "[TIMESERIES]\nTS1 0:00 0.5" in out  # untouched


def test_storm_library_and_cells(project: Path) -> None:
    s = storm_service.create("10-year 24-hr", RAIN, fmt="VOLUME", interval="0:05", units="IN", after_hours=2, return_period=10)
    assert s["id"] == "10-year-24-hr" and s["start"] == "2024-06-01T00:00" and s["end"] == "2024-06-01T00:15"
    assert s["total"] == pytest.approx(0.6)
    ids = [x["id"] for x in storm_service.list()["storms"]]
    assert ids == [MODEL, "10-year-24-hr"]

    # results follow the active storm
    inp = project / "demo.inp"
    assert project_service.out_path() == inp.with_suffix(".out")
    project_service.set_active_storm(s["id"])
    assert project_service.current().storm_name == "10-year 24-hr"
    run = project_service.run_inp()
    assert run == project / ".storms" / s["id"] / "demo.inp"
    assert project_service.out_path() == run.with_suffix(".out")
    text = run.read_text(encoding="utf-8")
    assert "storms/10-year-24-hr.dat" in text and "END_TIME             02:15:00" in text
    assert inp.read_text(encoding="utf-8") == INP  # the model itself is untouched

    # grid: one scenario × two storms, a result appears once its files exist
    run.with_suffix(".out").write_bytes(b"x")
    run.with_suffix(".rpt").write_text("", encoding="utf-8")
    m = run_archive_service.matrix(storm_service)
    cell = next(c for c in m["cells"] if c["storm"] == s["id"])
    assert cell["has_results"] and cell["id"] == "cell-base~10-year-24-hr"
    assert m["active"] == {"scenario": "base", "storm": s["id"]}
    assert run_archive_service.paths(cell["id"])[0] == run.with_suffix(".out")

    # deleting the storm drops its results and falls back to the model's rainfall
    storm_service.delete(s["id"])
    assert project_service.active_storm_id() == MODEL
    assert not (project / ".storms" / s["id"]).exists()
    with pytest.raises(HTTPException):
        storm_service.delete(MODEL)
