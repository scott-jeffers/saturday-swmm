# PySWMM + Basilisk hybrid engine

Saturday-SWMM can run simulations with either:

| Engine | Role |
|--------|------|
| **OpenSWMM** (default) | 1D + built-in 2D shallow-water in one native solver |
| **Hybrid** (experimental) | EPA SWMM via **PySWMM** (1D hydrology + pipes) two-way coupled to **Basilisk** (adaptive-mesh Saint-Venant 2D surface) |

## Just works

1. Open **Settings** → choose **PySWMM + Basilisk**.
2. Make sure the project has a **DEM layer** (Layers → add GeoTIFF).
3. Click **Run** in the map header (or **Prepare hybrid model** first).

On Run / Prepare the backend automatically:

- Builds a **domain** from the network bounding box +10% (if no polygon yet).
- **Couples nodes**: PCSWMM `Connect2D`-tagged nodes when the INP has them,
  otherwise every junction/storage with coordinates. Each node's exchange
  orifice area defaults to its largest connected pipe cross-section (min 1 unit²).
- **Surface inflows**: subcatchments whose outlet is `*` (PCSWMM: "drains to the
  2D surface") put their runoff on the 2D surface at their polygon centroid.
- Writes `hybrid/model_pyswmm.inp`, an EPA-SWMM-parseable copy (see below).
- Finds a working **Basilisk surface solver** (see *Solver*), else falls back to a
  Python stub surface.

Hand-edited couplings (saved via `PUT /api/hybrid/coupling`) are marked
`generated_by: "user"` and are never regenerated.

## How the coupling works

Per coupling interval (`surface.json → coupling_interval`, default 10 s):

1. SWMM advances. Coupled junctions have **SurDepth = 0** in the sanitized INP, so
   SWMM overflows them at the rim; the interval's flood volume (from SWMM's own
   node statistics) goes onto the 2D cell at the node.
2. `*` subcatchment runoff goes onto the 2D cell at the subcatchment centroid.
3. Where the 2D surface is wet above a node whose head is below the 2D water
   level, water drains back through an orifice `Q = cd·A·√(2gΔH)` (free
   inflow uses the surface depth, submerged uses the head difference), limited
   to the water actually in the cell. Basilisk reports the volume it really
   removed and exactly that volume is returned to SWMM over the next interval
   (`generated_inflow`).
4. Basilisk advances the surface over the same interval.

The 2D side keeps an exact mass balance (written to `hybrid/summary.json`):
`flood + runoff in = drained back + boundary outflow + stored`.

### Units

Basilisk runs in SI with local coordinates (metres from the domain's SW corner).
Horizontal units come from the project CRS (e.g. EPSG:2272 is US survey feet);
SWMM flows, depths and elevations use the model's FLOW_UNITS (US → feet).
DEM elevations are assumed to be in model length units (`dem_z_units: "auto"`;
override with `"m"` or `"ft"`). Hybrid depth results are stored in **metres**.

### DEM / domain

The DEM is average-resampled (any CRS → project CRS) onto a
`2^max_level × 2^max_level` grid over the square domain, and cached
(`hybrid/basilisk/run/dem.bin`). Every AMR level samples an averaged pyramid of
that grid, so coarse cells get the true mean bed. DEM **no-data** becomes an
**outflow region** (water leaving the model area is removed and counted as
boundary loss); set `nodata_outflow: false` to make it a wall instead.

### Adaptive mesh

Cells refine on wavelet error of **depth and unit discharge h·u**
(`eta_tolerance` is the depth tolerance in metres, `discharge_tolerance` in
m²/s) between `min_level` and `max_level`. Bare terrain is never refined, so dry
areas stay coarse, and neither is fast-moving millimetre sheet flow (refining on
raw velocity did that: 240k cells at the West Whiteland peak).
Basilisk's elevation-conserving refinement (`conserve_elevation`) is deliberately
off: it is not mass-conservative on slopes, which matters more for coupling.

## INP sanitizing (`hybrid/model_pyswmm.inp`)

- OpenSWMM `[2D_*]` sections are stripped.
- PCSWMM `*` subcatchment outlets (EPA SWMM ERROR 209) are re-pointed to an
  isolated outfall `HYBRID_2D_SURFACE`; the runner re-injects that runoff in 2D.
- SurDepth → 0 on coupled junctions (PCSWMM exports often use 30 ft because its
  own 2D links handle the exchange).
- Graphics-only sections (`[POLYGONS]`, `[VERTICES]`, `[TAGS]`, `[MAP]`, …) are
  dropped (West Whiteland: 36 MB → 3.8 MB).

## Solver

The surface solver is one model-independent Basilisk program,
`backend/app/services/hybrid/basilisk/swmm2d.c`, driven over stdin/stdout
(protocol documented at the top of the file). It is found in this order; each
candidate must pass a small mass-conservation self-test:

1. `SATURDAY_SWMM2D` env var → path to a prebuilt binary.
2. `qcc` on PATH (Linux/macOS backend): compiled once into `backend/.basilisk/`
   (tries `-fopenmp` first, then serial).
3. **Windows**: bundled `basilisk/bin/swmm2d-win64.exe` (no WSL needed), built
   with **OpenMP** (`libgomp`). Portable C is shipped as `bin/_swmm2d.c` with
   `OMP()` pragmas active when `_OPENMP` is defined; POSIX shims live in
   `basilisk/winshim/`. Runtime DLLs (`libgomp-1.dll`, etc.) sit next to the exe.
   Rebuild: `basilisk/build_windows.sh` (Linux/WSL + `qcc -fopenmp` + MinGW) or
   `basilisk/build_windows_omp.ps1` (Windows MinGW, patches `_swmm2d.c` if `qcc`
   is unavailable).
4. Windows + WSL with Basilisk's `qcc`: compiled and run inside WSL (`-fopenmp`).

Basilisk child processes get `OMP_NUM_THREADS` from `SATURDAY_SWMM_OMP_THREADS`
(positive integer) or, by default, all logical CPUs — then the highest count that
**passes two mass-conservation self-tests** is kept (the Windows OpenMP-patched
portable C is currently stable at 1–2 threads; a full `qcc -fopenmp -source`
regen in WSL can unlock higher). See `GET /api/hybrid/capabilities` →
`omp_threads` / `basilisk_solver`.

Otherwise the run uses the Python **stub** surface (diffusion toy, no DEM) so the
UI still works. `GET /api/hybrid/capabilities` → `basilisk_solver` shows which
one is active; `hybrid/basilisk/build.log` has the details.

### Installing Basilisk (only for options 2/4)

```bash
# Linux or inside WSL Ubuntu
wget https://basilisk.fr/basilisk/basilisk.tar.gz && tar xzf basilisk.tar.gz
cd basilisk/src && ln -s config.gcc config && make -k && make
export BASILISK=$PWD PATH=$PATH:$PWD   # add to ~/.bashrc
```

## Project artifacts

Under `{project}/`:

| Path | Purpose |
|------|---------|
| `.saturday-swmm.json` → `simulation_engine` | `"openswmm"` \| `"hybrid"` |
| `hybrid/surface.json` | Domain polygon, Manning n, AMR levels/tolerances, coupling/frame intervals |
| `hybrid/coupling.json` | Coupled nodes `{node_id, x, y, cd, exchange_area}` + `surface_inflows` |
| `hybrid/model_pyswmm.inp` | Sanitized INP actually run by PySWMM (+ `.rpt` / `.out`) |
| `hybrid/basilisk/swmm2d.c` | Copy of the driver source (reference) |
| `hybrid/basilisk/run/` | Solver inputs (`config.txt`, `dem.bin`, `outside.bin`, `sources.txt`) |
| `hybrid/basilisk/build.log` | Solver discovery / self-test log |
| `hybrid/flux_log.jsonl` | Exchange diagnostics (every 6th interval) |
| `hybrid/summary.json` | Mass balance and timings of the last run |
| `hybrid/results.npz` | 2D depth frames (m) + `max_depth` for map playback |
| `hybrid/export/` | DEM-aligned GeoTIFFs from `POST /api/hybrid/export-rasters` (`max_depth_m.tif`, `max_wse_m.tif`) |

## Settings (`hybrid/surface.json`)

| Key | Default | Meaning |
|-----|---------|---------|
| `max_level` / `min_level` | auto / 5 | AMR levels; finest cell = domain / 2^max_level (auto: ~15 m, levels 7–11) |
| `mannings_n` | 0.03 | Surface roughness |
| `dry_depth` | 0.001 | m; no drainage / friction below this |
| `eta_tolerance` | 0.05 | AMR tolerance on depth (m) |
| `discharge_tolerance` | 0.01 | AMR tolerance on unit discharge h·u (m²/s) |
| `coupling_interval` | 10 | s between SWMM ↔ 2D exchanges |
| `frame_interval` / `frame_resolution` | 300 / 384 | stored depth frames |
| `dem_z_units` | auto | DEM elevation units |
| `nodata_outflow` | true | DEM no-data = outflow (else wall) |

## Limits

- Option B only: rain falls on SWMM subcatchments; no rain-on-grid yet.
- Surface solver uses OpenMP; PySWMM 1D routing remains effectively serial.
- Exchange is per node at one 2D cell; no inlet-capture curves yet.
