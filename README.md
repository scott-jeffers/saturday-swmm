# Saturday-SWMM

Web frontend + local OpenSWMM backend for editing `.inp` files, viewing the network on a map, running simulations on your machine, and exploring `.rpt` / `.out` results (including profile views).

## Architecture

- **Frontend** (`frontend/`): React + Vite + TypeScript SPA with MapLibre map GUI
- **Backend** (`backend/`): FastAPI wrapping [`openswmm`](https://pypi.org/project/openswmm/) on localhost
- The browser never loads the engine; all file I/O and runs go through the API

## Prerequisites

- Python 3.10+ (3.13 tested)
- Node.js 20+
- Windows x86_64 (OpenSWMM ships prebuilt wheels)

## Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Optional: restrict openable folders with `PROJECTS_ROOT`:

```powershell
$env:PROJECTS_ROOT = "C:\Users\smj46\Code\SWMM6-JS"
```

Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

## Frontend setup

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to the backend on port 8000.

## Map GUI (Bellinge-ready)

1. Start backend and frontend.
2. Open project path:

   `C:\Users\smj46\Code\SWMM6-JS\examples\Bellinge_SWMM`

3. You land on the **Map** workspace:
   - Toggle **Grid** (engineering) vs **OSM** basemap (EPSG:25832 → WGS84)
   - Select nodes / links / subcatchments; edit attributes in the inspector
   - Drag nodes to move them (writes `[COORDINATES]`)
   - After a run, scrub the **time slider** to color by depth/flow
   - Use **Profile** pick mode to choose start/end nodes for a longitudinal profile
   - **Background GIS**: add DEM (GeoTIFF) or shapefile (`.zip` / `.shp`) under Layers — full files are copied into `{project}/gis/source/`; the map shows a light hillshade / GeoJSON preview from `{project}/gis/preview/`

### Background GIS (DEM + shapefiles)

Backend deps include `rasterio`, `pyogrio`, `shapely`, `pyproj`, `pillow`, and `geopandas`. On Windows these usually install as binary wheels (no separate GDAL installer). If `pip install -r requirements.txt` fails on rasterio, install a matching wheel from [rasterio](https://rasterio.readthedocs.io/) / use conda.

Layers persist in `{project}/gis/layers.json` and reload when you reopen the project. Sources without CRS (no GeoTIFF tag / no `.prj`) prompt for an EPSG code (default `EPSG:25832`). Full DEM files remain on disk for future 2D mesh sampling.

Small sample model: `C:\Users\smj46\Code\SWMM6-JS\examples`

> Note: Bellinge is a multi-day continuous simulation with 1-minute reporting — a full run can take a while on local hardware.

## API overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/projects/open` | Open a project folder |
| GET | `/api/projects/current` | Active project info |
| GET/PUT | `/api/inp` | Read / save INP text |
| GET | `/api/model/network` | GeoJSON network + bounds |
| GET/PATCH | `/api/model/objects/{type}/{id}` | Read / patch object |
| GET | `/api/model/profile` | Longitudinal profile path |
| POST | `/api/runs` | Start simulation |
| GET | `/api/runs/current` | Run status |
| DELETE | `/api/runs/current` | Cancel run |
| GET | `/api/rpt` | Report text |
| GET | `/api/out/metadata` | OUT metadata |
| GET | `/api/out/periods` | Report timestamps |
| GET | `/api/out/snapshot` | Bulk depths/flows at a period |
| GET | `/api/out/nodes/{id}/series` | Node depth series |
| GET | `/api/out/links/{id}/series` | Link flow series |
| POST | `/api/projects/browse-file` | Native file picker (DEM / shapefile) |
| GET | `/api/gis/layers` | List background GIS layers |
| POST | `/api/gis/layers/dem` | Ingest DEM GeoTIFF from local path |
| POST | `/api/gis/layers/vector` | Ingest shapefile zip/shp from local path |
| PATCH/DELETE | `/api/gis/layers/{id}` | Update visibility/opacity or remove |
| GET | `/api/gis/preview/{id}/…` | Hillshade PNG / vector GeoJSON |

## Notes

- Models should be OpenSWMM / SWMM-compatible `.inp` files with `[COORDINATES]` for map display.
- Default CRS for basemap reprojection is **EPSG:25832** (Danish UTM32 / Bellinge).
- Simulation uses local CPU and writes `.rpt` / `.out` beside the `.inp`.
