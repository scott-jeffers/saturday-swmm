"""DEM ingest must stream windows — never src.read() the full raster."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin

from app.services.gis_service import GisService


def test_copy_raster_windowed_never_calls_full_read(tmp_path: Path):
    svc = GisService()
    # Tiny synthetic GeoTIFF
    src_path = tmp_path / "src.tif"
    height, width = 64, 64
    transform = from_origin(0, 64, 1, 1)
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:25832",
        "transform": transform,
        "nodata": -9999.0,
    }
    data = np.ones((height, width), dtype=np.float32)
    with rasterio.open(src_path, "w", **profile) as dst:
        dst.write(data, 1)

    dest = tmp_path / "dest.tif"
    with rasterio.open(src_path) as src:
        out_profile = svc._cog_profile(
            src.profile,
            crs=src.crs,
            width=src.width,
            height=src.height,
            transform=src.transform,
        )
        # Spy: full-array read must not happen during windowed copy
        real_read = src.read

        def guarded_read(*args, **kwargs):
            # Windowed reads pass window=...; full read is read() or read(1) without window
            if not args and not kwargs:
                raise AssertionError("full src.read() not allowed")
            if args == (1,) and "window" not in kwargs and len(kwargs) == 0:
                # band-only full read
                raise AssertionError("full band src.read(1) not allowed")
            return real_read(*args, **kwargs)

        with patch.object(src, "read", side_effect=guarded_read):
            # Our windowed copy uses src.read(i, window=window) — should pass
            svc._copy_raster_windowed(src, dest, out_profile)

    assert dest.is_file()
    with rasterio.open(dest) as check:
        assert check.profile.get("tiled") is True
        assert check.width == width
        assert check.height == height
        arr = check.read(1)
        assert arr.shape == (height, width)
        assert float(arr.mean()) == pytest.approx(1.0)
