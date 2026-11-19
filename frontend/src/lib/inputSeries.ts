/**
 * Read the model's own input data for charts: [TIMESERIES] (rainfall,
 * inflows, tides…) and [CURVES] (storage, pump, rating, …).
 *
 * TIMESERIES rows: Name [Date] Time Value [Time Value …], or Name FILE path.
 * Times are H:MM[:SS] or decimal hours; a date carries over to later rows.
 * CURVES rows: Name [Type] X Y [X Y …]; the type is on a curve's first row.
 */

export type InputSeries = {
  name: string
  /** Hours from the first point (or from 0:00 when no dates are given). */
  hours: number[]
  values: number[]
  /** Calendar dates were given, so `hours` counts from the first one. */
  dated: boolean
  /** External file instead of inline data. */
  file?: string
}

export type InputCurve = { name: string; type: string; x: number[]; y: number[] }

type Row = { values: string[] }

const isDate = (t: string) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(t)

function parseDate(t: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t) // SWMM: MM/DD/YYYY
  if (m) return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  return null
}

/** "1:30" → 1.5, "0:05:30" → 0.0917, "2.25" → 2.25 */
export function parseHours(t: string): number | null {
  if (t.includes(':')) {
    const p = t.split(':').map(Number)
    if (p.some((v) => !Number.isFinite(v))) return null
    return p[0] + (p[1] ?? 0) / 60 + (p[2] ?? 0) / 3600
  }
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

export function parseTimeseries(rows: Row[]): InputSeries[] {
  const byName = new Map<string, InputSeries & { day0: number | null; day: number | null }>()
  const order: string[] = []
  for (const r of rows) {
    const t = r.values.filter((v) => v !== '')
    if (t.length < 2) continue
    const name = t[0]
    let s = byName.get(name)
    if (!s) {
      s = { name, hours: [], values: [], dated: false, day0: null, day: null }
      byName.set(name, s)
      order.push(name)
    }
    if (t[1].toUpperCase() === 'FILE') {
      s.file = t.slice(2).join(' ').replace(/^"|"$/g, '')
      continue
    }
    let i = 1
    while (i < t.length) {
      if (isDate(t[i])) {
        const d = parseDate(t[i])
        if (d != null) {
          s.dated = true
          if (s.day0 == null) s.day0 = d
          s.day = d
        }
        i += 1
        continue
      }
      if (i + 1 >= t.length) break
      const h = parseHours(t[i])
      const v = Number(t[i + 1])
      if (h != null && Number.isFinite(v)) {
        const offset = s.day != null && s.day0 != null ? (s.day - s.day0) / 3_600_000 : 0
        s.hours.push(offset + h)
        s.values.push(v)
      }
      i += 2
    }
  }
  return order.map((n) => {
    const { day0: _a, day: _b, ...rest } = byName.get(n)!
    void _a
    void _b
    if (rest.dated && rest.hours.length) {
      const h0 = rest.hours[0]
      rest.hours = rest.hours.map((h) => h - h0)
    }
    return rest
  })
}

const CURVE_TYPES = new Set([
  'STORAGE', 'DIVERSION', 'TIDAL', 'RATING', 'CONTROL', 'SHAPE', 'WEIR', 'CULVERT',
  'PUMP1', 'PUMP2', 'PUMP3', 'PUMP4', 'PUMP5',
])

export function parseCurves(rows: Row[]): InputCurve[] {
  const byName = new Map<string, InputCurve>()
  const order: string[] = []
  for (const r of rows) {
    const t = r.values.filter((v) => v !== '')
    if (t.length < 2) continue
    const name = t[0]
    let c = byName.get(name)
    if (!c) {
      c = { name, type: '', x: [], y: [] }
      byName.set(name, c)
      order.push(name)
    }
    let i = 1
    if (CURVE_TYPES.has(t[1].toUpperCase())) {
      c.type = t[1].toUpperCase()
      i = 2
    }
    for (; i + 1 < t.length; i += 2) {
      const x = Number(t[i])
      const y = Number(t[i + 1])
      if (Number.isFinite(x) && Number.isFinite(y)) {
        c.x.push(x)
        c.y.push(y)
      }
    }
  }
  return order.map((n) => byName.get(n)!)
}

/** Axis names per SWMM curve type, in the model's units. */
export function curveAxes(type: string, len: string, flow: string): { x: string; y: string; label: string } {
  const area = len === 'ft' ? 'ft²' : 'm²'
  switch (type) {
    case 'STORAGE':
      return { x: `Depth (${len})`, y: `Area (${area})`, label: 'Storage' }
    case 'TIDAL':
      return { x: 'Hour of day', y: `Stage (${len})`, label: 'Tidal' }
    case 'RATING':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Rating' }
    case 'DIVERSION':
      return { x: `Inflow (${flow})`, y: `Diverted flow (${flow})`, label: 'Diversion' }
    case 'CONTROL':
      return { x: 'Controller value', y: 'Setting', label: 'Control' }
    case 'SHAPE':
      return { x: 'Depth / full depth', y: 'Width / full depth', label: 'Shape' }
    case 'WEIR':
      return { x: `Head (${len})`, y: 'Coefficient', label: 'Weir' }
    case 'CULVERT':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Culvert' }
    case 'PUMP1':
      return { x: `Wet-well volume (${len === 'ft' ? 'ft³' : 'm³'})`, y: `Flow (${flow})`, label: 'Pump type 1' }
    case 'PUMP2':
      return { x: `Inlet depth (${len})`, y: `Flow (${flow})`, label: 'Pump type 2' }
    case 'PUMP3':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Pump type 3' }
    case 'PUMP4':
      return { x: `Inlet depth (${len})`, y: `Flow (${flow})`, label: 'Pump type 4' }
    case 'PUMP5':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Pump type 5' }
    default:
      return { x: 'X', y: 'Y', label: type || 'Curve' }
  }
}
