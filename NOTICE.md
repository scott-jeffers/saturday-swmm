# Third-party notices

Saturday-SWMM is GPL-3.0-or-later. It depends on (and ships example data from) other projects that keep their own licenses. This file is the project-level credit list; package managers retain full license texts for installed dependencies.

## Simulation engine

**OpenSWMM Engine** — [HydroCouple/openswmm.engine](https://github.com/HydroCouple/openswmm.engine)  
Author: **Caleb Buahin** (HydroCouple)  
License: [MIT](https://opensource.org/licenses/MIT)  
PyPI: [`openswmm`](https://pypi.org/project/openswmm/)

Saturday-SWMM uses the OpenSWMM Python package (`openswmm.engine`) as its local solver. OpenSWMM is a community-driven continuation of the EPA Storm Water Management Model (SWMM). Original EPA SWMM material is in the public domain (17 U.S.C. § 105).

Copyright (c) HydroCouple / Caleb Buahin. See the OpenSWMM repository for the full MIT license text.

**EPA SWMM 5 via PySWMM** — [pyswmm/pyswmm](https://github.com/pyswmm/pyswmm) (BSD-2-Clause) and [`swmm-toolkit`](https://github.com/pyswmm/swmm-python) (CC0 / public domain). The EPA SWMM 5 engine is public domain (U.S. EPA). Used by the "EPA SWMM 5" engine.


## Portable release

The Windows portable zip bundles the official **CPython** embeddable distribution (PSF License) and the exact Python packages listed in `backend/requirements-windows.lock`, each under its own license (kept in `python/Lib/site-packages/*.dist-info`).

## Example data

**Bellinge data set** (Pedersen et al., 2021) — CC BY 4.0  
See [examples/Bellinge_SWMM/ATTRIBUTION.md](examples/Bellinge_SWMM/ATTRIBUTION.md) and [examples/Bellinge-2D/ATTRIBUTION.md](examples/Bellinge-2D/ATTRIBUTION.md).

## Other runtime dependencies (summary)

These are pulled in via `pip` / `npm` and are not re-licensed by this project. All listed licenses are permissive and compatible with using them from a GPL application as separate dependencies.

| Component | Typical license | Role |
|-----------|-----------------|------|
| FastAPI, Starlette, Uvicorn, Pydantic | MIT / BSD | Backend API |
| rasterio, pyogrio, shapely, pyproj, geopandas, Pillow, h5py | MIT / BSD / Apache-2.0 (as published by each project) | GIS / 2D I/O |
| React, React DOM, Vite, TypeScript | MIT / Apache-2.0 | Frontend toolchain |
| MapLibre GL JS | BSD-3-Clause | Map rendering |
| react-map-gl, Turf.js, proj4, Recharts | MIT / ISC / BSD | Map / geo / charts |
| Radix UI, Tailwind CSS, Lucide, Monaco Editor, TanStack Query | MIT | UI |
| Inter (`@fontsource/inter`) | OFL-1.1 | UI font |

**Audio** — `frontend/public/audio/coastal-starlight.mp3` (broadcast mode background track). *Source and license to be confirmed before redistribution.*

Basemap tiles (when OSM or other remote styles are used) are subject to the tile provider’s terms (for example OpenStreetMap contributors’ data under ODbL).

If you redistribute binary wheels or minified bundles that embed third-party code, keep each upstream copyright and license notice intact as required by that license.
