# Bellinge 2D flood example (browser viewer)

- **Network and catchment:** The Bellinge data set, Pedersen et al. (2021), https://doi.org/10.11583/DTU.c.5029124, CC BY 4.0. VCS Denmark / DTU.
- **2D mesh, coupling and rain-gauge setup:** the `bellinge_2d` example of OpenSWMM GUI (HydroCouple, https://github.com/HydroCouple/openswmm.gui, `dev` branch).
- **Rainfall:** gauges rg5425 and rg5427 from the Bellinge data set, storm of 29 June 2012.
- **Results:** run with OpenSWMM 6 by Saturday-SWMM for 29 June 2012, 03:00–21:00, with a 15-minute report step. Depths are stored to the nearest millimetre.

These files are a modified derivative: a shorter simulation window, and results packaged for the browser (`.ss2d.gz`, see `frontend/src/viewer/twod.ts`).

**Rain-gauge fix.** The upstream `[RAINGAGES]` lines end in `* 30`, which is not part of the SWMM 5.2 format. With it, OpenSWMM read about 30 times too much rain (616 mm instead of 20.6 mm for 03:00–10:00). Here the lines use the standard form: `rg5425 VOLUME 0:01 1.00 FILE "rg_bellinge_Jun2010_Aug2021.dat" rg5425 MM`.
