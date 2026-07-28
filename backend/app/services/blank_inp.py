BLANK_INP_TEMPLATE = """[TITLE]
{title}

[OPTIONS]
FLOW_UNITS           CFS
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE
START_DATE           01/01/2024
START_TIME           00:00:00
REPORT_START_DATE    01/01/2024
REPORT_START_TIME    00:00:00
END_DATE             01/01/2024
END_TIME             06:00:00
REPORT_STEP          00:05:00
WET_STEP             00:01:00
DRY_STEP             00:05:00
ROUTING_STEP         0:00:30
ALLOW_PONDING        NO

[EVAPORATION]
CONSTANT         0.0
DRY_ONLY         NO

[RAINGAGES]
;;Name           Format    Interval SCF      Source

[SUBCATCHMENTS]
;;Name           Rain Gage        Outlet           Area     %Imperv  Width    %Slope   CurbLen  SnowPack

[SUBAREAS]
;;Subcatchment   N-Imperv   N-Perv     S-Imperv   S-Perv     PctZero    RouteTo    PctRouted

[INFILTRATION]
;;Subcatchment   MaxRate    MinRate    Decay      DryTime    MaxInf

[JUNCTIONS]
;;Name           Elevation  MaxDepth   InitDepth  SurDepth   Aponded

[OUTFALLS]
;;Name           Elevation  Type       Stage Data       Gated    Route To

[STORAGE]
;;Name           Elev.    MaxDepth   InitDepth  Shape      Curve Name/Params            N/A      Fevap    Psi      Ksat     IMD

[CONDUITS]
;;Name           From Node        To Node          Length     Roughness  InOffset   OutOffset  InitFlow   MaxFlow

[PUMPS]
;;Name           From Node        To Node          Pump Curve       Status   Startup  Shutoff

[ORIFICES]
;;Name           From Node        To Node          Type         Offset     Qcoeff     Gated    CloseTime

[WEIRS]
;;Name           From Node        To Node          Type         CrestHt    Qcoeff     Gated    EndCon   EndCoeff

[OUTLETS]
;;Name           From Node        To Node          Offset     Type            QTable/Qcoeff  Qexpon     Gated

[XSECTIONS]
;;Link           Shape        Geom1            Geom2      Geom3      Geom4      Barrels    Culvert

[TIMESERIES]
;;Name           Date       Time       Value

[REPORT]
INPUT      NO
CONTROLS   NO
SUBCATCHMENTS ALL
NODES ALL
LINKS ALL

[MAP]
DIMENSIONS 0 0 1000 1000

[COORDINATES]
;;Node           X-Coord            Y-Coord

[VERTICES]
;;Link           X-Coord            Y-Coord

[Polygons]
;;Subcatchment   X-Coord            Y-Coord

[END]
"""
