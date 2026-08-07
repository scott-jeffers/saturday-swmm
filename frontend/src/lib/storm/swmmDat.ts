/**
 * Package-shaped storm core (ported from GStorm).
 * Later extract to @scott-jeffers/gstorm-core without changing StormPage.
 */
import type { StormStep } from './types'

export type SwmmDatValueKind = 'intensity' | 'depth'

export interface SwmmDatOptions {
  /** Storm start (local calendar). */
  start: Date
  /** Station ID column — must match the raingage FILE station field. */
  stationId: string
  /** 'intensity' writes in/hr or mm/hr; 'depth' writes depth per interval (VOLUME gage). */
  valueKind?: SwmmDatValueKind
  /** Comment header for the file. */
  comment?: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Format as SWMM MM/DD/YYYY HH:MM (TIMESERIES-style labels). */
export function formatSwmmDateTime(d: Date): string {
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const yyyy = d.getFullYear()
  const hh = pad2(d.getHours())
  const mi = pad2(d.getMinutes())
  return `${mm}/${dd}/${yyyy} ${hh}:${mi}`
}

/**
 * Serialize hyetograph steps to a SWMM external rain FILE.
 * Format: Station Year Month Day Hour Minute Value
 * (required when the raingage Source is FILE).
 *
 * Default valueKind is **depth** (depth per reporting interval) for use with
 * INP format VOLUME. OpenSWMM under-reads INTENSITY FILE rain.
 */
export function toSwmmDatFile(
  steps: StormStep[],
  options: SwmmDatOptions,
): string {
  const valueKind = options.valueKind ?? 'depth'
  const station = options.stationId.trim() || 'RG1'
  const lines: string[] = []
  if (options.comment) {
    for (const part of options.comment.split('\n')) {
      lines.push(`; ${part}`)
    }
  } else {
    lines.push('; Design storm — Saturday-SWMM / GStorm core')
  }
  lines.push(`; SWMM FILE format: Station Year Month Day Hour Minute Value`)
  if (valueKind === 'depth') {
    lines.push(
      `; value = depth per interval (pair with [RAINGAGES] VOLUME) · station = ${station}`,
    )
  } else {
    lines.push(
      `; value = intensity (pair with [RAINGAGES] INTENSITY) · station = ${station}`,
    )
  }

  const startMs = options.start.getTime()
  for (const step of steps) {
    const t = new Date(startMs + step.timeStart * 60_000)
    const value = valueKind === 'intensity' ? step.intensity : step.depthStep
    lines.push(
      [
        station,
        t.getFullYear(),
        t.getMonth() + 1,
        t.getDate(),
        t.getHours(),
        t.getMinutes(),
        value.toFixed(6),
      ].join(' '),
    )
  }
  lines.push('')
  return lines.join('\n')
}

/** SWMM interval token like 0:05 from minutes. */
export function minutesToSwmmInterval(minutes: number): string {
  const m = Math.max(1, Math.round(minutes))
  if (m < 60) return `0:${pad2(m)}`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return `${h}:${pad2(rem)}`
}

export interface SwmmDatRecord {
  time: Date
  value: number
  station?: string
}

export interface ParsedSwmmDat {
  records: SwmmDatRecord[]
  stationId: string | null
}

/** Station Year Month Day Hour Minute Value */
const STA_LINE =
  /^\s*(\S+)\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([+-]?\d+(?:\.\d+)?)\s*$/

/** MM/DD/YYYY HH:MM[.SS] Value */
const DT_LINE =
  /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+([+-]?\d+(?:\.\d+)?)\s*$/

/**
 * Parse a SWMM external rain FILE (.dat) into timestamped values.
 * Supports FILE station format and TIMESERIES-style datetime lines.
 */
export function parseSwmmDatFile(text: string): ParsedSwmmDat {
  const records: SwmmDatRecord[] = []
  let stationId: string | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';')) continue

    let m = STA_LINE.exec(line)
    if (m) {
      const station = m[1]
      if (!stationId) stationId = station
      const y = Number(m[2])
      const mo = Number(m[3])
      const d = Number(m[4])
      const h = Number(m[5])
      const mi = Number(m[6])
      const value = Number(m[7])
      records.push({
        time: new Date(y, mo - 1, d, h, mi, 0),
        value,
        station,
      })
      continue
    }

    m = DT_LINE.exec(line)
    if (m) {
      const mo = Number(m[1])
      const d = Number(m[2])
      const y = Number(m[3])
      const h = Number(m[4])
      const mi = Number(m[5])
      const sec = Number(m[6] || 0)
      const value = Number(m[7])
      records.push({
        time: new Date(y, mo - 1, d, h, mi, sec),
        value,
      })
    }
  }

  return { records, stationId }
}

/** Chart points: hours from first record + rainfall value. */
export function swmmDatToChartData(
  records: SwmmDatRecord[],
): { timeHr: number; value: number; label: string }[] {
  if (!records.length) return []
  const t0 = records[0].time.getTime()
  return records.map((r) => ({
    timeHr: Number(((r.time.getTime() - t0) / 3_600_000).toFixed(4)),
    value: Number(r.value.toFixed(6)),
    label: formatSwmmDateTime(r.time),
  }))
}
