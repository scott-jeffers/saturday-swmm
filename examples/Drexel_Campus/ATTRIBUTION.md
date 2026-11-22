# Drexel University campus example: data sources

A demonstration model, not a model of Drexel's or Philadelphia's real drainage.

- **Parcels** (subcatchments): Philadelphia Water Department parcels (`pwd_parcels`), City of Philadelphia, via OpenDataPhilly. Drexel-owned parcels in University City.
- **Building footprints** (roof area, impervious cover): City of Philadelphia, Department of Licenses and Inspections (`LI_BUILDING_FOOTPRINTS`).
- **Street centrelines** (pipe routes): City of Philadelphia (`Street_Centerline`).
- **Inlets** (background layer): Philadelphia Water Department (`INLETS`).
- **Ground elevations and slopes**: USGS 3D Elevation Program, 1 m lidar, via the Elevation Point Query Service.
- **Storm**: NOAA Atlas 14, Volume 2, 2-year 24-hour depth (3.26 in), on an NRCS Type II distribution.

**Assumed, not real:** every pipe, its size, depth and slope; the outfall; the paved share of each parcel outside its buildings; soils; and the green infrastructure in the With LID scenario. The real sewers in University City are combined sewers and are not public.

Rebuild with `python scripts/build_drexel_example.py` (`--fetch` refreshes the public data).
