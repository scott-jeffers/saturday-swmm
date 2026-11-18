# Saturday-SWMM Architecture

Local-first OpenSWMM workstation: edit INP, map the network, run simulations, explore 1D/2D results.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite + MapLibre |
| Backend | FastAPI wrapping OpenSWMM (native wheel) |
| GIS | rasterio / pyogrio / shapely / pyproj |
| 2D results | HDF5 via h5py (`*.2d.h5`) |
| 1D results | OpenSWMM `OutputReader` (`*.out`) |

The browser never loads the engine; all file I/O and runs go through the API.

## Principles

1. **Geometry once, scalars many** — mesh/network geometry loads once; per-period values update a numeric buffer only.
2. **Binary for bulk numbers, JSON for metadata** — float32 arrays over the wire; JSON for counts, bounds, min/max, CRS.
3. **Explicit scale tiers** — shared threshold `MESH_GEOJSON_TRIANGLE_LIMIT = 20_000`.
4. **Backend reads windows, not wholes** — one HDF5 row per period; no `ds[:]` on large files; no full-array DEM reads.
5. **No MapLibre workarounds for large meshes** — custom WebGL layer for ≥20k triangles; GeoJSON fill only below the threshold.

## Scale tiers

| Tier | Triangle count | Mesh geometry | Depth coloring |
|------|----------------|---------------|----------------|
| Small | &lt; 20 000 | GeoJSON features OK | MapLibre fill + property `depth` |
| Medium | 20 000 – 500 000 | Compact `vertices` + `triangles` arrays | Binary float32 + `Mesh2DCustomLayer` |
| Large | &gt; 500 000 | Same + optional LOD (future) | Same |

Constant: `MESH_GEOJSON_TRIANGLE_LIMIT` (backend) / `MESH_LARGE_THRESHOLD` (frontend) = **20 000**.

## Binary 2D snapshot contract

| Endpoint | Body |
|----------|------|
| `GET /api/2d/snapshot/binary?period=N&variable=depth` | Little-endian float32 × `n_faces` |
| `GET /api/2d/envelope/binary?variable=depth` | Little-endian float32 × `n_faces` |

Response headers:

- `Content-Type: application/octet-stream`
- `X-Triangle-Count`, `X-Period`, `X-Value-Min`, `X-Value-Max`, `X-Variable`, `X-Unit`

JSON endpoints remain for small meshes and tooling.

## Data flow (2D results)

```
*.2d.h5  →  cached h5py handle  →  binary float32 row  →  Float32Array
                                                              ↓
mesh vertices/triangles (once)  →  Mesh2DCustomLayer WebGL  →  MapLibre
```

## Manual benchmark checklist

See [BENCHMARKS.md](BENCHMARKS.md). Gate large-mesh changes on a ~155k-cell / multi-GB HDF5 model.

## DEM ingest

- Default: windowed copy into `gis/source/` as tiled Deflate GeoTIFF (COG-style).
- `copy=false`: reference absolute path without duplicating (project CRS must match).
- Map always shows downsampled hillshade preview; full raster used for mesh sampling only.
- Never call `src.read()` on the full DEM for same-CRS ingest.

## Simulation engines

| Engine | Config | Runner |
|--------|--------|--------|
| `openswmm` (default) | `.saturday-swmm.json` | [`run_service.py`](../backend/app/services/run_service.py) |
| `pyswmm` (EPA SWMM 5.2) | same | [`pyswmm_run_service.py`](../backend/app/services/pyswmm_run_service.py) — runs a temp copy without OpenSWMM-only sections; writes the normal `.rpt`/`.out` |
| `flow_accum` | same | [`flow_accum_service.py`](../backend/app/services/flow_accum_service.py) |

All engines are registered in [`api/runs.py`](../backend/app/api/runs.py) (`ENGINES`): one start
lock, and status/cancel/live dispatch to whichever engine is running.

## Project folder layout

```
my-project/
  model.inp                 Base model (always a plain SWMM file)
  model.rpt / model.out     Results of the last run of the active model
  .saturday-swmm.json       App settings: CRS, engine, active scenario
  scenarios.json            Scenario tree (id, name, parent, created)
  scenarios/<slug>/model.inp         A scenario: a full, standalone SWMM file
  scenarios/<slug>/model.parent.inp  Parent as it was when last synced (merge base)
  runs/<id>/                Saved runs: .out, .rpt and run.json (engine, scenario, summary)
  gis/                      DEMs and shapefiles added as layers
```

Scenario updates are a three-way merge keyed by section and object ID (`scenario_service.py`):
parent changes are taken where the child left an object alone; where both changed it, the
child's version is kept and the clash is reported. `runs/` keeps the newest 20 unpinned runs.

## Updates

`updates_service.py` checks GitHub (app) and PyPI (openswmm, pyswmm, swmm-toolkit). Engine
updates run `pip install` into the app's own Python, import-check the result and roll back on
failure; the previous version is recorded so the user can undo. App updates download the next
portable zip beside the current folder, verify its SHA-256 and restart into it.

## Browser viewer

`npm run build:viewer` builds the same frontend with `VITE_VIEWER=1` and base `/viewer/`; the
Website workflow publishes it at saturday-swmm.com/viewer. In that build `src/viewer/router.ts`
answers `/api/*` inside the browser instead of the network, from files kept in IndexedDB
(`src/viewer/store.ts`). It ports the read-only backend logic: `.inp` parsing, network, objects,
profiles and Check model (`inp.ts`, `tools.ts`), the report parser (`rpt.ts`) and a SWMM binary
`.out` reader (`out.ts`). Anything else answers 501 and the UI hides it (`IS_VIEWER`).

Parity is tested, not assumed: `scripts/make_viewer_golden.py` runs a model through the real
backend and records its responses; `src/viewer/golden.test.ts` checks the viewer returns the
same. Shared tables (section columns, option groups, report columns) are exported from the
backend by `scripts/export_viewer_tables.py`, and CI fails if they drift.

## Local API guards

[`security.py`](../backend/app/security.py): `Host` must be a localhost name (DNS-rebinding
protection); mutating `/api` requests need the `X-Saturday-SWMM: 1` header (added to every `/api`
fetch by [`lib/apiFetch.ts`](../frontend/src/lib/apiFetch.ts)); model edits and project switches
return 409 while a run is in progress.

## Packaging

[`app/launcher.py`](../backend/app/launcher.py) serves API + built UI on one port
([`ui_static.py`](../backend/app/ui_static.py)). The portable release
([`packaging/windows`](../packaging/windows)) bundles embeddable CPython and
`requirements-windows.lock`; see [RELEASING.md](RELEASING.md).


## Non-goals

- Rust rewrite / new native modules for I/O
- Client-side HDF5 reader
- Full-resolution DEM tile server (document as future work)
- Cloud multi-user auth
- Replacing OpenSWMM as the default engine
