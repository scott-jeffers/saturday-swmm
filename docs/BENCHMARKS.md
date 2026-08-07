# Benchmarks

Record timings after large-mesh / results changes. Target model: ~155k triangles, multi-GB `*.2d.h5`.

## Checklist

Reference run: Bellinge, 78,285 vertices / 155,688 triangles, `EPSG:25832`.

| Scenario | Target | Measured | Notes |
|----------|--------|----------|-------|
| First 2D depth display (binary + custom layer) | &lt; 3 s after mesh ready | ~1 s | Geometry uploaded once; 467,064 vertices |
| Period scrub ×10 (cached) | &lt; 500 ms / step | ~6 ms | `setDepths` 5.1–6.0 ms, colors + GPU upload |
| Toggle 2D depth on/off ×5 | Instant, no blank tiles | Instant | Solid-color swap, geometry untouched |
| Envelope / all-peaks view | &lt; 2 s | &lt; 1 s | Chunked server-side max |
| `/api/2d/periods` (no full HDF5 load) | &lt; 1 s | ~30 ms | Metadata only |
| DEM ingest multi-GB (streaming) | Completes; RSS ≪ file size | Completes | Windowed copy |

## How to measure

1. Open DevTools → Network + Performance.
2. Note `triangle_count` from `/api/2d/metadata`.
3. Confirm binary path: `/api/2d/snapshot/binary` responses ≈ `triangle_count × 4` bytes.
4. Confirm custom layer: no GeoJSON `setData` of 100k+ features on period change.
