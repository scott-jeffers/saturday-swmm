# Bellinge 2D example — attribution

The 1D SWMM network in this example is derived from **The Bellinge data set: open data and models for community-wide urban drainage systems research** by Agnethe Nedergaard Pedersen et al. (2021).

- Article (ESSD): https://doi.org/10.5194/essd-13-2879-2021  
- Dataset (DTU Data): https://doi.org/10.11583/DTU.c.5029124  
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

The compiled dataset is copyright the authors (Technical University of Denmark and VCS Denmark collaborators). Physical infrastructure and SCADA data belong to VCS Denmark; meteorological and geographic inputs were sourced from DMI and the Danish Agency for Data Supply and Efficiency.

## Changes in this repository

This folder is a **modified** derivative for Saturday-SWMM / OpenSWMM 2D workflows. Changes relative to the published Bellinge release may include (non-exhaustive):

- Edits to the `.inp` for 2D coupling and local tooling
- Added 2D mesh (`.2dm`), 2D results (`.2d.h5`), and project metadata
- Added or substituted rainfall / design-storm inputs
- Added DEM / GIS layers not from the original Bellinge package (for example SRTM-derived elevation); those layers remain under their own source terms where applicable
