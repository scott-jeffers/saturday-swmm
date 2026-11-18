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
| `hybrid` | same + `hybrid/*.json` | [`hybrid_run_service.py`](../backend/app/services/hybrid/hybrid_run_service.py) |

Details: [HYBRID.md](HYBRID.md).

## Non-goals

- Rust rewrite / new native modules for I/O
- Client-side HDF5 reader
- Full-resolution DEM tile server (document as future work)
- Cloud multi-user auth
- Replacing OpenSWMM as the default engine
