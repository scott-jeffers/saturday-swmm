/**
 * The .inp a new model starts from, for the browser viewer. Mirrors
 * backend/app/services/blank_inp.py (blankInp.test.ts keeps them identical).
 */
export const FLOW_UNITS = { us: ['CFS', 'GPM', 'MGD'], si: ['CMS', 'LPS', 'MLD'] } as const
export const INFILTRATION = [
  ['HORTON', 'Horton'],
  ['MODIFIED_HORTON', 'Modified Horton'],
  ['GREEN_AMPT', 'Green-Ampt'],
  ['MODIFIED_GREEN_AMPT', 'Modified Green-Ampt'],
  ['CURVE_NUMBER', 'Curve Number (SCS)'],
] as const
export const ROUTING = [
  ['DYNWAVE', 'Dynamic wave: backwater, surcharge, pressure flow'],
  ['KINWAVE', 'Kinematic wave: faster, no backwater'],
  ['STEADY', 'Steady flow: instant translation'],
] as const

export type BlankInpOptions = { title: string; flowUnits?: string; infiltration?: string; routing?: string; startDate?: string }

const mdY = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`

export function renderBlankInp(o: BlankInpOptions): string {
  const all = [...FLOW_UNITS.us, ...FLOW_UNITS.si] as string[]
  const flow_units = all.includes((o.flowUnits ?? '').toUpperCase()) ? o.flowUnits!.toUpperCase() : 'CFS'
  const infiltration = INFILTRATION.some(([k]) => k === (o.infiltration ?? '').toUpperCase()) ? o.infiltration!.toUpperCase() : 'HORTON'
  const routing = ROUTING.some(([k]) => k === (o.routing ?? '').toUpperCase()) ? o.routing!.toUpperCase() : 'DYNWAVE'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.startDate ?? '')
  const d0 = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date(Date.UTC(2024, 0, 1))
  const d1 = new Date(d0.getTime() + 86400000)
  const start_date = mdY(d0)
  const end_date = mdY(d1)
  const title = o.title
  return `[TITLE]
${title}

[OPTIONS]
FLOW_UNITS           ${flow_units}
INFILTRATION         ${infiltration}
FLOW_ROUTING         ${routing}
START_DATE           ${start_date}
START_TIME           00:00:00
REPORT_START_DATE    ${start_date}
REPORT_START_TIME    00:00:00
END_DATE             ${end_date}
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
`
}
