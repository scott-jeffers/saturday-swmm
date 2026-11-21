/**
 * Rain gages, read-only: what [RAINGAGES] says about each gage, where its
 * rainfall comes from, and that rainfall as a hyetograph (intensity per
 * interval) with its cumulative depth.
 *
 * [RAINGAGES] rows:
 *   Name Format Interval SCF TIMESERIES SeriesName
 *   Name Format Interval SCF FILE FileName Station Units
 * Format is INTENSITY (rate), VOLUME (depth per interval) or CUMULATIVE.
 */

import { parseHours, parseTimeseries, type InputSeries } from './inputSeries'
import { parseSwmmDatFile } from './storm/swmmDat'

export type RainFormat = 'INTENSITY' | 'VOLUME' | 'CUMULATIVE'

export type RainGage = {
  name: string
  format: RainFormat
  /** Recording interval in hours. */
  intervalHr: number
  intervalText: string
  scf: number
  source: 'TIMESERIES' | 'FILE'
  series?: string
  file?: string
  station?: string
  /** IN or MM, for FILE gages. */
  units?: string
}

export function parseRainGages(rows: string[][]): RainGage[] {
  const out: RainGage[] = []
  for (const t of rows) {
    if (t.length < 6) continue
    const fmt = t[1].toUpperCase()
    const format: RainFormat = fmt === 'VOLUME' ? 'VOLUME' : fmt.startsWith('CUMUL') ? 'CUMULATIVE' : 'INTENSITY'
    const intervalHr = parseHours(t[2]) ?? 1
    const src = t[4].toUpperCase()
    const g: RainGage = {
      name: t[0],
      format,
      intervalHr: intervalHr > 0 ? intervalHr : 1,
      intervalText: t[2],
      scf: Number(t[3]) || 1,
      source: src === 'FILE' ? 'FILE' : 'TIMESERIES',
    }
    if (g.source === 'FILE') {
      g.file = (t[5] ?? '').replace(/^"|"$/g, '')
      g.station = t[6]
      g.units = t[7]?.toUpperCase()
    } else {
      g.series = t[5]
    }
    out.push(g)
  }
  return out
}

/** File name without folders, lower-cased: how a dropped file is matched. */
export const baseName = (p: string) => p.replace(/^"|"$/g, '').split(/[\\/]/).pop()!.toLowerCase()

export type Hyetograph = {
  /** Start of each interval, hours from the first record. */
  hours: number[]
  /** Width of each bar in hours. */
  widthHr: number
  /** Rainfall intensity over each interval (depth per hour). */
  intensity: number[]
  /** Cumulative depth at the end of each interval. */
  cumulative: number[]
  total: number
  peak: number
  peakHr: number
  /** From the first to the end of the last interval with rain. */
  wetSpanHr: number
  /** Whole record, start to end. */
  spanHr: number
  records: number
  /** Calendar time of the first record, when known. */
  start?: Date
}

/**
 * Turn raw gage values (at `hours`) into a hyetograph. Each value holds for
 * one recording interval from its time stamp, the way SWMM reads it.
 */
export function hyetograph(hours: number[], values: number[], format: RainFormat, intervalHr: number, start?: Date): Hyetograph {
  const n = Math.min(hours.length, values.length)
  const depth: number[] = []
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (format === 'INTENSITY') depth.push(Math.max(0, v) * intervalHr)
    else if (format === 'VOLUME') depth.push(Math.max(0, v))
    else depth.push(Math.max(0, i === 0 ? v : v - values[i - 1]))
  }
  const intensity = depth.map((d) => d / intervalHr)
  let total = 0
  let peak = 0
  let peakHr = hours[0] ?? 0
  let firstWet = -1
  let lastWet = -1
  const cumulative: number[] = []
  for (let i = 0; i < n; i++) {
    total += depth[i]
    cumulative.push(total)
    if (intensity[i] > peak) {
      peak = intensity[i]
      peakHr = hours[i]
    }
    if (depth[i] > 0) {
      if (firstWet < 0) firstWet = i
      lastWet = i
    }
  }
  const h = hours.slice(0, n)
  return {
    hours: h,
    widthHr: intervalHr,
    intensity,
    cumulative,
    total,
    peak,
    peakHr,
    wetSpanHr: firstWet < 0 ? 0 : h[lastWet] + intervalHr - h[firstWet],
    spanHr: n ? h[n - 1] + intervalHr - h[0] : 0,
    records: n,
    start,
  }
}

/**
 * Fewer, wider bars for long records, so a chart stays quick: depths are
 * summed into `maxBars` equal bins and shown as the mean intensity of each.
 */
export function binHyetograph(h: Hyetograph, maxBars = 1500): Hyetograph {
  if (h.records <= maxBars || h.spanHr <= 0) return h
  const t0 = h.hours[0]
  const width = h.spanHr / maxBars
  const depth = new Array<number>(maxBars).fill(0)
  for (let i = 0; i < h.records; i++) {
    const d = h.intensity[i] * h.widthHr
    const b = Math.min(maxBars - 1, Math.floor((h.hours[i] - t0) / width))
    depth[b] += d
  }
  const hours = depth.map((_, b) => t0 + b * width)
  const intensity = depth.map((d) => d / width)
  let c = 0
  const cumulative = depth.map((d) => (c += d))
  return { ...h, hours, widthHr: width, intensity, cumulative }
}

/** A gage's rainfall from a [TIMESERIES] entry. */
export function fromSeries(g: RainGage, s: InputSeries, startDate?: Date): Hyetograph {
  return hyetograph(s.hours, s.values, g.format, g.intervalHr, s.dated ? undefined : startDate)
}

/** A gage's rainfall from a rain file's text (station lines or date-time lines). */
export function fromRainFile(g: RainGage, text: string): Hyetograph | null {
  const { records } = parseSwmmDatFile(text)
  const want = g.station?.toUpperCase()
  const own = want ? records.filter((r) => !r.station || r.station.toUpperCase() === want) : records
  const recs = own.length ? own : records
  if (!recs.length) return null
  const t0 = recs[0].time.getTime()
  return hyetograph(
    recs.map((r) => (r.time.getTime() - t0) / 3_600_000),
    recs.map((r) => r.value),
    g.format,
    g.intervalHr,
    recs[0].time,
  )
}

/**
 * Rainfall the run used, from a subcatchment on this gage: the .out file
 * keeps it as an intensity per reporting step.
 */
export function fromRun(rates: number[], stepSec: number, start?: Date): Hyetograph {
  const step = stepSec / 3600
  return hyetograph(
    rates.map((_, i) => i * step),
    rates,
    'INTENSITY',
    step,
    start,
  )
}

export { parseTimeseries }

/** "IN" for US flow units, "MM" otherwise; a FILE gage's own units win. */
export function depthUnit(g: RainGage, flowUnits: string): 'in' | 'mm' {
  if (g.units === 'IN') return 'in'
  if (g.units === 'MM') return 'mm'
  return ['CFS', 'GPM', 'MGD'].includes(flowUnits.toUpperCase()) ? 'in' : 'mm'
}

/** SWMM "MM/DD/YYYY" (+ optional "HH:MM[:SS]") → a local Date. */
export function swmmDate(date?: string, time?: string): Date | undefined {
  const m = date ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date) : null
  if (!m) return undefined
  const h = time ? parseHours(time) ?? 0 : 0
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]))
  d.setTime(d.getTime() + h * 3_600_000)
  return d
}
