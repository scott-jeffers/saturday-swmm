"""Delineation from a DEM: a synthetic valley draining to one corner."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")

from app.services.delineate_service import delineate  # noqa: E402
from app.services.gis_service import gis_service  # noqa: E402
from app.services.project_service import project_service  # noqa: E402


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "demo.inp").write_text("[OPTIONS]\nFLOW_UNITS CFS\n\n[JUNCTIONS]\nJ1 0 0\n\n[COORDINATES]\nJ1 2690000 235000\n", encoding="utf-8")
    project_service.open_project(str(tmp_path))
    project_service.set_crs("EPSG:2272")
    # 100 x 100 cells of 10 ft: a V valley along the middle column, sloping south.
    from rasterio.transform import from_origin

    n, cell = 100, 10.0
    yy, xx = np.mgrid[0:n, 0:n]
    elev = 100 - 0.1 * yy + 1.0 * np.abs(xx - n // 2)  # gentle fall south, steep sides: everything runs to the centre line
    dem = tmp_path / "dem.tif"
    with rasterio.open(dem, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32", crs="EPSG:2272", transform=from_origin(2690000, 236000, cell, cell)) as dst:
        dst.write(elev.astype("float32"), 1)
    gis_service.ingest_dem(str(dem), name="Test DEM")
    return tmp_path


def test_delineates_the_valley(project: Path) -> None:
    # Near the valley's lower end, a little off the centre line: it snaps onto it.
    r = delineate(2690000 + 52 * 10, 236000 - 90 * 10)
    assert r["snapped"] is True
    assert r["area_units"] == "ac"
    # Cells with row + |col - 50| <= 90 reach the centre line above the outlet:
    # about 6,600 of the 10,000 cells of 100 ft², so about 15 acres.
    assert 10 < r["area"] < 20
    assert r["slope_pct"] > 1
    assert r["flow_length"] > 500
    assert r["width"] and r["width"] > 0
    assert len(r["polygon"]) >= 4
    lon, lat = r["outlet_wgs84"]
    assert -76 < lon < -74 and 39 < lat < 41  # Philadelphia via State Plane PA South


def test_outside_the_dem(project: Path) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        delineate(0, 0)
