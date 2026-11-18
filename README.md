# Saturday-SWMM

A local web app for urban drainage modelling. Open a folder with a SWMM `.inp`, edit the network
on a map, design storms, run the simulation **on your own computer**, and explore results — time
series, long-sections, live map colouring and 2D surface flooding — in your browser.

Engines:

| Engine | What it is | Use it for |
|---|---|---|
| **OpenSWMM 6** (default) | [OpenSWMM Engine](https://github.com/HydroCouple/openswmm.engine) by Caleb Buahin | 1D networks plus built-in 2D overland flow |
| **EPA SWMM 5** | EPA SWMM 5.2 via [PySWMM](https://github.com/pyswmm/pyswmm) | Reference 1D results, cross-checking OpenSWMM, SWMM 5 models |
| **Hybrid 1D/2D** | EPA SWMM 5 pipes coupled to a [Basilisk](http://basilisk.fr/) 2D surface | Surcharge spreading over terrain (see [docs/HYBRID.md](docs/HYBRID.md)) |
| **Flow accumulation** | DEM-only analysis, no SWMM run | Quick floodplain screening |

Choose the engine per project in **Settings → Simulation engine**.

## Get started (Windows, no install)

1. Download `Saturday-SWMM-<version>-win64.zip` from
   [Releases](https://github.com/scott-jeffers/saturday-swmm/releases).
2. Unzip it somewhere you can write to (e.g. `Documents`), then double-click **`Saturday-SWMM.cmd`**.
3. Your browser opens at `http://127.0.0.1:8765/`. Keep the console window open while you work;
   close it (or use **Quit** in the sidebar) to stop.

Everything stays on your machine — the server listens on `127.0.0.1` only. The release bundles its
own Python and exact, hash-verified dependencies, so it doesn't touch any Python you already have.
The app tells you when a newer release is available (sidebar badge and **About → Version & updates**).

## Run from source

Needs Python 3.10+ (3.13 tested) and Node.js 20+. OpenSWMM ships wheels for Windows x86_64 and Linux.

```powershell
# one-time setup
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
cd ..\frontend
npm ci
```

**Develop** (hot reload, two ports): `.\start-dev.ps1` → UI at <http://localhost:5280>, API on
`:8000` (Vite proxies `/api`). Stop with `.\stop-dev.ps1`. In VS Code / Cursor:
**Run Task → Saturday-SWMM: Start all**.

**Use like the release** (one port): `cd frontend; npm run build`, then
`backend\.venv\Scripts\python -m app.launcher` from `backend\`.

**Tests:** `cd backend; python -m pytest` and `cd frontend; npm test; npx tsc --noEmit`.

## Try it

- `examples/sample.inp` — tiny model, runs in a second with either engine.
- `examples/Bellinge_SWMM` and `examples/Bellinge-2D` — the
  [Bellinge data set](https://doi.org/10.11583/DTU.c.5029124) (Pedersen et al., 2021, CC BY 4.0;
  see the `ATTRIBUTION.md` files). Bellinge is a multi-day continuous run with 1-minute
  reporting, so a full run takes a while.

On the map: switch Grid / OSM / imagery basemaps, select and edit nodes, links and subcatchments,
drag nodes, draw new objects, scrub the time slider after a run, pick two nodes for a profile, and
add DEMs (GeoTIFF) or shapefiles as background layers (copied into `{project}/gis/`). Projects
without a CRS default to `EPSG:25832`; set yours with the compass button.

## Versions and releases

The version lives in [`VERSION`](VERSION) and is shown in the app. Every change is listed in
[CHANGELOG.md](CHANGELOG.md). Merging a version bump into `main` makes GitHub Actions build, test
and publish the release, with pinned dependencies ([`backend/requirements-windows.lock`](backend/requirements-windows.lock)) — see
[docs/RELEASING.md](docs/RELEASING.md). OpenSWMM itself can be updated or rolled back from the
Projects page (**System status → Updates**).

## Architecture

- `frontend/` — React + Vite + TypeScript, MapLibre map, Monaco INP editor.
- `backend/` — FastAPI on `127.0.0.1`: projects and `.inp` editing, runs for every engine, results
  (`.out`, `.rpt`, 2D HDF5), GIS ingest. In the release it also serves the built UI.
- The browser never loads an engine; all file I/O and runs go through the local API, which only
  accepts `localhost` requests carrying the app's `X-Saturday-SWMM` header and refuses model edits
  while a run is in progress.

More: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), API docs at `/docs` on the running server,
roadmap in [docs/ROADMAP.md](docs/ROADMAP.md).

## Configuration

| Variable | Effect |
|---|---|
| `PROJECTS_ROOT` | Only allow opening projects under this folder |
| `SATURDAY_SWMM_PORT` | Launcher port (default 8765) |
| `SATURDAY_SWMM_ALLOWED_HOSTS` | Extra host names the server answers to (comma separated) |
| `SATURDAY_SWMM_UI_DIR` | Serve the UI from a different folder |

## License

GPL-3.0-or-later — Copyright (C) 2026 Scott Jeffers. See [LICENSE](LICENSE) and third-party
credits in [NOTICE.md](NOTICE.md).
