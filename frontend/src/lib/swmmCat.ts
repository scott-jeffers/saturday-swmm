/**
 * SWMM-CAT: EPA's climate adjustment tool for SWMM, after SWMM-CAT Online.
 *
 * For the weather station nearest a point it gives monthly changes in
 * temperature, rainfall and evaporation for 2035 and 2060 under three CMIP5
 * scenarios (RCP 8.5, from CREAT 3.1), and 24-hour design storm depths for
 * stormy and less stormy futures. Monthly changes are written to the model's
 * [ADJUSTMENTS] section; design storm changes become a depth uplift.
 *
 * Data: public/swmm-cat (built by scripts/build_swmm_cat.py), loaded on demand.
 */

export const CAT_YEARS = [2035, 2060] as const
export type CatYear = (typeof CAT_YEARS)[number]
export const CAT_SCENARIOS = ['HotDry', 'Central', 'WetWarm'] as const
export type CatScenario = (typeof CAT_SCENARIOS)[number]
export const SCENARIO_LABEL: Record<CatScenario, string> = { HotDry: 'Hot/dry', Central: 'Central', WetWarm: 'Warm/wet' }
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type Index = {
  v: number
  chunk: number
  rp: number[]
  source: string
  /** [id, lat, lon, has evaporation] */
  stations: [string, number, number, 0 | 1][]
}
type Raw = { t: number[]; p: number[]; e: number[] | null; g: number[] }

export type CatStation = { id: string; lat: number; lon: number; distanceKm: number }

export type CatData = {
  station: CatStation
  /** Station used for evaporation (the nearest one that has it), if any. */
  evapStation: CatStation | null
  returnPeriods: number[]
  /** Monthly temperature change, deg F. */
  temperatureF: (y: CatYear, s: CatScenario) => number[]
  /** Monthly rainfall change, percent. */
  rainfallPct: (y: CatYear, s: CatScenario) => number[]
  /** Monthly evaporation change, in/day, or null when no station has it. */
  evaporationIn: (y: CatYear, s: CatScenario) => number[] | null
  /** 24-hour design storm depths (mm) per return period. */
  storm: (y: CatYear) => { rp: number; historicalMm: number; stormyMm: number; lessStormyMm: number }[]
}

const base = () => `${import.meta.env.BASE_URL}swmm-cat/`
let indexP: Promise<Index> | null = null
const chunks = new Map<number, Promise<Raw[]>>()

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not load climate data (${r.status})`)
  return (await r.json()) as T
}

function loadIndex() {
  indexP ??= getJson<Index>(`${base()}index.json`).catch((e) => {
    indexP = null
    throw e
  })
  return indexP
}

function loadChunk(n: number) {
  let p = chunks.get(n)
  if (!p) {
    p = getJson<Raw[]>(`${base()}d/${String(n).padStart(2, '0')}.json`).catch((e) => {
      chunks.delete(n)
      throw e
    })
    chunks.set(n, p)
  }
  return p
}

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Index of the nearest station (optionally only those with evaporation). */
export function nearestStation(stations: Index['stations'], lat: number, lon: number, needEvap = false) {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i]!
    if (needEvap && !s[3]) continue
    const d = distanceKm(lat, lon, s[1], s[2])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best < 0 ? null : { i: best, km: bestD }
}

const at = (arr: number[], y: CatYear, s: CatScenario) => {
  const k = (CAT_YEARS.indexOf(y) * CAT_SCENARIOS.length + CAT_SCENARIOS.indexOf(s)) * 12
  return arr.slice(k, k + 12)
}

export async function loadClimate(lat: number, lon: number): Promise<CatData> {
  const idx = await loadIndex()
  const near = nearestStation(idx.stations, lat, lon)
  if (!near) throw new Error('No climate stations available')
  const s = idx.stations[near.i]!
  const raw = (await loadChunk(Math.floor(near.i / idx.chunk)))[near.i % idx.chunk]!
  const station: CatStation = { id: s[0], lat: s[1], lon: s[2], distanceKm: near.km }
  let evapRaw = raw.e
  let evapStation: CatStation | null = raw.e ? station : null
  if (!raw.e) {
    const ne = nearestStation(idx.stations, lat, lon, true)
    if (ne) {
      const se = idx.stations[ne.i]!
      evapRaw = (await loadChunk(Math.floor(ne.i / idx.chunk)))[ne.i % idx.chunk]!.e
      evapStation = { id: se[0], lat: se[1], lon: se[2], distanceKm: ne.km }
    }
  }
  const n = idx.rp.length
  return {
    station,
    evapStation,
    returnPeriods: idx.rp,
    temperatureF: (y, sc) => at(raw.t, y, sc),
    rainfallPct: (y, sc) => at(raw.p, y, sc),
    evaporationIn: (y, sc) => (evapRaw ? at(evapRaw, y, sc) : null),
    storm: (y) => {
      const k = CAT_YEARS.indexOf(y)
      return idx.rp.map((rp, i) => ({
        rp,
        historicalMm: raw.g[i]!,
        stormyMm: raw.g[n * (1 + 2 * k) + i]!,
        lessStormyMm: raw.g[n * (2 + 2 * k) + i]!,
      }))
    },
  }
}

/** True for US customary flow units (temperatures in deg F, evaporation in in/day). */
export const isUsUnits = (flowUnits: string) => ['CFS', 'GPM', 'MGD'].includes(flowUnits.trim().toUpperCase())

export type AdjustmentKind = 'TEMPERATURE' | 'EVAPORATION' | 'RAINFALL'

/** [ADJUSTMENTS] rows in the model's units, as SWMM reads them. */
export function adjustmentRows(
  data: CatData,
  year: CatYear,
  scenario: CatScenario,
  kinds: AdjustmentKind[],
  us: boolean,
): { kind: AdjustmentKind; values: number[] }[] {
  const rows: { kind: AdjustmentKind; values: number[] }[] = []
  for (const kind of kinds) {
    if (kind === 'TEMPERATURE') {
      // Added to air temperature: deg F for US units, deg C for SI.
      rows.push({ kind, values: data.temperatureF(year, scenario).map((v) => round(us ? v : (v * 5) / 9, 3)) })
    } else if (kind === 'RAINFALL') {
      // Multiplier on rainfall.
      rows.push({ kind, values: data.rainfallPct(year, scenario).map((v) => round(1 + v / 100, 4)) })
    } else {
      // Added to evaporation rate: in/day for US units, mm/day for SI.
      const e = data.evaporationIn(year, scenario)
      if (e) rows.push({ kind, values: e.map((v) => round(us ? v : v * 25.4, us ? 4 : 3)) })
    }
  }
  return rows
}

function round(v: number, dp: number) {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/

/**
 * Replace (or add) the given adjustment rows in an INP's [ADJUSTMENTS]
 * section, keeping its other rows and comments. Adds the section before the
 * map/geometry sections when the model has none.
 */
export function applyAdjustmentsToInp(inp: string, rows: { kind: string; values: number[] }[]): string {
  const nl = inp.includes('\r\n') ? '\r\n' : '\n'
  const lines = inp.split(/\r?\n/)
  const fmt = (r: { kind: string; values: number[] }) =>
    [r.kind.padEnd(12), ...r.values.map((v) => String(v).padEnd(8))].join(' ').trimEnd()
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i]!)
    if (!m) continue
    if (start >= 0) {
      end = i
      break
    }
    if (m[1]!.trim().toUpperCase() === 'ADJUSTMENTS') start = i
  }
  const kinds = new Set(rows.map((r) => r.kind.toUpperCase()))
  if (start >= 0) {
    const body = lines.slice(start + 1, end)
    const kept = body.filter((ln) => {
      const t = ln.trim()
      if (!t || t.startsWith(';')) return true
      return !kinds.has(t.split(/\s+/)[0]!.toUpperCase())
    })
    while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop()
    lines.splice(start + 1, end - start - 1, ...kept, ...rows.map(fmt), '')
    return lines.join(nl)
  }
  let at = lines.length
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION_RE.exec(lines[i]!)
    if (m && ['MAP', 'COORDINATES', 'VERTICES', 'POLYGONS', 'SYMBOLS', 'LABELS', 'BACKDROP'].includes(m[1]!.trim().toUpperCase())) {
      at = i
      break
    }
  }
  const block = ['[ADJUSTMENTS]', ';;Parameter  Monthly adjustments', ...rows.map(fmt), '']
  if (at === lines.length) {
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
    lines.push('', ...block)
  } else lines.splice(at, 0, ...block)
  return lines.join(nl)
}
