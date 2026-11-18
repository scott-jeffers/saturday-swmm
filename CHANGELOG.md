# Changelog

All notable changes to Saturday-SWMM. Versions follow [Semantic Versioning](https://semver.org/);
the version lives in `VERSION` (see `docs/RELEASING.md`).

## [Unreleased]

## [0.6.0] - 2026-11-18

### Changed
- **A cleaner, calmer interface.** New colour tokens for dark and light themes, one type scale
  (13–14 px body, 19 px page titles) and one set of buttons, fields, tabs and panels everywhere.
- **Labelled sidebar** grouped into Model and Analysis, with a collapse button (remembered). The
  rainbow icon rail is gone.
- **Simpler header**: model name, scenario, coordinate system and engine on the left; undo/redo,
  Check and Run on the right. Run status is a single item ("Running 42%", "Results ready",
  "Run failed"), a thin progress line runs under the header during a run, and Stop only
  appears while a run is going.
- **Elements**: plain-language column names (Invert elev., Max depth…), borderless cells you
  click to edit, Enter saves the row, and Save/Discard for all changes in the page header
  instead of a Save button on every row.
- **Simulation settings** has a section list on the left; Appearance moved to the end.
- **Map**: one compact time bar (play, step, slider, time, Peak, All peaks), every floating
  panel shares one style, and the permanent hint pill is gone (press ? for shortcuts).
- **INP editor**: compact sections and project-file list beside the editor.
- Rainfall, Results, About and Model data headers match the rest of the app.

### Fixed
- Text-size and padding utilities on buttons and fields were overridden by unlayered base CSS.

## [0.5.0] - 2026-11-18

### Added
- **Undo and redo for every edit** (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, header buttons and an edit
  history menu): map moves, the inspector, section tables, options, the INP editor and deletes
  with everything they removed. History is kept per model file and refuses to overwrite a file
  changed outside the app.
- **Right-click menus** on the map. Nodes: long-section to the outfall, from the top of the
  branch or to a picked node; select everything upstream or downstream; draw a link from here.
  Links: long-section along the link or to the outfall, jump to either end. Empty map: add a
  junction, outfall or storage unit there, copy coordinates. Plus properties, zoom, copy ID and
  delete everywhere.
- **Selections**: Shift- or Ctrl-click to add or remove, Shift-drag to box-select, Ctrl+A,
  Ctrl+Shift+A (all of one kind), Ctrl+C to copy IDs, Esc to clear. Change a field on the whole
  selection (set, add or multiply) or delete it, each as one undo step. Shift-click selects a
  range of rows in Model data.
- **Long-section viewer, redone**: search the start and end nodes, end at the outfall in one
  click, route through via nodes (Shift-click while picking), swap ends. Draws ground, manholes,
  pipes, water now, the highest level over the run, surcharge and flooding, in the model's units
  and in light or dark. A crosshair reads ground, invert, cover, water level, depth and flow at
  any chainage; a table lists every node and pipe; export CSV or PNG.

### Fixed
- **3D view**: pipes and manholes were drawn at their absolute elevation times up to 40, so
  networks floated far above the map or vanished, and feet were treated as metres. Manhole rims
  now sit on the map with pipes at their real depth below, sized to stay visible at any zoom,
  with a Depth control, lit shapes, every link type, and colours for water, surcharge and
  flooding.
- Undo on the map often did nothing.

### Changed
- The browser viewer's example is now the Bellinge network (Odense, Denmark) with results from
  a full 24-hour EPA SWMM 5 run, made when the website is published.

## [0.4.0] - 2026-11-18

### Added
- **Browser viewer** at [saturday-swmm.com/viewer](https://saturday-swmm.com/viewer/). Open an
  `.inp` with the `.rpt` and `.out` from any EPA SWMM 5, PCSWMM, OpenSWMM or Saturday-SWMM run:
  the map with peak colours and playback, properties, report tables, charts, long-sections,
  every section of the model, Check model, run comparison and CSV/GeoJSON export. Files are
  read in the browser and never uploaded. Running and editing stay in the desktop app.
- The coordinate-system search works offline from a bundled EPSG list.

### Fixed
- Results colours now switch on reliably after a run, even when the results take a moment to load.
- Find by ID labels outfalls as outfalls rather than by their outfall type.

## [0.3.0] - 2026-11-18

### Added
- **Scenarios.** Make a child scenario from Base (or from another scenario) from the header menu.
  Each scenario is a complete, standard SWMM `.inp` in `scenarios/<name>/`, so it opens in any
  SWMM tool. See what it changed from its parent, and pull in later parent edits without losing
  your own; clashes are listed and your version is kept.
- **Updates in the app.** About → Updates checks Saturday-SWMM, OpenSWMM, PySWMM and the EPA SWMM
  toolkit. Install an engine update in one click, undo it if a model behaves differently, and
  download the next portable release and restart into it.
- **Model data.** Every SWMM section as an editable table: curves, time series, patterns,
  inflows, dry-weather flow, controls, LID, water quality and more. Paste from Excel, add and
  delete rows, set a column on many rows at once.
- **All simulation options**, grouped like EPA SWMM (Settings).
- **Check model.** Finds duplicate IDs, missing nodes and cross-sections, disconnected nodes,
  uphill pipes and networks with no outfall. Runs before every Run and only stops you for errors;
  each item jumps to the map.
- **Run summary and report tables.** Continuity, flooding and surcharge at a glance after a run;
  sortable report tables whose IDs select the object on the map.
- **Compare runs.** Every completed run is saved per engine and scenario. Compare two for the
  change in flooding, depth and flow, overlay hydrographs with observed data from a CSV, and
  export CSV or GeoJSON.
- **Find by ID** on the map (Ctrl+F), dropdowns and units in the inspector, light theme,
  keyboard shortcuts (press ?), and a short getting-started checklist.
- Welcome page with recent projects and example models; models without a coordinate system open
  on the plain grid and ask for one.

### Changed
- The launcher opens your browser by itself once the app is ready (with a fallback for
  locked-down Windows setups).
- Map keyboard shortcuts no longer act while another page is showing.

### Fixed
- Results no longer error while a run is still writing its output file.

### Removed
- The hybrid EPA SWMM + Basilisk 2D engine and its bundled solver. Use OpenSWMM 6 for 2D
  overland flow. Projects that were set to the hybrid engine run with OpenSWMM 6.

## [0.2.0] - 2026-11-18

### Added
- **EPA SWMM 5 engine (PySWMM).** Run any model with the reference EPA SWMM 5.2 engine alongside
  OpenSWMM 6. Pick the engine in Settings; progress, cancel, live map colouring and all result
  views work the same for both.
- **Portable Windows release.** Unzip and double-click `Saturday-SWMM.cmd` — no Python, Node or
  installer needed. The app runs on this computer and opens in your browser on one local port.
- **Version & updates.** Version shown in About; the app tells you when a newer release is out.
  Quit button in the portable build.
- The Projects page lists the example projects that come with your copy of the app (sample
  model, Bellinge 1D and 2D); the portable download includes them.
- Hybrid EPA SWMM + Basilisk 2D engine, DEM flow accumulation, 3D network view (from 0.1.x work).

### Fixed
- Deleting a node, link or subcatchment now also removes it from every section that refers to it
  (inflows, dry-weather flow, RDII, losses, tags, coverages, loadings, LID usage, groundwater …),
  so the model still runs afterwards. Deleting a node that subcatchments drain to is blocked with
  an explanation; upstream subcatchments are re-routed when a subcatchment is deleted.
- Editing a field keeps the line's spacing and any `;` comment, and values in quotes
  (file paths with spaces) are read correctly.
- Model files are saved atomically — a crash mid-save can no longer leave a truncated `.inp`.
- The model can't be edited, and the project can't be switched, while a simulation is running;
  two quick clicks on Run can't start two simulations.
- The INP editor no longer needs an internet connection (Monaco is bundled).

### Security
- The local server only answers to `localhost` / `127.0.0.1` and requires an app header on every
  change, so other websites can't drive it from your browser.

## [0.1.0] - 2026-08-07

- First local OpenSWMM web app: map editing, runs, results, profiles, 2D mesh results, GIS
  background layers, storms.
