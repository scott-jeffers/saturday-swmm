# Northeast Philadelphia sanitary sewer example: data sources

A demonstration model of a separate sanitary sewer system, from Bustleton's house
sewers to the Northeast Water Pollution Control Plant. It is **not** the Philadelphia
Water Department's system: the real sewers, their sizes and the plant's works are not
public, so everything below marked assumed was laid out for the demo.

- **Street centrelines** (where the collection sewers run, and the Delaware interceptor's route): City of Philadelphia (`Street_Centerline`).
- **Parcels** (population and flows): Philadelphia Water Department parcels (`pwd_parcels`), via OpenDataPhilly. The plant site is the PWD parcel at 3899 Richmond St.
- **Pennypack Creek** (the Pennypack interceptor's route): City of Philadelphia hydrographic features (`Hydrographic_Features_Arc`).
- **Buried streams** (the valleys Bustleton's trunk sewers follow): City of Philadelphia historic streams, from the 1842 Ellet survey (`HistoricStreams_Arc`).
- **Ground elevations**: USGS 3D Elevation Program, 1 m lidar, via the Elevation Point Query Service.
- **Storms**: NOAA Atlas 14, Volume 2, 2-, 10- and 100-year 24-hour depths (3.26, 4.82 and 7.70 in) on an NRCS Type II distribution.

**Assumed, not real:** every pipe, its size, depth and slope; the pump stations, force mains, equalization basin, relief overflow and their settings; the control rules; the Holmesburg, Tacony and Mayfair trunks (lumped); per-person flows (80 gallons a day), people per home, infiltration and the RDII unit hydrographs.

Rebuild with `python scripts/build_philly_sanitary_example.py` (`--fetch` samples elevations not yet cached).
