# Roadmap

## Stage 1 — portable local app (0.2)

Done: one-port local server that serves the UI, portable Windows zip with bundled Python and
locked dependencies, OpenSWMM 6 + EPA SWMM 5 (PySWMM) + hybrid engines, versioned releases with an
in-app update check.

## Stage 2 — zero-install browser mode (planned)

Goal: open a URL and work without downloading anything, still computing on the user's own
hardware (inside the browser tab).

What can move into the browser:

- **EPA SWMM 5 engine in WebAssembly.** The SWMM 5.2 C source (public domain) compiles to WASM with
  Emscripten. A Web Worker runs it on files held in memory, so 1D simulations, `.rpt` and `.out`
  work offline in the tab.
- **INP parsing/editing and `.out` reading in TypeScript**, so the map, editor, tables, time series
  and profiles don't need the server.
- **Projects via the File System Access API** (Chrome/Edge): open a real folder, save back to it.
  Firefox/Safari fall back to upload/download of the `.inp`.
- **Hosting:** the built UI as a static site (GitHub Pages), versioned per release.

What stays in the local app (too heavy or not portable to WASM today): OpenSWMM 6 and its 2D
solver, Basilisk hybrid 2D, rasterio/GDAL GIS ingest of large DEMs, and multi-hour continuous runs.

Design: the frontend gets an "engine provider" interface with two implementations — the local API
(today) and an in-browser WASM worker. The UI detects which is available; when the local app is
running, the hosted page can use it for the heavy engines.

Steps:
1. Extract the API client behind a provider interface (no behaviour change).
2. Port INP parsing and `.out` reading to TypeScript with shared test fixtures from `examples/`.
3. Build `swmm5.wasm` in CI from a pinned SWMM 5.2 source tag; run `examples/sample.inp` in a
   worker and compare to PySWMM results in tests.
4. File System Access project storage; static build published per release.
