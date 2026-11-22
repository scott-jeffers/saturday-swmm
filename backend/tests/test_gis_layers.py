from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.services.gis_service import gis_service
from app.services.project_service import project_service

POLY = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Parcel A", "area": 12},
            "geometry": {"type": "Polygon", "coordinates": [[[-75.19, 39.95], [-75.18, 39.95], [-75.18, 39.96], [-75.19, 39.95]]]},
        },
        {"type": "Feature", "properties": {"name": "Inlet", "kind": "B"}, "geometry": {"type": "Point", "coordinates": [-75.185, 39.955]}},
    ],
}


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "demo.inp").write_text("[OPTIONS]\nFLOW_UNITS CFS\n\n[JUNCTIONS]\nJ1 0 0\n\n[COORDINATES]\nJ1 2690000 235000\n", encoding="utf-8")
    project_service.open_project(str(tmp_path))
    project_service.set_crs("EPSG:2272")
    return tmp_path


def test_geojson_and_zip_import(project: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    src = tmp_path_factory.mktemp("src")
    gj = src / "parcels.geojson"
    gj.write_text(json.dumps(POLY), encoding="utf-8")
    layer = gis_service.ingest_vector(str(gj))
    assert layer["type"] == "vector" and layer["feature_count"] == 2
    assert layer["fields"] == ["name", "area", "kind"]
    assert set(layer["geometry_types"]) == {"Polygon", "Point"}
    assert layer["bounds"]["west"] == pytest.approx(-75.19, abs=1e-3)

    z = src / "bundle.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.write(gj, "inner/parcels.geojson")
    assert gis_service.ingest_vector(str(z), name="Zipped")["name"] == "Zipped"

    bad = src / "notes.txt"
    bad.write_text("x")
    with pytest.raises(HTTPException):
        gis_service.ingest_vector(str(bad))


def test_style_patch_web_and_geojson_layers(project: Path) -> None:
    a = gis_service.add_geojson_layer("Inlets", POLY, source="https://example.com/FeatureServer/0")
    styled = gis_service.patch_layer(a["id"], {"style": {"color": "#ff0000", "label_field": "name"}})
    assert styled["style"] == {"color": "#ff0000", "label_field": "name"}
    cleared = gis_service.patch_layer(a["id"], {"style": {"label_field": ""}})
    assert cleared["style"] == {"color": "#ff0000"}

    w = gis_service.add_web_layer("Imagery", {"kind": "xyz", "url": "https://tiles.example.com/{z}/{x}/{y}.png"})
    assert w["type"] == "tiles" and w["web"]["kind"] == "xyz" and w["preview_url"] is None
    assert w["z_order"] > a["z_order"]
    with pytest.raises(HTTPException):
        gis_service.add_web_layer("Bad", {"kind": "xyz", "url": "file:///etc/passwd"})

    ids = [L["id"] for L in gis_service.list_layers()["layers"]]
    assert a["id"] in ids and w["id"] in ids
    gis_service.delete_layer(w["id"])
    assert w["id"] not in [L["id"] for L in gis_service.list_layers()["layers"]]


def test_cad_and_gpx_import(project: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    """DXF drawings take the project's coordinate system; GPX is lon/lat."""
    pyogrio = pytest.importorskip("pyogrio")
    shapely = pytest.importorskip("shapely.geometry")
    import geopandas as gpd  # noqa: PLC0415

    src = tmp_path_factory.mktemp("cad")
    dxf = src / "survey.dxf"
    gpd.GeoDataFrame({"Layer": ["CURB"]}, geometry=[shapely.LineString([(2690000, 235000), (2690100, 235050)])]).to_file(dxf, driver="DXF")
    layer = gis_service.ingest_vector(str(dxf))
    assert layer["feature_count"] == 1
    assert layer["bounds"]["west"] == pytest.approx(-75.2, abs=0.3)  # Philadelphia, via EPSG:2272

    gpx = src / "walk.gpx"
    gpd.GeoDataFrame({"name": ["Inlet"]}, geometry=[shapely.Point(-75.185, 39.955)], crs="EPSG:4326").to_file(gpx, driver="GPX")
    trk = src / "trk.gpx"
    trk.write_text(
        '<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">'
        '<wpt lat="39.955" lon="-75.185"><name>Inlet</name></wpt>'
        '<trk><name>Walk</name><trkseg><trkpt lat="39.95" lon="-75.19"/><trkpt lat="39.96" lon="-75.18"/></trkseg></trk></gpx>',
        encoding="utf-8",
    )
    assert gis_service.ingest_vector(str(gpx))["feature_count"] >= 1
    both = gis_service.ingest_vector(str(trk))
    assert both["feature_count"] == 2 and set(both["geometry_types"]) == {"LineString", "Point"}
    assert pyogrio  # imported for the skip
