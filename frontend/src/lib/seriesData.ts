/**
 * The model's shared data: [TIMESERIES], [CURVES], [PATTERNS], dry-weather flow
 * ([DWF]) and RDII unit hydrographs ([HYDROGRAPHS], [RDII]), as editable objects;
 * what in the model uses each one; renaming one everywhere it is used; and
 * reading time series from files or pasted spreadsheet cells.
 *
 * Values stay as strings while editing so a half-typed number isn't lost.
 */

export type Row = { values: string[]; comment?: string }
export type Sections = Record<string, Row[] | undefined>

const up = (s: string | undefined) => (s ?? '').toUpperCase()
const unq = (v: string | undefined) => (v ?? '').replace(/^"(.*)"$/, '$1')
const toks = (r: Row) => r.values.map(unq).filter((v) => v !== '')

// ---------------------------------------------------------------- time series

export type TsPoint = { date: string; time: string; value: string }
export type TimeSeries = { name: string; file?: string; points: TsPoint[] }

const isDate = (t: string) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(t)

export function parseTimeSeries(rows: Row[]): TimeSeries[] {
  const out = new Map<string, TimeSeries>()
  for (const r of rows) {
    const t = toks(r)
    if (t.length < 2) continue
    const name = t[0]!
    let s = out.get(name)
    if (!s) out.set(name, (s = { name, points: [] }))
    if (up(t[1]) === 'FILE') {
      s.file = t.slice(2).join(' ')
      continue
    }
    let date = ''
    for (let i = 1; i < t.length; ) {
      if (isDate(t[i]!)) {
        date = t[i]!
        i++
        continue
      }
      if (i + 1 >= t.length) break
      s.points.push({ date, time: t[i]!, value: t[i + 1]! })
      date = ''
      i += 2
    }
  }
  return [...out.values()]
}

export function serializeTimeSeries(list: TimeSeries[]): Row[] {
  const rows: Row[] = []
  for (const s of list) {
    if (s.file != null) {
      rows.push({ values: [s.name, 'FILE', `"${s.file.replace(/"/g, '')}"`] })
      continue
    }
    for (const p of s.points) {
      if (p.time.trim() === '' && p.value.trim() === '') continue
      rows.push({ values: p.date.trim() ? [s.name, p.date.trim(), p.time.trim(), p.value.trim()] : [s.name, p.time.trim(), p.value.trim()] })
    }
  }
  return rows
}

/** "1:30" → 1.5; "2.25" → 2.25; "0:05:30" → 0.0917 */
export function hoursOf(t: string): number | null {
  const s = t.trim()
  if (!s) return null
  if (s.includes(':')) {
    const p = s.split(':').map(Number)
    if (p.some((v) => !Number.isFinite(v))) return null
    return p[0]! + (p[1] ?? 0) / 60 + (p[2] ?? 0) / 3600
  }
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

function dayOf(d: string): number | null {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d)
  if (m) return Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!)
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d)
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)
  return null
}

/** Points as hours (from the first date, or from the start) and numbers, for charts. */
export function seriesXY(s: TimeSeries): { x: number[]; y: number[]; dated: boolean; start: number | null } {
  const x: number[] = []
  const y: number[] = []
  let day: number | null = null
  let start: number | null = null
  for (const p of s.points) {
    if (p.date) {
      const d = dayOf(p.date)
      if (d != null) {
        day = d
        if (start == null) start = d
      }
    }
    const h = hoursOf(p.time)
    const v = Number(p.value)
    if (h == null || !Number.isFinite(v) || p.value.trim() === '') continue
    x.push((day != null && start != null ? (day - start) / 3_600_000 : 0) + h)
    y.push(v)
  }
  // Dated points count hours from midnight of the first date, so ticks read as times of day.
  return { x, y, dated: start != null, start }
}

export function seriesStats(s: TimeSeries) {
  const { x, y } = seriesXY(s)
  if (!y.length) return null
  let sum = 0
  for (let i = 1; i < x.length; i++) sum += ((y[i]! + y[i - 1]!) / 2) * (x[i]! - x[i - 1]!)
  return { n: y.length, min: Math.min(...y), max: Math.max(...y), span: x[x.length - 1]! - x[0]!, total: y.reduce((a, b) => a + b, 0), integral: sum, sorted: x.every((v, i) => i === 0 || v >= x[i - 1]!) }
}

// ------------------------------------------------------------------- curves

export const CURVE_TYPES = ['STORAGE', 'SHAPE', 'DIVERSION', 'TIDAL', 'PUMP1', 'PUMP2', 'PUMP3', 'PUMP4', 'PUMP5', 'RATING', 'CONTROL', 'WEIR'] as const
export type CurveType = (typeof CURVE_TYPES)[number] | string
export type Curve = { name: string; type: CurveType; points: [string, string][] }

export function parseCurveList(rows: Row[]): Curve[] {
  const out = new Map<string, Curve>()
  const known = new Set<string>([...CURVE_TYPES, 'CULVERT'])
  for (const r of rows) {
    const t = toks(r)
    if (t.length < 2) continue
    const name = t[0]!
    let c = out.get(name)
    if (!c) out.set(name, (c = { name, type: '', points: [] }))
    let i = 1
    if (known.has(up(t[1]))) {
      c.type = up(t[1])
      i = 2
    }
    for (; i + 1 < t.length; i += 2) c.points.push([t[i]!, t[i + 1]!])
  }
  return [...out.values()]
}

export function serializeCurves(list: Curve[]): Row[] {
  const rows: Row[] = []
  for (const c of list) {
    const pts = c.points.filter(([x, y]) => x.trim() !== '' || y.trim() !== '')
    if (!pts.length) {
      rows.push({ values: [c.name, c.type || 'STORAGE', '0', '0'] })
      continue
    }
    pts.forEach(([x, y], i) => rows.push({ values: i === 0 ? [c.name, c.type || 'STORAGE', x.trim(), y.trim()] : [c.name, '', x.trim(), y.trim()] }))
  }
  return rows
}

/** What a curve's X and Y are, in the model's units, and a one-line explanation. */
export function curveMeaning(type: string, us: boolean, flow: string): { x: string; y: string; label: string; hint: string } {
  const len = us ? 'ft' : 'm'
  const area = us ? 'ft²' : 'm²'
  const vol = us ? 'ft³' : 'm³'
  switch (up(type)) {
    case 'STORAGE':
      return { x: `Depth (${len})`, y: `Surface area (${area})`, label: 'Storage', hint: 'A storage unit’s surface area at each depth.' }
    case 'SHAPE':
      return { x: 'Depth ÷ full depth', y: 'Width ÷ full depth', label: 'Shape', hint: 'A custom closed cross-section, as width against height, both relative to the full depth.' }
    case 'DIVERSION':
      return { x: `Inflow (${flow})`, y: `Diverted flow (${flow})`, label: 'Diversion', hint: 'How much of a flow divider’s inflow goes to its diverted link.' }
    case 'TIDAL':
      return { x: 'Hour of day', y: `Stage (${len})`, label: 'Tidal', hint: 'An outfall’s water level over a day, repeated every day.' }
    case 'PUMP1':
      return { x: `Wet well volume (${vol})`, y: `Flow (${flow})`, label: 'Pump type 1', hint: 'An off-line pump with a wet well: flow steps up with the volume in the well.' }
    case 'PUMP2':
      return { x: `Inlet depth (${len})`, y: `Flow (${flow})`, label: 'Pump type 2', hint: 'An in-line pump: flow steps up with the depth at the inlet node.' }
    case 'PUMP3':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Pump type 3', hint: 'An in-line pump: flow varies smoothly with the head it lifts against.' }
    case 'PUMP4':
      return { x: `Inlet depth (${len})`, y: `Flow (${flow})`, label: 'Pump type 4', hint: 'A variable-speed pump: flow varies smoothly with the inlet depth.' }
    case 'PUMP5':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Pump type 5', hint: 'A variable-speed pump curve at full speed; a speed setting scales it.' }
    case 'RATING':
      return { x: `Head (${len})`, y: `Flow (${flow})`, label: 'Rating', hint: 'An outlet’s flow for the head across it (or the depth at its inlet).' }
    case 'CONTROL':
      return { x: 'Control variable', y: 'Setting', label: 'Control', hint: 'A setting looked up from a value in a control rule (a MODULATED action), or an LID underdrain’s flow for its head.' }
    case 'WEIR':
      return { x: `Head (${len})`, y: 'Discharge coefficient', label: 'Weir', hint: 'A weir’s discharge coefficient as the head over it changes.' }
    default:
      return { x: 'X', y: 'Y', label: type || 'Curve', hint: '' }
  }
}

// ----------------------------------------------------------------- patterns

export const PATTERN_TYPES = ['MONTHLY', 'DAILY', 'HOURLY', 'WEEKEND'] as const
export type PatternType = (typeof PATTERN_TYPES)[number]
export type TimePattern = { name: string; type: PatternType; factors: string[] }

export const PATTERN_SLOTS: Record<PatternType, string[]> = {
  MONTHLY: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  // SWMM's daily patterns start on Sunday.
  DAILY: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  HOURLY: Array.from({ length: 24 }, (_, h) => `${h}`),
  WEEKEND: Array.from({ length: 24 }, (_, h) => `${h}`),
}

export const PATTERN_LABEL: Record<PatternType, string> = { MONTHLY: 'Monthly', DAILY: 'Day of week', HOURLY: 'Hourly', WEEKEND: 'Weekend hourly' }

export function parsePatternList(rows: Row[]): TimePattern[] {
  const out = new Map<string, TimePattern>()
  for (const r of rows) {
    const t = toks(r)
    if (t.length < 2) continue
    const name = t[0]!
    let rest = t.slice(1)
    let p = out.get(name)
    if ((PATTERN_TYPES as readonly string[]).includes(up(rest[0]))) {
      p = { name, type: up(rest[0]) as PatternType, factors: [] }
      out.set(name, p)
      rest = rest.slice(1)
    }
    if (!p) continue
    p.factors.push(...rest)
  }
  for (const p of out.values()) p.factors = fitFactors(p.factors, p.type)
  return [...out.values()]
}

export function fitFactors(f: string[], type: PatternType): string[] {
  const n = PATTERN_SLOTS[type].length
  return Array.from({ length: n }, (_, i) => f[i] ?? '1.0')
}

export function serializePatterns(list: TimePattern[]): Row[] {
  const rows: Row[] = []
  for (const p of list) {
    const f = fitFactors(p.factors, p.type).map((v) => v.trim() || '1.0')
    for (let i = 0; i < f.length; i += 6) rows.push({ values: i === 0 ? [p.name, p.type, ...f.slice(0, 6)] : [p.name, '', ...f.slice(i, i + 6)] })
  }
  return rows
}

export const patternMean = (p: TimePattern) => {
  const v = p.factors.map(Number).filter(Number.isFinite)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

/** Scale the factors so they average exactly 1 (so the average flow stays the average). */
export function normalisePattern(p: TimePattern): TimePattern {
  const m = patternMean(p)
  if (!m) return p
  return { ...p, factors: p.factors.map((v) => trim(Number(v) / m)) }
}

export const trim = (v: number, d = 3) => (Number.isFinite(v) ? Number(v.toFixed(d)).toString() : '')

/**
 * Example shapes to start from. They are typical of residential sewage, not of
 * any one place: replace them with factors from flow monitoring when you have it.
 */
export const PATTERN_PRESETS: { id: string; label: string; type: PatternType; factors: number[] }[] = [
  {
    id: 'res-weekday',
    label: 'Residential weekday (two peaks)',
    type: 'HOURLY',
    factors: [0.65, 0.5, 0.42, 0.38, 0.38, 0.45, 0.75, 1.25, 1.55, 1.45, 1.3, 1.2, 1.15, 1.1, 1.05, 1.0, 1.05, 1.15, 1.3, 1.35, 1.3, 1.15, 0.95, 0.8],
  },
  {
    id: 'res-weekend',
    label: 'Residential weekend (later morning peak)',
    type: 'WEEKEND',
    factors: [0.75, 0.6, 0.5, 0.45, 0.42, 0.42, 0.5, 0.7, 1.0, 1.35, 1.5, 1.45, 1.35, 1.25, 1.15, 1.1, 1.1, 1.15, 1.25, 1.3, 1.25, 1.15, 1.0, 0.85],
  },
  { id: 'commercial', label: 'Commercial (working hours)', type: 'HOURLY', factors: [0.3, 0.25, 0.25, 0.25, 0.25, 0.3, 0.5, 1.0, 1.6, 1.8, 1.8, 1.7, 1.6, 1.7, 1.7, 1.6, 1.4, 1.1, 0.8, 0.6, 0.5, 0.4, 0.35, 0.3] },
  { id: 'flat-daily', label: 'Every day the same', type: 'DAILY', factors: [1, 1, 1, 1, 1, 1, 1] },
  { id: 'flat-monthly', label: 'Every month the same', type: 'MONTHLY', factors: Array(12).fill(1) },
]

export function presetPattern(id: string, name: string): TimePattern {
  const p = PATTERN_PRESETS.find((x) => x.id === id)!
  const mean = p.factors.reduce((a, b) => a + b, 0) / p.factors.length
  return { name, type: p.type, factors: p.factors.map((v) => trim(v / mean)) }
}

// --------------------------------------------------------------------- DWF

export type DwfRow = { node: string; constituent: string; average: string; patterns: string[] }

export function parseDwfRows(rows: Row[]): DwfRow[] {
  return rows
    .map((r) => r.values.map(unq))
    .filter((v) => v.length >= 3 && v[0])
    .map((v) => ({ node: v[0]!, constituent: v[1]!, average: v[2]!, patterns: v.slice(3).filter(Boolean) }))
}

/** Patterns ordered monthly, daily, hourly, weekend (each at most once), then any others. */
export function dwfSlots(d: DwfRow, patterns: TimePattern[]): Partial<Record<PatternType, string>> & { other: string[] } {
  const out: Partial<Record<PatternType, string>> & { other: string[] } = { other: [] }
  for (const n of d.patterns) {
    const p = patterns.find((x) => up(x.name) === up(n))
    if (p && !out[p.type]) out[p.type] = p.name
    else out.other.push(n)
  }
  return out
}

export function serializeDwf(list: DwfRow[]): Row[] {
  return list
    .filter((d) => d.node.trim())
    .map((d) => ({ values: [d.node, d.constituent || 'FLOW', d.average.trim() || '0', ...d.patterns.filter(Boolean).map((p) => `"${p}"`)] }))
}

/**
 * Total dry-weather flow hour by hour over one week (Monday first), for the
 * given month: Σ average × monthly × daily × hourly (weekend hourly on Sat/Sun).
 */
export function dwfWeek(list: DwfRow[], patterns: TimePattern[], month = 0): number[] {
  const week = new Array(168).fill(0) as number[]
  for (const d of list) {
    if (up(d.constituent) !== 'FLOW') continue
    const avg = Number(d.average) || 0
    const s = dwfSlots(d, patterns)
    const f = (t: string | undefined, i: number) => {
      const p = t ? patterns.find((x) => x.name === t) : undefined
      return p ? Number(p.factors[i]) || 0 : 1
    }
    const m = s.MONTHLY ? f(s.MONTHLY, month) : 1
    for (let i = 0; i < 168; i++) {
      const dow = (Math.floor(i / 24) + 1) % 7 // 0 = Sunday; the week starts Monday
      const h = i % 24
      const weekend = dow === 0 || dow === 6
      const hourly = weekend && s.WEEKEND ? f(s.WEEKEND, h) : s.HOURLY ? f(s.HOURLY, h) : 1
      week[i]! += avg * m * (s.DAILY ? f(s.DAILY, dow) : 1) * hourly
    }
  }
  return week
}

/** Per-person daily volume to the model's flow units. */
export function perCapitaToFlow(perPersonPerDay: number, people: number, flow: string): number {
  const us = ['CFS', 'GPM', 'MGD'].includes(up(flow))
  // US: gallons per person per day; SI: litres per person per day.
  const perDay = perPersonPerDay * people
  switch (up(flow)) {
    case 'CFS':
      return (perDay * 0.133680556) / 86400
    case 'GPM':
      return perDay / 1440
    case 'MGD':
      return perDay / 1e6
    case 'CMS':
      return perDay / 1000 / 86400
    case 'LPS':
      return perDay / 86400
    case 'MLD':
      return perDay / 1e6
    default:
      return us ? (perDay * 0.133680556) / 86400 : perDay / 86400
  }
}

// ----------------------------------------------------- RDII unit hydrographs

export const RESPONSES = ['SHORT', 'MEDIUM', 'LONG'] as const
export type Response = (typeof RESPONSES)[number]
export const MONTHS = ['ALL', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const
export type Month = (typeof MONTHS)[number]
export type Rtk = { r: string; t: string; k: string; dmax: string; drecov: string; dinit: string }
export type UnitHydrograph = { name: string; gage: string; months: Partial<Record<Month, Partial<Record<Response, Rtk>>>> }

export const emptyRtk = (): Rtk => ({ r: '0', t: '0', k: '0', dmax: '', drecov: '', dinit: '' })

export function parseHydrographs(rows: Row[]): UnitHydrograph[] {
  const out = new Map<string, UnitHydrograph>()
  for (const r of rows) {
    const t = toks(r)
    if (t.length < 2) continue
    const name = t[0]!
    let u = out.get(name)
    if (!u) out.set(name, (u = { name, gage: '', months: {} }))
    if (t.length === 2) {
      u.gage = t[1]!
      continue
    }
    const month = up(t[1]) as Month
    const resp = up(t[2]) as Response
    if (!(MONTHS as readonly string[]).includes(month) || !(RESPONSES as readonly string[]).includes(resp)) continue
    ;(u.months[month] ??= {})[resp] = { r: t[3] ?? '0', t: t[4] ?? '0', k: t[5] ?? '0', dmax: t[6] ?? '', drecov: t[7] ?? '', dinit: t[8] ?? '' }
  }
  return [...out.values()]
}

export function serializeHydrographs(list: UnitHydrograph[]): Row[] {
  const rows: Row[] = []
  for (const u of list) {
    rows.push({ values: [u.name, u.gage || '*'] })
    for (const m of MONTHS) {
      const set = u.months[m]
      if (!set) continue
      for (const resp of RESPONSES) {
        const p = set[resp]
        if (!p) continue
        const ia = [p.dmax, p.drecov, p.dinit].map((v) => v.trim())
        const anyIa = ia.some(Boolean)
        rows.push({ values: [u.name, m, resp, p.r.trim() || '0', p.t.trim() || '0', p.k.trim() || '0', ...(anyIa ? ia.map((v) => v || '0') : [])] })
      }
    }
  }
  return rows
}

/**
 * The three triangles of an RTK set and their sum: flow per unit area per unit
 * of rain depth falling in one hour (so the area under each is its R).
 */
export function rtkCurve(set: Partial<Record<Response, Rtk>> | undefined, step = 0.25) {
  const tri = RESPONSES.map((k) => {
    const p = set?.[k]
    const R = Number(p?.r) || 0
    const T = Number(p?.t) || 0
    const K = Number(p?.k) || 0
    return { R, T, K, base: T * (1 + K) }
  })
  const end = Math.max(1, ...tri.map((t) => t.base)) * 1.05
  const pts: { t: number; SHORT: number; MEDIUM: number; LONG: number; total: number }[] = []
  for (let t = 0; t <= end + 1e-9; t += Math.max(step, end / 400)) {
    const v = tri.map(({ R, T, base }) => {
      if (!R || !T || base <= T) return 0
      const peak = (2 * R) / base
      return t <= T ? (peak * t) / T : t <= base ? (peak * (base - t)) / (base - T) : 0
    })
    pts.push({ t, SHORT: v[0]!, MEDIUM: v[1]!, LONG: v[2]!, total: v[0]! + v[1]! + v[2]! })
  }
  return { pts, totalR: tri.reduce((a, b) => a + b.R, 0) }
}

export type RdiiRow = { node: string; uh: string; area: string }
export const parseRdiiRows = (rows: Row[]): RdiiRow[] =>
  rows
    .map((r) => r.values.map(unq))
    .filter((v) => v.length >= 3 && v[0])
    .map((v) => ({ node: v[0]!, uh: v[1]!, area: v[2]! }))
export const serializeRdii = (list: RdiiRow[]): Row[] => list.filter((r) => r.node && r.uh).map((r) => ({ values: [r.node, r.uh, r.area.trim() || '0'] }))

// -------------------------------------------------------- who uses what

export type RefKind = 'timeseries' | 'curve' | 'pattern' | 'hydrograph'
export type Ref = { section: string; id: string; what: string }

/** Where each kind of name is used: section, the column it sits in (if the row qualifies), and what it is there. */
type RefRule = { section: string; col: (v: string[]) => number[]; what: (v: string[]) => string }
const at = (i: number) => () => [i]
const when = (test: (v: string[]) => boolean, ...cols: number[]) => (v: string[]) => (test(v) ? cols : [])

const RULES: Record<RefKind, RefRule[]> = {
  timeseries: [
    { section: 'RAINGAGES', col: when((v) => up(v[4]) === 'TIMESERIES', 5), what: () => 'Rain gage' },
    { section: 'INFLOWS', col: at(2), what: (v) => (up(v[1]) === 'FLOW' ? 'Inflow at node' : `${v[1]} inflow at node`) },
    { section: 'OUTFALLS', col: when((v) => up(v[2]) === 'TIMESERIES', 3), what: () => 'Outfall stage' },
    { section: 'EVAPORATION', col: when((v) => up(v[0]) === 'TIMESERIES', 1), what: () => 'Evaporation' },
    { section: 'TEMPERATURE', col: when((v) => up(v[0]) === 'TIMESERIES', 1), what: () => 'Temperature' },
  ],
  curve: [
    { section: 'STORAGE', col: when((v) => up(v[4]) === 'TABULAR', 5), what: () => 'Storage unit' },
    { section: 'PUMPS', col: at(3), what: () => 'Pump' },
    { section: 'OUTLETS', col: when((v) => up(v[4]).startsWith('TABULAR'), 5), what: () => 'Outlet' },
    { section: 'DIVIDERS', col: when((v) => up(v[3]) === 'TABULAR', 4), what: () => 'Flow divider' },
    { section: 'OUTFALLS', col: when((v) => up(v[2]) === 'TIDAL', 3), what: () => 'Tidal outfall' },
    { section: 'XSECTIONS', col: when((v) => up(v[1]) === 'CUSTOM', 3), what: () => 'Custom cross-section' },
    { section: 'WEIRS', col: (v) => (v.length > 12 ? [12] : []), what: () => 'Weir coefficient' },
    { section: 'INLETS', col: when((v) => up(v[1]) === 'CUSTOM', 2), what: () => 'Custom inlet' },
    { section: 'LID_CONTROLS', col: when((v) => up(v[1]) === 'DRAIN' && v.length > 8, 8), what: () => 'LID underdrain' },
  ],
  pattern: [
    { section: 'DWF', col: (v) => [3, 4, 5, 6].filter((i) => i < v.length), what: (v) => (up(v[1]) === 'FLOW' ? 'Dry-weather flow' : `Dry-weather ${v[1]}`) },
    { section: 'INFLOWS', col: (v) => (v.length > 7 ? [7] : []), what: () => 'Inflow baseline' },
    { section: 'AQUIFERS', col: (v) => (v.length > 12 ? [12] : []), what: () => 'Aquifer evaporation' },
    { section: 'ADJUSTMENTS', col: when((v) => ['N-PERV', 'DSTORE', 'INFIL'].includes(up(v[0])), 2), what: (v) => `Subcatchment ${v[0]} adjustment` },
  ],
  hydrograph: [{ section: 'RDII', col: at(1), what: () => 'RDII at node' }],
}

export const REF_SECTIONS: Record<RefKind, string[]> = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, [...new Set(r.map((x) => x.section))]])) as Record<RefKind, string[]>

export function usedBy(kind: RefKind, name: string, secs: Sections): Ref[] {
  const out: Ref[] = []
  if (!name) return out
  for (const rule of RULES[kind]) {
    for (const r of secs[rule.section] ?? []) {
      const v = r.values.map(unq)
      if (rule.col(v).some((i) => up(v[i]) === up(name))) out.push({ section: rule.section, id: rule.section === 'EVAPORATION' || rule.section === 'TEMPERATURE' ? 'Climate' : v[rule.section === 'ADJUSTMENTS' ? 1 : 0] ?? '', what: rule.what(v) })
    }
  }
  return out
}

/** Every name of this kind that something uses (to spot missing definitions). */
export function allReferenced(kind: RefKind, secs: Sections): Map<string, Ref[]> {
  const out = new Map<string, Ref[]>()
  for (const rule of RULES[kind]) {
    for (const r of secs[rule.section] ?? []) {
      const v = r.values.map(unq)
      for (const i of rule.col(v)) {
        const n = v[i]
        if (!n || n === '*' || n === '""') continue
        const list = out.get(n) ?? []
        list.push({ section: rule.section, id: v[0] ?? '', what: rule.what(v) })
        out.set(n, list)
      }
    }
  }
  return out
}

/** The referencing sections with `from` renamed to `to`; only sections that changed are returned. */
export function renameRefs(kind: RefKind, from: string, to: string, secs: Sections): Sections {
  const changed: Sections = {}
  for (const rule of RULES[kind]) {
    const rows = changed[rule.section] ?? secs[rule.section]
    if (!rows) continue
    let hit = false
    const next = rows.map((r) => {
      const v = r.values.map(unq)
      const cols = rule.col(v).filter((i) => up(v[i]) === up(from))
      if (!cols.length) return r
      hit = true
      const values = [...r.values]
      for (const i of cols) values[i] = to
      return { ...r, values }
    })
    if (hit) changed[rule.section] = next
  }
  return changed
}

// ------------------------------------------------------- reading files

export type Imported = { names: string[]; points: { date: string; time: string; values: string[] }[]; skipped: number; format: string }

const pad = (n: number) => String(n).padStart(2, '0')
const swmmDate = (y: number, m: number, d: number) => `${pad(m)}/${pad(d)}/${y}`

/**
 * One timestamp (or a date cell and a time cell) to SWMM's date and time.
 * Accepts ISO (2024-06-01 13:15[:00], with T or Z), US dates (6/1/2024 1:15 PM),
 * day-first dates when `dayFirst`, elapsed hours (1.5 or 1:30).
 */
export function readStamp(a: string, b?: string, dayFirst = false): { date: string; time: string } | null {
  let s = (b != null ? `${a} ${b}` : a).trim().replace(/^"|"$/g, '')
  if (!s) return null
  s = s.replace('T', ' ').replace(/Z$|[+-]\d\d:?\d\d$/, '')
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(s)
  if (m) return { date: swmmDate(+m[1]!, +m[2]!, +m[3]!), time: `${pad(+(m[4] ?? 0))}:${m[5] ?? '00'}${m[6] && m[6] !== '00' ? `:${m[6]}` : ''}` }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s)
  if (m) {
    let y = +m[3]!
    if (y < 100) y += y < 70 ? 2000 : 1900
    const [mo, d] = dayFirst ? [+m[2]!, +m[1]!] : [+m[1]!, +m[2]!]
    let h = +(m[4] ?? 0)
    if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0)
    return { date: swmmDate(y, mo, d), time: `${pad(h)}:${m[5] ?? '00'}${m[6] && m[6] !== '00' ? `:${m[6]}` : ''}` }
  }
  if (b == null && /^\d+(\.\d+)?$|^\d+:\d{2}(:\d{2})?$/.test(s)) return { date: '', time: s }
  return null
}

const isNum = (v: string) => v.trim() !== '' && Number.isFinite(Number(v.trim().replace(/,/g, '')))

/**
 * Read a time series from text: a SWMM time series file ("[station] date time
 * value", "time value"), CSV/TSV with or without a header (a datetime column,
 * or date and time columns, then one or more value columns), or cells pasted
 * from a spreadsheet.
 */
export function readSeriesText(text: string, opts: { dayFirst?: boolean } = {}): Imported {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() && !l.trim().startsWith(';'))
  if (!lines.length) return { names: [], points: [], skipped: 0, format: 'empty' }
  const delim = lines.slice(0, 20).some((l) => l.includes('\t')) ? '\t' : lines.slice(0, 20).every((l) => l.includes(';') && !l.includes(',')) ? ';' : lines.slice(0, 20).some((l) => l.includes(',')) ? ',' : null
  const split = (l: string) => (delim ? l.split(delim) : l.trim().split(/\s+/)).map((c) => c.trim().replace(/^"|"$/g, ''))
  const rows = lines.map(split)

  // SWMM's user-prepared rain file: Station Year Month Day Hour Minute Value.
  const ymdhm = (r: string[]) => r.length === 7 && r.slice(1).every(isNum) && +r[1]! > 1800 && +r[2]! >= 1 && +r[2]! <= 12
  if (rows.filter(ymdhm).length >= Math.ceil(rows.length / 2)) {
    const points: Imported['points'] = []
    let skipped = 0
    for (const r of rows) {
      if (!ymdhm(r)) {
        skipped++
        continue
      }
      points.push({ date: swmmDate(+r[1]!, +r[2]!, +r[3]!), time: `${pad(+r[4]!)}:${pad(+r[5]!)}`, values: [String(Number(r[6]))] })
    }
    return { names: [rows.find(ymdhm)![0]!], points, skipped, format: 'SWMM rain file (station, year, month, day, hour, minute, value)' }
  }

  // Work out the layout from the first row that reads as data.
  const layout = (r: string[]): { tCols: number; skipLead: number } | null => {
    for (let lead = 0; lead <= Math.min(1, r.length - 2); lead++) {
      const c = r.slice(lead)
      if (c.length >= 3 && readStamp(c[0]!, c[1]!, opts.dayFirst) && isNum(c[2]!) && /\d[/-]\d/.test(c[0]!)) return { tCols: 2, skipLead: lead }
      if (c.length >= 2 && readStamp(c[0]!, undefined, opts.dayFirst) && isNum(c[1]!)) return { tCols: 1, skipLead: lead }
    }
    return null
  }
  const first = rows.findIndex((r) => layout(r))
  if (first < 0) return { names: [], points: [], skipped: rows.length, format: 'unknown' }
  const lay = layout(rows[first]!)!
  const header = first > 0 ? rows[first - 1]! : null
  const width = rows[first]!.length - lay.skipLead - lay.tCols
  const names = Array.from({ length: Math.max(1, width) }, (_, i) => {
    const h = header?.[lay.skipLead + lay.tCols + i]
    return h && !isNum(h) ? h : width > 1 ? `Series ${i + 1}` : 'Series'
  })
  const points: Imported['points'] = []
  let skipped = Math.max(0, first - 1)
  for (const r of rows.slice(first)) {
    const c = r.slice(lay.skipLead)
    const st = lay.tCols === 2 ? readStamp(c[0]!, c[1], opts.dayFirst) : readStamp(c[0]!, undefined, opts.dayFirst)
    const vals = c.slice(lay.tCols, lay.tCols + names.length).map((v) => v.replace(/,/g, ''))
    if (!st || !vals.some(isNum)) {
      skipped++
      continue
    }
    points.push({ ...st, values: names.map((_, i) => (isNum(vals[i] ?? '') ? String(Number(vals[i])) : '')) })
  }
  const format = lay.skipLead ? 'SWMM time series file (with station ID)' : delim === ',' ? 'CSV' : delim === '\t' ? 'Tab-separated / spreadsheet' : delim === ';' ? 'Semicolon-separated' : 'Space-separated'
  return { names, points, skipped, format }
}

/** Imported columns as time series, dropping blank cells. Dates are written only when they change. */
export function importedToSeries(imp: Imported, column: number, name: string): TimeSeries {
  const points: TsPoint[] = []
  let lastDate = ''
  for (const p of imp.points) {
    const v = p.values[column] ?? ''
    if (v === '') continue
    points.push({ date: p.date && p.date !== lastDate ? p.date : '', time: p.time, value: v })
    if (p.date) lastDate = p.date
  }
  return { name, points }
}

/** Pasted cells as curve points (two numeric columns; a header row is skipped). */
export function readPairs(text: string): [string, string][] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim().split(/[\t,;]|\s+/).filter(Boolean))
    .filter((c) => c.length >= 2 && isNum(c[0]!) && isNum(c[1]!))
    .map((c) => [String(Number(c[0])), String(Number(c[1]))])
}

/** A name not in `taken`, from `base` (Base, Base2, Base3…), with spaces made SWMM-safe. */
export function freeName(base: string, taken: Iterable<string>): string {
  const t = new Set([...taken].map(up))
  const b = base.trim().replace(/\s+/g, '_') || 'Item'
  if (!t.has(up(b))) return b
  for (let i = 2; ; i++) if (!t.has(up(`${b}${i}`))) return `${b}${i}`
}

export const validName = (n: string) => /^[^\s;"[\]]+$/.test(n)
