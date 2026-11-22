"""The .inp a new model starts from (frontend/src/lib/blankInp.ts mirrors it
for the browser viewer; a frontend test keeps the two identical)."""

from datetime import date, datetime, timedelta

FLOW_UNITS = ("CFS", "GPM", "MGD", "CMS", "LPS", "MLD")
INFILTRATION = ("HORTON", "MODIFIED_HORTON", "GREEN_AMPT", "MODIFIED_GREEN_AMPT", "CURVE_NUMBER")
ROUTING = ("DYNWAVE", "KINWAVE", "STEADY")

BLANK_INP_TEMPLATE = """[TITLE]
{title}

[OPTIONS]
FLOW_UNITS           {flow_units}
INFILTRATION         {infiltration}
FLOW_ROUTING         {routing}
START_DATE           {start_date}
START_TIME           00:00:00
REPORT_START_DATE    {start_date}
REPORT_START_TIME    00:00:00
END_DATE             {end_date}
END_TIME             00:00:00
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


def render_blank_inp(
    title: str,
    flow_units: str = "CFS",
    infiltration: str = "HORTON",
    routing: str = "DYNWAVE",
    start_date: str | None = None,
) -> str:
    """A new model's .inp. ``start_date`` is ISO (2024-06-01); the run is one day long."""
    fu = flow_units.upper() if flow_units.upper() in FLOW_UNITS else "CFS"
    inf = infiltration.upper() if infiltration.upper() in INFILTRATION else "HORTON"
    rt = routing.upper() if routing.upper() in ROUTING else "DYNWAVE"
    try:
        d0 = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else date(2024, 1, 1)
    except ValueError:
        d0 = date(2024, 1, 1)
    d1 = d0 + timedelta(days=1)
    return BLANK_INP_TEMPLATE.format(
        title=title, flow_units=fu, infiltration=inf, routing=rt,
        start_date=d0.strftime("%m/%d/%Y"), end_date=d1.strftime("%m/%d/%Y"),
    )
