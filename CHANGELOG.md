# Changelog

All notable changes to Saturday-SWMM. Versions follow [Semantic Versioning](https://semver.org/);
the version lives in `VERSION` (see `docs/RELEASING.md`).

## [Unreleased]

## [0.34.0] - 2026-11-22

Split view: work on the map, the long section and the graphs at the same time, the everyday layout in InfoWorks ICM and PCSWMM.

- **Two new buttons beside the Map / Profile / Graphs / Curves tabs**: put the view you pick beside the map or below it, instead of over it. Click the button again for one view at a time.
- **The pane follows the map:**
  - Select a node or pipe and the profile runs from there to the outfall.
  - On Graphs, the selection is graphed, with the comparison run if one is set.
  - "Pick on map" works without leaving the profile.
- **Drag the pane's edge to resize it.** The size is remembered for each layout. By default the pane takes a fair share of the space, so the map never disappears.
- **The time bar under the map drives the pane too.** In a narrow pane, the Graphs element list sits above the graphs.
- The map now redraws whenever its space changes (a pane opening, the sidebar collapsing), not only when the window is resized.

## [0.33.0] - 2026-11-22

Interface fixes from the review, so the app reads as consistently as it works.

- **One name for each thing**, in the app and the browser viewer alike: Projects, Rainfall, Check model, and INP text (it's an editor now, not a viewer).
- **The engine shown is the one that produced the results.** The viewer's Overview no longer says OpenSWMM 6 for EPA SWMM 5.2 results.
- **Flood volumes say how precise they are.** SWMM's report gives them to the nearest 1,000 gal (or L):
  - Small volumes show as approximate (≈4,000 gal).
  - A flooded node reported as 0 shows as "< 500 gal".
  - The run summary shows flooded nodes and flood volume as two separate numbers.
- **Unknown addresses go to the Overview** (or the start page), not a blank page.
- **Radio has moved out of the sidebar.** Turn it back on in Settings → Appearance, or play it from search (Ctrl K).
- **The viewer's start page says it edits and runs models.**
- **One Undo**, in the header; the copy in the map toolbar is gone.
- **Results opened from files no longer cover the map with the run summary.** It still opens after a run.

## [0.32.0] - 2026-11-22

The browser viewer can now edit models, not only view them. It runs the desktop app's own Python code in the browser tab (Pyodide), so edits behave exactly as they do in the app.

- **Edit online**: on the map (draw, move, delete, reverse, set lengths), in the Elements table, Simulation options, LID controls, Control rules and the INP text.
  - Undo and redo, in the header and on the map, with the same history as the app.
  - Run the edited model with EPA SWMM 5.2 in the browser, as before.
- **How it works**: the first edit starts the editor (about 4 seconds; a note shows while it loads). After that, edits take tens of milliseconds.
  - Python and its packages load from the jsDelivr CDN and are cached by the browser.
  - The model never leaves the browser.
- Model check and its error count now show on the viewer's Overview.
- Still desktop-only: scenarios and the storm grid, NOAA rainfall, 2D flooding and site data.
- For developers:
  - `backend/app/browser.py` serves the editing routes without threads.
  - `scripts/build_browser_backend.py` bundles them into `frontend/public/pyodide/`.
  - A test fails if the bundle is older than the backend.

## [0.31.0] - 2026-11-22

Scenarios and storms are now separate, the way InfoWorks ICM, TUFLOW and HEC-RAS work. This replaces the mix of scenarios, run history and batch storm runs that rewrote the model.

- **Storms**: a project library of rainfall. On the Rainfall page, "Add to storms" saves the design storm on screen, or one per NOAA return period ("Add and run every scenario" does both). The Continuous record tab can add a downloaded rain record too.
  - Running under a storm never edits the model: the run uses a copy in which the rain gages read the storm and the simulation window fits it.
- **Runs** (new page under Analysis): every scenario × storm in a grid, showing flood volume, flooded nodes or surcharge.
  - Run whatever is missing or out of date in the background.
  - Click a cell to see it on the map; "Compare" sets it as the comparison.
- **Header breadcrumb** says what you're looking at, and each part switches it:
  - App: Project ▾ / Scenario ▾ / Storm ▾. The Project menu has recent projects, examples and Open.
  - Viewer: Model ▾ / Results ▾, with examples and the model library.
- The sidebar's Open and Scenarios dropdowns are gone; Projects / Open files is a plain link again.
- The Drexel example comes with 10- and 100-year storms ready to run.

## [0.30.0] - 2026-11-22

- **Open** in the sidebar is now a dropdown: files and examples and the model library in the viewer; projects and your recent projects (one click to reopen) in the app. It folds away once a model is open.
- **Scenarios** sits right below it: the model's scenarios as a tree in the app, or the result sets you've opened in the viewer, each marked when it has results.
  - Click one to work in it.
  - The ⇄ toggle on a row picks what the map, graphs and profile compare against.
  - Rename, start a new scenario from any of them, or delete; "Compare & details" opens the full comparison.
  - With the sidebar collapsed, Open and Scenarios open as flyouts.
- **GIS** has its own button on the map toolbar, opening a docked panel:
  - Background layers (files, web services, DEMs).
  - In the app, the US site data (USGS elevation, NLCD impervious cover, SSURGO soils), which replaces the Site data page. Click a subcatchment in its tables to select it on the map.

## [0.29.0] - 2026-11-22

- **Drexel University campus example (with and without LID).** 97 Drexel-owned parcels in University City, Philadelphia, are the subcatchments. Their impervious cover comes from the city's building footprints, and slopes from USGS 1 m lidar. The storm sewer under the streets is assumed: sized for a 5-year peak, routed to the lowest point. The storm is NOAA Atlas 14's 2-year, 24-hour (3.26 in).
  - With LID: green roofs, permeable pavement on parking lots and bioretention. Runoff falls from 2.8 to 1.5 in, and surcharged manholes from 62 to 17.
  - Opens ready to compare, with parcels, building footprints and PWD inlets as GIS layers. In the app it's under examples; in the viewer it's "Drexel campus LID example".
- **GIS layers, in the app and now the browser viewer** (Layers → GIS layers → Add):
  - Files: shapefile, GeoPackage, GeoJSON, KML/KMZ, FlatGeobuf, GML and GeoTIFF DEMs in the app; GeoJSON, zipped shapefiles and KML/KMZ in the viewer.
  - Web layers: XYZ tiles, WMS, and ArcGIS map, image and feature services, with a few ready-made imagery and topo options.
  - Per layer: colour, opacity, fill, line width, point size and labels; move layers up and down; click a feature to see its attributes.
  - Point layers are now drawn, and a .shp brings its .dbf/.prj with it.

## [0.28.0] - 2026-11-21

- **Climate change (SWMM-CAT)** on the Rainfall page (app) and the Rain gages page (viewer). Pick a location, and for the nearest of 2,667 US climate stations see monthly temperature, rainfall and evaporation changes for 2035 or 2060 under hot/dry, central and warm/wet scenarios, plus 24-hour design storm changes for stormy and less stormy futures.
  - In the app, write the changes to the model's [ADJUSTMENTS] section (other adjustment rows are kept), or use a design storm change as the design storm's climate uplift.
  - In the viewer, download the model as an .inp with the adjustments added.
  - Data from EPA's SWMM-CAT 1.1 (CREAT 3.1, CMIP5) via SWMM-CAT Online; only about 70 KB downloads per lookup.
- The Rainfall page no longer places its location pin using a guessed coordinate system; it asks you to place it.

## [0.27.1] - 2026-11-21

- The "None" map background now follows the theme: light in light mode, dark in dark mode, and it switches as soon as you change themes. The Layers swatch matches.
- Fixed pipes and junctions sometimes opening with first-time-step colours (e.g. the LID example) while the time bar showed a later step.

## [0.27.0] - 2026-11-21

### Fixed
- 3D pipes now line up with the map. They were mirrored north–south around the network's centre, so a pipe heading north-east was drawn heading south-east. This affected every model in 3D. In 3D pipe view each pipe also keeps a thin dashed trace on the ground with its manholes, the shafts drop from there to the pipe, 3D buildings fade right back, and pipes hang a little less deep so they stay close under their streets.
- The run summary no longer covers the Layers panel.

### Added
- Graphs → System: the whole model over time: rainfall, runoff, losses, lateral and other inflows, flooding, outfall outflow, stored volume, snow and temperature. Values with the same units share a graph, so runoff, outfall outflow and flooding read as one water balance. They compare with another scenario like every other graph.
- Graphs → LID units: each LID unit's own time series (inflow, evaporation, infiltration, percolation, exfiltration, surface runoff, drain outflow, surface, pavement and storage levels, soil moisture), with zoom, Values, CSV and comparison. Runs now write an LID report for every unit, in a run copy of the model (in the app, the browser and EPA SWMM 5.2), so nothing in your .inp changes. Report files your model names itself are read where it puts them, and the viewer accepts dropped LID report files.
- The LID sample ships with its LID reports, in the app and the viewer.

### Changed
- The compare control is one compact row: ⇄ [— With LID] [╌ No LID] [Change] ▾. On the map those choices pick what the map is coloured by; on Graphs and Profile they're the line key. Comparing with something else, swapping and stopping are in the ▾ menu.

## [0.26.0] - 2026-11-21

### Changed
- saturday-swmm.com on phones: the animated storm profile is laid out for a narrow screen. You see all six manholes and the whole storm at once, with readable labels, instead of a wide drawing you scroll sideways. It re-lays itself out when the phone is turned.
- Viewer (and app) on phones:
  - Navigation moves into a slide-in menu behind a ☰ button, and the header is slimmer, so nothing overlaps.
  - The map gets the screen: the run summary and the legend start folded (one tap to open), and the getting-started card and mouse hints stay out of the way. On touch screens the hint says to pinch to zoom and tap an element.
  - Tapping an element opens its properties in a bottom sheet over the map.
  - The view tabs and the map tool bar scroll sideways instead of spilling off the screen, and Layers opens as a full-width panel.
  - Graphs and Curves stack the element list above the charts.
  - The coordinate-system panel opens full screen.

## [0.25.2] - 2026-11-21

### Fixed
- 3D pipe view: the pipes no longer look like they float over the ground. They're drawn under the subcatchment fills, which become more see-through in 3D, so pipes read as below ground. Manhole shafts are easier to see.

## [0.25.1] - 2026-11-21

### Changed
- Map: the Contents panel is gone. Measure and Layers are now buttons in the map's tab bar, next to Inspector. They used to float over the map.
- What only Contents had moved into Layers: background GIS layers (DEM and shapefile import, app only), the floodplain toggle, and 2D mesh boundaries (in the 2D surface row). The "Types / Results" colour switch was a duplicate of the Edit / Results tabs and is removed, along with the 2D meshing hint panel; meshing is in Settings.
- The run summary sits back in the map's top corner.

## [0.25.0] - 2026-11-21

### Added
- LID sample with two scenarios: "With LID" (the base model) and "No LID (fully impervious)". The second removes every LID and makes every subcatchment 100 % impervious. Both come with results, in the app and in the viewer, so the example opens ready to compare. Rebuild them with `scripts/build_lid_scenarios.py`.
- Compare with another scenario from anywhere in the map workspace. A Compare control sits next to the Map / Profile / Graphs / Curves tabs; with one other scenario it's a single click ("Compare with No LID…"). One choice drives every view:
  - **Graphs:** each series gets a dashed line from the other scenario in the same colour. The legend names both, and Values and CSV export include both.
  - **Profile:** the other scenario's water level (solid violet) and highest level (dotted) along the same path, in the hover readout and the legend.
  - **Map:** show this scenario, the other one (on the same colour scale), or the Change between them: blue where this scenario is lower, red where it is higher, with its own legend. Choosing Change shows the peaks.
  - **Swap (⇄)** makes the other scenario current and compares with the one you left. Picking a comparison switches the map from Edit to Results.
- In the viewer, each result set you add (.rpt/.out) can be compared the same way.
- API: `/api/runs/targets`, and envelope, snapshot and periods for any run, plus `scen-<id>` for a scenario's latest results wherever a run id is accepted.

### Fixed
- The map turns its results colours back on after the results reload, for example after switching scenario. Before, it stayed in Results mode with plain colours.
- The header shows a renamed Base scenario's own name.

## [0.24.0] - 2026-11-21

### Added
- Control rules page (Model → Control rules), in the app and the viewer. Each rule from [CONTROLS] reads as IF / AND / THEN / ELSE, with:
  - element chips coloured like the map; clicking one shows the element on the map;
  - values with units, and times like "has been closed for more than 2 min";
  - priorities shown on the rule;
  - OR conditions grouped under "any of", the way SWMM evaluates them (A AND B OR C means A AND (B OR C)).
- The rule list can be searched by rule or element name and switched to a "Controlled elements" view: each pump, orifice or weir with the rules that move it.
- "Show in Graphs" charts every element a rule watches and moves, when there are results. "Show the SWMM text" shows the rule as written.
- In the app, edit a rule's SWMM text with a live preview and plain-language checks: unknown elements, a missing THEN, wrong keywords, duplicate names. Add a rule from a template or delete one. Saving changes only that rule; every other line of the section stays as written.
- Map panel: a pump, gate or other link shows the rules that control it, and a node shows the rules that watch it, linked to the rule.

## [0.23.0] - 2026-11-21

### Added
- Right-click an element in the Graphs list or the Elements table: zoom to it on the map, copy its ID, and from Elements, show it in Graphs (when there are results).
- Map: a "Zoom to model extent" button under N and 2D, the Home key, and "Zoom to model extent" on the map's right-click menu.

### Fixed
- Zooming to an element from another page (Elements, report tables, model check) now moves the map there. Before, it selected the element but the map went back to where it was.
- After a zoom request from another page, the map switches back from Graphs or Profile to the map view.

## [0.22.1] - 2026-11-21

### Fixed
- Viewer and app: a tab left open while the site was updated no longer goes blank when you open a page such as Report. It reloads once to pick up the new version, and your open model stays loaded.
- A page that hits an error now shows the error with a Reload button instead of blanking the whole app. The sidebar keeps working.

## [0.22.0] - 2026-11-21

### Added
- Viewer: a Rain gages page. Each gage shows its format, interval and source, a hyetograph (intensity per interval) with cumulative depth, total depth, peak intensity, how long it rained and the subcatchments it feeds (click one to find it on the map). Drag or Ctrl+wheel to zoom; long records are binned so they stay quick.
- Rainfall comes from the model's time series, from a rain file, or from the run's results. When there are both input data and results, a switch picks which one to show.
- Viewer: rain files (.dat, .txt, .rain, .prn, .tsf) can be dropped with the model, added from the Rain gages page, or included in a review .zip. They stay in this browser with the model. Station files are matched to each gage's station.

## [0.21.1] - 2026-11-21

### Fixed
- Model library on the website: the catalog of Bob Dickinson's models now ships with the viewer, so the library loads instead of saying the catalog is not available.
- 3D buildings no longer have subcatchments and pipes painted over them; they stand above the flat map layers and are more see-through in 3D pipe view so pipes stay visible.
- The run summary card sits below the Measure and Layers buttons instead of covering them.

### Added
- Profile pick: after you click the start junction it gets an amber ring (via points too) until you pick the end.

## [0.21.0] - 2026-11-21

## Model library in the browser viewer
- A new **Model library** page in the viewer: search Bob Dickinson's library of about 4,500 public-domain EPA SWMM5 models on GitHub (SWMMBobSWMM6/1729-SWMM5-Models-2030) and open any of them in one click.
- **Search** by name, title, folder or feature. Every word must match, in any order.
- **Filter** by topic folder, features (LID, water quality, control rules, groundwater, pumps, storage, weirs, orifices, outlets), flow units, routing method, network size, last-run status, and "only models with results".
- **Cards** show each model's title, size, units, routing and a run-status dot, with links to its summary and to the file on GitHub.
- **Nothing ships with the site.** The website build makes a small catalog (about 90 KB compressed) from the models' summaries, refreshed weekly. Opening a model fetches its `.inp`, `.rpt` and `.out` straight from GitHub. Results over 120 MB are left on GitHub, and the model opens with its report only.
- **Add any GitHub library:** paste `owner/repo` or a github.com link. Its `.inp` files are listed live through GitHub's public API, and the viewer remembers it.

## Fix
- The viewer's header no longer shows a placeholder coordinate system (EPSG:25832) for models that don't have one. It says "No coordinate system".

## [0.20.4] - 2026-11-21

## Radio is back
- A **Radio** button in the sidebar footer, between Dark theme and SWMM manual, in both the app and the browser viewer. It opens the station picker and mute control in the header, with or without a model open. The Simulation options setting is gone.
- The built-in Forecast track now plays on the website too.

## [0.20.3] - 2026-11-20

## Fix: the network drew late on fast connections
- After opening a model, the map now draws the network as soon as the map style is ready. Before, it waited until every background tile had downloaded, which on a large or high-resolution screen could take 10 to 15 seconds. This came in with 0.17.1.

## [0.20.2] - 2026-11-20

## LID sample follows the real street grid
- Manholes now sit on the actual Market Street and 20th Street intersections, and each subcatchment is drawn from its four corner intersections. Philadelphia's grid is rotated about 9 degrees, which the first version did not follow.
- Areas, widths and pipe lengths are recalculated from the new layout. The model still runs cleanly in EPA SWMM 5.2.

## [0.20.1] - 2026-11-20

## LID sample lines up with the city
- The LID sample now sits on real Center City Philadelphia streets. The main sewer runs under Market Street from 22nd to 17th, a branch comes down 20th Street from Arch, and each subcatchment is a real city block.
- Subcatchment areas, widths and pipe lengths are recalculated from the new layout. The model still runs cleanly in EPA SWMM 5.2.

## [0.20.0] - 2026-11-20

## 2D surface flow animation
- With 2D results showing, the **Flow** button also animates the surface: tracers start on wet cells, drift with each cell's simulated velocity and leave short fading trails. Faster water is brighter and moves faster on screen. It's a time-lapse, not to scale, so slow ponds still visibly drift.
- Works in the app and in the browser viewer. The Bellinge 2D example now includes velocities (about 14 MB in all).

## Layers: 2D surface
- The Layers panel has a **2D surface** row when the model has a mesh: show or hide, opacity, mesh outline and flood depth.

## LID sample model
- A new **LID sample** example: the small Philadelphia sewer with seven kinds of green infrastructure across its five subcatchments.
  - Rain garden and rain barrels (S1)
  - Permeable pavement (S2)
  - Green roof and bio-retention cell (S3)
  - Infiltration trench (S4)
  - Vegetative swale (S5)
- It runs cleanly in EPA SWMM 5.2. It's in the app's example list and is a third example on the viewer home page.

## [0.19.1] - 2026-11-20

## Fix
- The viewer home page now shows both Bellinge examples even when a model is open. Opening one replaces the open model.

## [0.19.0] - 2026-11-20

## Browser viewer: Bellinge 2D flood example
- A second example on the viewer home page: the Bellinge network with a 156,000-cell 2D street surface and flood depths from an OpenSWMM 6 run of the storm of 29 June 2012 (rain gauges rg5425 and rg5427, 03:00–21:00). About 12 MB to download.
- The viewer can now show 2D meshes and flood depths, with playback, peak depths and depth over time for a cell. They come from a compact `.ss2d.gz` package made by `scripts/build_viewer_2d_example.py`.
- Based on the `bellinge_2d` example of HydroCouple's OpenSWMM GUI, with one fix. Its rain-gauge lines end in `* 30`, which isn't SWMM 5.2 syntax, and with it OpenSWMM read about 30 times too much rain (616 mm instead of 20.6 mm). The standard form is used here.

## Navigation
- **Simulation options** has its own item in the sidebar. The viewer shows it too, as a read-only summary.
- **Model data** and the **INP editor** are now one page, the **INP viewer**, with *Sections* and *Text* views that share the same section list. Old links to the editor still work.
- A **SWMM manual** link (the searchable online EPA manuals). There are also links from the INP viewer (input format), the LID page, Simulation options and run errors.

## Inputs you could not see before
- Node panel: a new **Inflows** tab with dry-weather flow (average, peak hour, patterns and a daily profile), external inflows and RDII.
- Subcatchment panel: a new **LID** tab listing the LID controls placed there.
- Graphs: new **Dry-weather inflow** (a typical weekday per node), **External inflows** and **Patterns** groups next to Time series.

## Graphs: zoom and values
- Drag across a graph to zoom in, use Ctrl/⌘ + scroll to zoom around the pointer or the +/− buttons, and double-click or press Reset to see everything. The y-axis fits what's shown.
- **Values** (off by default): peak, time of peak, minimum, mean and, for flows, volume, for each series over the visible window. They update as you zoom.

## [0.18.1] - 2026-11-20

## Fix: Light and Dark backgrounds
- Light and Dark now use Esri's free Light Gray and Dark Gray canvas maps. CARTO had started stamping "API key required" over its tiles.

## [0.18.0] - 2026-11-20

## Map: Layers button
- A **Layers** button in the top-right corner of the map:
  - **Background:** Streets, Light, Dark, Satellite, None or Custom, chosen from small previews. Your choice is remembered.
  - **Elements:** show or hide each element type. Click a row to set its size, opacity and colour (saved per project; one click resets it).
  - **ID labels:** show element IDs once you're zoomed in. Overlapping labels are dropped.
  - **3D buildings:** OpenStreetMap buildings, extruded by height (via OpenFreeMap). Tilt the map to see them.
- **Measure:** distance or area with a geodesic ruler. Double-click to finish, Esc to clear.
- A **scale bar** in the bottom-left corner, in the model's units.

## Edit: Fill from map
- **Pipe lengths:** measured along each pipe's drawn route, for the selection or all conduits.
- **Rim elevations from DEM:** sets each rim to the ground level under the node and keeps its invert. Applies to the selection or all junctions and storage. Nodes where the ground is below the invert are skipped and listed.
- Both are a single undo step.

## LID controls
- A new **LID controls** page, in both the app and the browser viewer:
  - every design with a drawn cross-section of its layers (surface, pavement, soil, storage, drainage mat, underdrain)
  - labelled parameters with units
  - a "Where it's used" table showing how much of each subcatchment it covers
- In the app you can add a design from any of the eight SWMM types, rename or delete it, add optional layers, and place it in subcatchments. The viewer shows it all read-only.

## [0.17.1] - 2026-11-20

## Fix: flow animation flicker
- The droplets are now drawn on a light overlay that slides them smoothly along each pipe. The old method rebuilt MapLibre's dash pattern about 30 times a second, which flickered.
- Speed now scales smoothly with flow, instead of in three bands.
- The halo under the pipes is a static map layer, so the map style no longer changes from frame to frame.
- Droplets fade out on very wide views, stay still with the system "reduce motion" setting, and hide link types you've turned off.

## [0.17.0] - 2026-11-20

## Flow animation, restyled
- Water now moves as droplets with a soft halo, drawn over each pipe without hiding its results colour.
- Pipes carrying more flow have brighter, wider droplets that move faster (three speed bands, measured against the run's peak).
- Colours adapt to light and dark basemaps.
- Respects the system "reduce motion" setting.
- Fix: turning on Flow while map tiles were still loading sometimes did nothing.

## Graphs
- The tree starts collapsed, with groups in A–Z order.
- Right-click any element on the map → **Show in Graphs** (or **Show N in Graphs** for a multi-selection). The element is ticked, its group opens and the row scrolls into view.
- Ticked items always show in long groups, even past the first 200 rows.

## Colours
- Elements tab icons and Graphs tree groups use the same colours as the map (one shared colour list).

## [0.16.1] - 2026-11-20

- **Curves list uses the whole panel.** It used to stop at a fixed height and scroll even with room to spare; now it scrolls only when the list is longer than the window. The column is a little wider, so long curve names are no longer cut off.
- The website deploy now waits and retries once when GitHub cannot find the build it just uploaded, which failed two releases in a row.

## [0.16.0] - 2026-11-20

- **Graphs tab.** One place for every hydrograph and input time series, replacing the Hydrograph and Time series tabs.
  - The tree on the left lists Junctions, Outfalls, Storage units, Dividers, Conduits, Pumps, Orifices, Weirs, Outlets, Subcatchments and Time series, with a search box and counts per group.
  - Tick as many items as you like. Each element type gets one graph with everything ticked overlaid, a variable picker (flow, depth, velocity, head…) and a CSV download.
  - Time series are drawn without running the model.
  - **Add map selection** ticks what is selected on the map, and each row has a "show on map" button.
- **Empty projects no longer open in the ocean.** A new or empty model used to centre the map on coordinate (0, 0): for UTM 32N, open water off West Africa at street zoom. Dragging seemed to do nothing because every view was the same water. The map now opens over the area the CRS is meant for (UTM 32N: Europe), or the world.
- **Colour in the icons.** Sidebar and tab icons get a colour by kind of work: water and rain in blue, maps and land in green, results in orange, scenarios in violet, reports in rose, code in amber. The drawing tools match the colours their elements have on the map. Both themes are covered.

## [0.15.2] - 2026-11-19

- **Review is a proper side panel.** It docks beside the map and pushes it over, instead of floating on top of the zoom buttons.
- **Tabs fit on one line:** Checks, Find, Color, Cost, with a tooltip on each.
- **Find reads like a sentence:** "Where Length (m) is more than 0" (the comparisons were symbols squeezed so tight that ">" showed as ":"). The count reads "1,015 of 1,044 links match".
- The Color tab's Classes box is no longer clipped, and Review uses the same US spelling ("color") as the rest of the app.

## [0.15.1] - 2026-11-19

- **Long-section is now called Profile**: the tab, its title, the map right-click menu ("Profile to outfall", "Profile from here to…"), tooltips, exported file names (`profile_J1_OF1.csv`), the website and the README.

## [0.15.0] - 2026-11-19

- **Views as tabs along the top**, the way PCSWMM and InfoWorks ICM work: **Map, Long-section, Hydrograph, Time series and Curves**. Each one is full size. The map stays loaded behind the other tabs, so switching back is instant and keeps your zoom and selection.
- **The time bar follows you** onto the Long-section and Hydrograph tabs, so you can play a run from any of them. On the Map tab it is a slim strip under the map.
- **Pick on map** from the Long-section tab switches to the map and comes back once both ends are picked (or you press Escape).
- **Select from anywhere:** clicking a pipe or manhole in the long-section selects it, and the Hydrograph tab shows that element.
- The Long-section and Inputs buttons on the map toolbar are gone; the tabs replace them.

## [0.14.0] - 2026-11-19

Saturday-SWMM is alpha software, and the version numbers now say so. The releases published as 1.0.0 to 1.3.1 are 0.10.0 to 0.13.1; this is 0.14.0.

- **Bottom panel as tabs.** Long-section, Hydrograph, Time series and Curves now share one panel below the map, one at a time, with the time bar above them.
- **Time series viewer.** Plots the model's `[TIMESERIES]` input (rainfall, inflows, tides), with no run needed. Open it with **Inputs** on the map toolbar.
- **Curve viewer.** Plots `[CURVES]` (storage, pump, rating, tidal, …) with axes named for each curve type, in the model's units.
- **Long-section restyled** to match the animation on saturday-swmm.com: hatched soil, a bold ground line, open manhole shafts, water only inside pipes and shafts, a dashed hydraulic grade line, and orange ponding where it floods.
- **No more flicker** when playing a run with the long-section open: the last time step stays drawn while the next one loads.
- **Calmer run summary.** The numbers come first; engine warnings fold into one line you can open.
- **Fewer 2D warnings.** Mesh generation no longer writes `MIN_TIMESTEP`, `REL_TOLERANCE` and `ABS_TOLERANCE`, which OpenSWMM 6 has retired; Simulation settings no longer shows them.
- **Legend minimises** to a small "Legend" button, and stays that way.
- **Fewer version numbers** on screen: engines read "EPA SWMM 5.2" and "OpenSWMM 6 (pre-release)"; full versions stay on About > Updates. The app shows "alpha" next to its version.
- The inspector no longer shows the previous element's values while a new one loads.
- Update checks treat old 1.x installs as 0.10–0.13, so they are still offered this release.
- The website's engine table now shows EPA SWMM 5.2 as the default for 1D models.

## [0.13.1] - 2026-11-19

- **Update everything.** When more than one update is waiting, About > Updates offers one button that updates every engine (OpenSWMM 6, PySWMM, the EPA SWMM 5.2 solver) and then the app. Each engine is checked after installing and rolled back on its own if it won't start, so one bad release never blocks the others. The app goes last and restarts once.
- **No updates during a run.** Updating an engine while a simulation is running is now refused, so a run's results can't be corrupted mid-way.

## [0.13.0] - 2026-11-19

Everything on the review's next-steps list, plus a new logo.

- **Models run in the browser.** The website viewer now runs 1D models with EPA SWMM 5.2.4 compiled to WebAssembly, in a background worker. Nothing is uploaded. Results open in the same map, charts and report views. Build script: `tools/wasm/build-swmm-wasm.sh`.
- **EPA SWMM 5.2 is the default engine for 1D work.** A new "Automatic" setting runs EPA SWMM 5.2.4, the reference engine, unless the model has a 2D mesh, which only OpenSWMM 6 runs. You can still pick an engine by hand. Every result now says which engine made it.
- **Problems first on Results.** Flooded nodes, then pipes that ran full, worst first, each a click from the map. The full report tables follow.
- **One home for simulation options.** Model data points to Simulation settings instead of offering a second options grid.
- **INP editor opens at the section you came from** ("Edit as text" on Model data), and loads big files faster: 36 MB went from 1.6 s to 0.36 s, then 0.08 s.
- **PCSWMM `*` outlets explained correctly.** OpenSWMM 6 does not accept them even with a 2D mesh. The check and the run error now say so and point to EPA SWMM 5.2, which runs these models.
- **New logo and favicon.** A pipe cross-section flowing part full, the same in the browser tab, the app and the website, with PNG and Apple touch icons.
- **Tagline:** "Open, edit and run SWMM models".
- Empty tabs on Elements are dimmer; the OpenSWMM card no longer claims to be the default.

## [0.12.2] - 2026-11-19

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

## [0.12.1] - 2026-11-18

### Fixed
- **Undo and redo are much faster on large models.** Parsed models and the map's network data are now kept by file content. Undoing back to a recent version reuses them instead of re-reading the whole file, and an unchanged network answers instantly. On a 36 MB, 640,000-line model, undo plus map refresh went from about 4.9 s to about 0.45 s.
- Reading models is about 3.5 times faster: lines without quotes skip the slow tokenizer. Edits on large models are faster as a result.
- Edit-history bookkeeping runs off the server's main loop and uses faster compression.
- Quick repeated Ctrl+Z presses queue instead of being dropped. The undo button shows a spinner while it works, and the map refreshes once after a burst.
- **Browser viewer:** "Show on the map" did nothing when you returned to the viewer and your files were restored from an earlier visit.

## [0.12.0] - 2026-11-18

### Changed
- **New map layout**, from a design review of the old side-arrow panels:
  - A **tab bar across the top of the map**: Edit, Results and Review. Each tab shows its own labelled tools (the drawing tools live in Edit), followed by Long-section, 3D and Flow, then **Contents** and **Inspector** on the right. It replaces the floating drawing toolbar and the mode switch.
  - **No more arrow handles.** The inspector opens when you select something and closes when you clear the selection; pin it to keep it open. Layers, basemap and 2D tools open from **Contents**, with a close button.
  - The **bottom panel** appears only when it has something to show: the time bar and charts in Results, or a long-section. It has Taller and close buttons; reopen it from Time bar.
  - **Pop-out windows** for charts and the long-section: drag and resize them over the map, or open them in their own browser window for a second monitor (up to four).

## [0.11.0] - 2026-11-18

### Added
- **Site data** page (US): download data for the model's area and use it in the model.
  - **USGS 3DEP elevation**: the best available DEM (lidar-based 1 m where flown) at 1–30 m, in the model's coordinate system and length unit, added to the map layers.
  - **NLCD 2021 impervious cover** (30 m, lower 48 states): the average per subcatchment next to the model's value, applied to all or chosen subcatchments.
  - **USDA SSURGO soils** from Soil Data Access: map units, hydrologic soil group and surface Ksat, added to the map, and area-weighted into Green-Ampt, Horton or curve-number parameters per subcatchment.
  - Every change to the model is one undo step; downloads are kept in the project's `site-data` folder.
- Rainfall: choose the NOAA Atlas 14 partial-duration or annual-maximum series.

## [0.10.0] - 2026-11-18

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
