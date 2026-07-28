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
  /** 'intensity' writes in/hr or mm/hr; 'depth' writes depth per interval. */
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
 */
export function toSwmmDatFile(
  steps: StormStep[],
  options: SwmmDatOptions,
): string {
  const valueKind = options.valueKind ?? 'intensity'
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
  lines.push(`; value = ${valueKind} · station = ${station}`)

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
