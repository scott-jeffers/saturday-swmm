from __future__ import annotations

import json
from pathlib import Path

from app.services.project_service import DEFAULT_PROJECT_CRS, ProjectService


def _write_minimal_inp(folder: Path) -> Path:
    inp = folder / "demo.inp"
    inp.write_text(
        "[TITLE]\nDemo\n\n[OPTIONS]\nFLOW_UNITS CFS\n\n[JUNCTIONS]\nJ1  0  0\n\n"
        "[COORDINATES]\nJ1  1000  2000\n",
        encoding="utf-8",
    )
    return inp


def test_project_crs_default_and_persist(tmp_path: Path) -> None:
    _write_minimal_inp(tmp_path)
    svc = ProjectService()
    info = svc.open_project(str(tmp_path))
    assert info.crs == DEFAULT_PROJECT_CRS
    assert info.crs_proj4
    settings = json.loads((tmp_path / ".saturday-swmm.json").read_text(encoding="utf-8"))
    assert settings["crs"] == DEFAULT_PROJECT_CRS
    assert settings["crs_proj4"]


def test_project_crs_set_and_reload(tmp_path: Path) -> None:
    _write_minimal_inp(tmp_path)
    svc = ProjectService()
    svc.open_project(str(tmp_path))
    updated = svc.set_crs("EPSG:2272")
    assert updated.crs == "EPSG:2272"
    assert updated.crs_proj4
    assert "proj" in (updated.crs_proj4 or "").lower() or "+" in (updated.crs_proj4 or "")

    svc2 = ProjectService()
    again = svc2.open_project(str(tmp_path))
    assert again.crs == "EPSG:2272"


def test_project_crs_from_gis_manifest(tmp_path: Path) -> None:
    _write_minimal_inp(tmp_path)
    gis = tmp_path / "gis"
    gis.mkdir()
    (gis / "layers.json").write_text(
        json.dumps({"layers": [], "project_crs": "EPSG:26918"}),
        encoding="utf-8",
    )
    svc = ProjectService()
    info = svc.open_project(str(tmp_path))
    assert info.crs == "EPSG:26918"
