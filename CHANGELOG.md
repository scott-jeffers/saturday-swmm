# Changelog

All notable changes to Saturday-SWMM. Versions follow [Semantic Versioning](https://semver.org/);
the version lives in `VERSION` (see `docs/RELEASING.md`).

## [Unreleased]

## [1.2.2] - 2026-11-18

Fixes from a full QA pass: every API action on the sample and the 36 MB West Whiteland model, plus a robot that clicked every control on every page.

- **Undo history is per editing session.** Switching to another project drops the old project's undo stack, so it can never be replayed onto a file opened later from the same path.
- **Rainfall starts at your model.** The NOAA Atlas 14 location now defaults to the centre of the model instead of Washington DC.
- **PCSWMM 1D-2D models explain themselves.** The input check flags subcatchments that drain to `*` (the 2D surface) when there is no 2D mesh, and a failed run shows the engine's own error lines and a hint instead of a Python traceback.
- **Run status stays with its project.** "Run failed" no longer follows you into the next project.
- **Faster map loads on big models.** The network is compressed once and cached: repeat loads on a 9,000-node model went from 0.91 s to 0.065 s.
- **No more 500 from results with no run.** Missing files answer 404 everywhere.
- **Readable volumes and counts.** "8,000 gal" or "1.26 Mgal" instead of "0.008 10^6 gal"; "1 outfall" instead of "1 outfalls".
- **Quieter console.** Review notes and calibration data no longer log a 404 when the file does not exist yet.
- **Scenarios page** leads with a "New scenario" button; the overview names the input check clearly.

## [1.2.1] - 2026-11-18

### Fixed
- **Undo and redo are much faster on large models.** Parsed models and the map's network data are now kept by file content. Undoing back to a recent version reuses them instead of re-reading the whole file, and an unchanged network answers instantly. On a 36 MB, 640,000-line model, undo plus map refresh went from about 4.9 s to about 0.45 s.
- Reading models is about 3.5 times faster: lines without quotes skip the slow tokenizer. Edits on large models are faster as a result.
- Edit-history bookkeeping runs off the server's main loop and uses faster compression.
- Quick repeated Ctrl+Z presses queue instead of being dropped. The undo button shows a spinner while it works, and the map refreshes once after a burst.
- **Browser viewer:** "Show on the map" did nothing when you returned to the viewer and your files were restored from an earlier visit.

## [1.2.0] - 2026-11-18

### Changed
- **New map layout**, from a design review of the old side-arrow panels:
  - A **tab bar across the top of the map**: Edit, Results and Review. Each tab shows its own labelled tools (the drawing tools live in Edit), followed by Long-section, 3D and Flow, then **Contents** and **Inspector** on the right. It replaces the floating drawing toolbar and the mode switch.
  - **No more arrow handles.** The inspector opens when you select something and closes when you clear the selection; pin it to keep it open. Layers, basemap and 2D tools open from **Contents**, with a close button.
  - The **bottom panel** appears only when it has something to show: the time bar and charts in Results, or a long-section. It has Taller and close buttons; reopen it from Time bar.
  - **Pop-out windows** for charts and the long-section: drag and resize them over the map, or open them in their own browser window for a second monitor (up to four).

## [1.1.0] - 2026-11-18

### Added
- **Site data** page (US): download data for the model's area and use it in the model.
  - **USGS 3DEP elevation**: the best available DEM (lidar-based 1 m where flown) at 1–30 m, in the model's coordinate system and length unit, added to the map layers.
  - **NLCD 2021 impervious cover** (30 m, lower 48 states): the average per subcatchment next to the model's value, applied to all or chosen subcatchments.
  - **USDA SSURGO soils** from Soil Data Access: map units, hydrologic soil group and surface Ksat, added to the map, and area-weighted into Green-Ampt, Horton or curve-number parameters per subcatchment.
  - Every change to the model is one undo step; downloads are kept in the project's `site-data` folder.
- Rainfall: choose the NOAA Atlas 14 partial-duration or annual-maximum series.

## [1.0.0] - 2026-11-18

### Added
- **Network tools** on the map's right-click menu: reverse a link's direction, split a conduit in the middle (new junction with interpolated invert and rim), set lengths from the drawn geometry (one link, a selection, or every conduit from Ctrl+K), merge one node into another, and grade junction inverts in a straight line along the current long-section. Each is one undo step.
- **Calibration** (Results → Calibration and sensitivity): paste or load measured flow or depth for any element, see it over the modelled series, and get Nash–Sutcliffe efficiency, peak error, peak timing, volume error, RMSE and bias. Measured data can be saved with the project.
- **Sensitivity runs**: scale Manning's n, % impervious, width or slope across the model by several percentages, run each case, and restore the model; each run is kept and named.
- **Review packages**: Overview → Share for review downloads one .zip with the model, results and coordinate system; drop it on saturday-swmm.com/viewer to open everything at once.
- **Record the map** as a WebM video while the run plays (Record on the time bar).
- **Notes on elements** (inspector Notes tab), saved in the project folder and listed on the Overview and in the report.
- **Pin charts**: right-click an element → Pin its chart in the dock, up to four side by side.
- **Custom background tiles**: any XYZ or WMS tile URL as the basemap.
- **Climate uplift** on design storms and storm sets.
- **Cost estimate** (Review → Cost): pipe cost by size band and per manhole with editable rates, and the map coloured by cost.
- **Rain forecast**: the hourly Open-Meteo forecast for the next 7 days as a rain file (Rainfall → Continuous record → Forecast).
- **Python console**: run scripts against the open model with pyswmm available; edits a script makes are one undo step.
- **Display units**: show report tables, the inspector's results and the report in US or SI units whatever the model uses.
- **Languages**: Danish, Spanish, French and German for the navigation and main controls (Simulation settings → Appearance).
- A design-system reference page (About → For developers).

### Fixed
- Collapsed sidebar items lost their styling and the active marker ran the full height of the sidebar.

## [0.9.0] - 2026-11-18

### Added
- **Overview page**: a home for each model. It shows the one next thing to do (fix errors, run, re-run stale results, review failing checks, or write the report), a network plan coloured by pipe capacity, model counts, the last run, design-check failures, scenarios and snapshots.
- **Report page**: a printable results report (Print, then Save as PDF) with a summary, network plan, design-check table, flooded nodes, the most heavily loaded links, subcatchment runoff and engine messages in plain language.
- **Scenarios page**: the scenario tree, and a comparison of any two scenarios listing every changed element with its before and after rows, plus a plan with added, removed and changed elements highlighted.
- **Run a set of return periods** (Rainfall): pick 2-, 10-, 100-year (any NOAA return period) and the app builds each storm, runs the model and keeps each run, named and pinned, ready for Results → Compare runs.
- Results: one filter bar for every table (element type, ID search, only flooding, surcharge and over-capacity rows) and a Report (PDF) button.

### Fixed
- Minimum cover is no longer flagged at outfalls, which have no manhole above the pipe.

## [0.8.0] - 2026-11-18

### Added
- **Map modes**: Edit (drawing tools), Results (playback and results colours) and Review, switched at the top right of the map. After a run the map moves to Results on its own.
- **Design checks** (Review mode): self-cleansing and maximum velocity, pipe capacity, minimum and adverse slope, minimum cover, flooding and surcharge, each with an editable limit. "Show" selects the failing elements and colours them on the map.
- **Find by property**: build conditions on any model value, derived value (slope, cover, rim elevation) or result (every number in the report) and select the matches on the map.
- **Colour the map by any property or result**, with quantile or equal-interval classes, four colour ramps and a legend.
- **Command palette** (Ctrl+K, or Search in the sidebar): go to any page, run, check, undo, save a snapshot, switch map mode, or jump to an element by ID.
- **Inspector tabs**: Properties, Results (the element's rows from the report) and Connections (upstream and downstream links and nodes, clickable). With nothing selected it shows a model overview and the run summary.

## [0.7.0] - 2026-11-18

### Added
- **Snapshots**: name and save versions of the model from the edit-history menu (the arrow next to undo/redo) and restore any of them; restoring can be undone. A snapshot is taken automatically before every run when the model changed (last 15 kept).
- **Results out of date**: the header turns amber when the model changed after the last run. Hovering the status shows continuity errors, flooding, surcharge and run time.
- **Plain-language engine errors**: SWMM error codes are explained in a sentence with a hint and a Show button that finds the element on the map.
- **Map hover tooltip**: ID, type and the value at the current time step (depth, flow or runoff).
- **"Saved: …" notices with Undo** after every edit, naming what changed.
- Sidebar badge on Results with the number of flooded nodes.
- Header notice when the INP editor has unsaved text; the draft survives visiting other pages.
- INP editor toolbar: Find, Replace, Go to line, and Discard.

### Changed
- Elements: units in column headers, numbers right-aligned, a sticky ID column, sortable columns and red flags on values SWMM would reject (for example negative depth, zero length, unknown from/to node).
- Model data: plain section names with a one-line description; empty sections hidden behind "Show empty sections".
- Rainfall: the hyetograph updates as you change the storm; NOAA depths load when you move the pin.
- Results tables highlight flooding, surcharge and pipes over capacity.
- Simulation settings: routing methods explained, inline checks (end after start, routing step ≤ report step) and an Apply/Discard bar only when something changed.
- Map: the Find box sits above the zoom buttons; the results legend shows units; Getting started folds to a small pill after the first run; time reads "Jun 1, 00:55 +0:55".
- Clear keyboard focus rings everywhere, and friendlier empty states.

## [0.6.1] - 2026-11-18

### Changed
- Simulation settings and Rainfall forms use the shared field style: smaller, consistent inputs
  and readable labels.
- Rainfall: rain files and gages now scroll with the page instead of sitting in a fixed strip
  that cut off the storm parameters; "Save rain file and gage" is the primary action.

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
