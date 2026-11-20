/**
 * Node inflows from the model's input: [DWF] dry-weather flow with its time
 * patterns, [INFLOWS] external (direct) inflows, [RDII] rainfall-dependent
 * infiltration/inflow, and the [PATTERNS] they use.
 */
import type { InputSeries } from './inputSeries'

type Row = { values: string[] }

const unq = (v: string | undefined) => (v ?? '').replace(/^"(.*)"$/, '$1')
const key = (s: string) => s.toUpperCase()

export type Pattern = { name: string; type: 'MONTHLY' | 'DAILY' | 'HOURLY' | 'WEEKEND'; factors: number[] }
export type Dwf = { node: string; constituent: string; baseline: number; patterns: string[] }
export type ExtInflow = {
  node: string
  constituent: string
  series: string
  type: string
  mfactor: number
  sfactor: number
  baseline: number
  basePattern: string
}
export type Rdii = { node: string; unitHydrograph: string; area: number }

const PAT_TYPES = new Set(['MONTHLY', 'DAILY', 'HOURLY', 'WEEKEND'])

export function parsePatterns(rows: Row[]): Map<string, Pattern> {
  const out = new Map<string, Pattern>()
  for (const r of rows) {
    const t = r.values.filter((v) => v !== '')
    if (t.length < 2) continue
    const name = t[0]!
    let p = out.get(key(name))
    let rest = t.slice(1)
    if (PAT_TYPES.has(key(rest[0]!))) {
      p = { name, type: key(rest[0]!) as Pattern['type'], factors: [] }
      out.set(key(name), p)
      rest = rest.slice(1)
    }
    if (!p) continue
    for (const v of rest) {
      const n = Number(v)
      if (Number.isFinite(n)) p.factors.push(n)
    }
  }
  return out
}

export function parseDwf(rows: Row[]): Dwf[] {
  return rows
    .filter((r) => r.values.length >= 3)
    .map((r) => ({
      node: r.values[0]!,
      constituent: r.values[1]!,
      baseline: Number(r.values[2]) || 0,
      patterns: r.values.slice(3).map(unq).filter(Boolean),
    }))
}

export function parseInflows(rows: Row[]): ExtInflow[] {
  return rows
    .filter((r) => r.values.length >= 3)
    .map((r) => {
      const v = r.values.map(unq)
      return {
        node: v[0]!,
        constituent: v[1]!,
        series: v[2] ?? '',
        type: v[3] || 'FLOW',
        mfactor: Number(v[4] ?? 1) || 1,
        sfactor: Number(v[5] ?? 1) || 1,
        baseline: Number(v[6] ?? 0) || 0,
        basePattern: v[7] ?? '',
      }
    })
}

export function parseRdii(rows: Row[]): Rdii[] {
  return rows.filter((r) => r.values.length >= 3).map((r) => ({ node: r.values[0]!, unitHydrograph: r.values[1]!, area: Number(r.values[2]) || 0 }))
}

/**
 * Dry-weather flow over a typical weekday, hour by hour: baseline × the
 * hourly pattern (or flat when there is none). Monthly and daily factors are
 * left out so the graph shows the daily shape.
 */
export function dwfProfile(d: Dwf, patterns: Map<string, Pattern>): InputSeries {
  const hourly = d.patterns.map((n) => patterns.get(key(n))).find((p) => p?.type === 'HOURLY')
  const hours: number[] = []
  const values: number[] = []
  for (let h = 0; h <= 24; h++) {
    hours.push(h)
    const f = hourly ? hourly.factors[Math.min(h, 23)] ?? 1 : 1
    values.push(d.baseline * f)
  }
  return { name: d.node, hours, values, dated: false }
}

/** A pattern's factors as a step series: hours for HOURLY/WEEKEND, days for DAILY, months (×30 d) for MONTHLY. */
export function patternSeries(p: Pattern): InputSeries {
  const step = p.type === 'DAILY' ? 24 : p.type === 'MONTHLY' ? 24 * 30 : 1
  const hours = p.factors.map((_, i) => i * step)
  const values = [...p.factors]
  if (values.length) {
    hours.push(values.length * step)
    values.push(values[values.length - 1]!)
  }
  return { name: p.name, hours, values, dated: false }
}

/** An external inflow: its time series × factors + baseline. */
export function inflowSeries(f: ExtInflow, series: InputSeries | undefined): InputSeries {
  if (!series) {
    // Baseline only (or the series is missing): a flat line over a day.
    return { name: f.node, hours: [0, 24], values: [f.baseline, f.baseline], dated: false }
  }
  if (series.file) return { ...series, name: f.node, file: series.file }
  return {
    name: f.node,
    hours: series.hours,
    values: series.values.map((v) => v * f.mfactor * f.sfactor + f.baseline),
    dated: series.dated,
  }
}
