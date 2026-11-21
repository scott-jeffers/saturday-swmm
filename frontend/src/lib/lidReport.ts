/**
 * SWMM LID report files: one LID unit's own water balance over the run.
 *
 *   SWMM5 LID Report File
 *   Project:  …
 *   LID Unit: RainGarden in Subcatchment S1
 *   (three header rows, a dashed rule)
 *    06/01/2024 00:01:00   0.017   0.055   0.0000 …   (tab separated)
 *
 * Columns after date and time: elapsed hours, then 12 values. SWMM writes a
 * line only when something changes, so a value holds until the next line.
 */

export type LidColumn = { id: string; label: string; unit: 'rate' | 'level' | 'fraction' }

/** The 12 value columns, in file order (after elapsed time). */
export const LID_COLUMNS: LidColumn[] = [
  { id: 'inflow', label: 'Total inflow', unit: 'rate' },
  { id: 'evap', label: 'Evaporation', unit: 'rate' },
  { id: 'infil', label: 'Surface infiltration', unit: 'rate' },
  { id: 'pave_perc', label: 'Pavement percolation', unit: 'rate' },
  { id: 'soil_perc', label: 'Soil percolation', unit: 'rate' },
  { id: 'exfil', label: 'Storage exfiltration', unit: 'rate' },
  { id: 'runoff', label: 'Surface runoff', unit: 'rate' },
  { id: 'drain', label: 'Drain outflow', unit: 'rate' },
  { id: 'surface_level', label: 'Surface level', unit: 'level' },
  { id: 'pave_level', label: 'Pavement level', unit: 'level' },
  { id: 'soil_moisture', label: 'Soil moisture', unit: 'fraction' },
  { id: 'storage_level', label: 'Storage level', unit: 'level' },
]

export type LidReport = {
  /** "S1 · RainGarden"; a second unit of the same kind gets " (2)". */
  key: string
  subcatchment: string
  lid: string
  /** Elapsed hours of each line. */
  hours: number[]
  /** values[c][i]: column c at line i. */
  values: number[][]
  /** in/hr + inches, or mm/hr + mm, from the file's units row. */
  us: boolean
}

export function parseLidReport(text: string): LidReport | null {
  const lines = text.split(/\r?\n/)
  if (!/SWMM5? LID Report File/i.test(lines[0] ?? '')) return null
  const unitLine = lines.find((l) => /^\s*LID Unit:/i.test(l)) ?? ''
  const m = /LID Unit:\s*(.+?)\s+in\s+Subcatchment\s+(.+?)\s*$/i.exec(unitLine)
  const lid = m?.[1] ?? 'LID'
  const subcatchment = m?.[2] ?? '?'
  const us = !/mm\/hr/i.test(text.slice(0, 3000))
  const hours: number[] = []
  const values: number[][] = LID_COLUMNS.map(() => [])
  for (const l of lines) {
    // data lines start with a date: " 06/01/2024 00:01:00\t…"
    if (!/^\s*\d{1,2}\/\d{1,2}\/\d{4}/.test(l)) continue
    const t = l.trim().split(/\s+/)
    const h = Number(t[2])
    if (!Number.isFinite(h)) continue
    hours.push(h)
    for (let c = 0; c < LID_COLUMNS.length; c++) values[c].push(Number(t[3 + c]) || 0)
  }
  return { key: `${subcatchment} · ${lid}`, subcatchment, lid, hours, values, us }
}

export function parseLidReports(texts: (string | null | undefined)[]): LidReport[] {
  const out: LidReport[] = []
  const seen = new Map<string, number>()
  for (const t of texts) {
    const r = t ? parseLidReport(t) : null
    if (!r) continue
    const n = (seen.get(r.key) ?? 0) + 1
    seen.set(r.key, n)
    if (n > 1) r.key = `${r.key} (${n})`
    out.push(r)
  }
  return out
}

/**
 * One column at the run's report times (the end of each reporting step), so
 * LID series line up with every other graph. Values hold between lines.
 */
export function lidSeriesAtPeriods(r: LidReport, column: string, stepSec: number, periods: number): number[] {
  const c = LID_COLUMNS.findIndex((x) => x.id === column)
  const out = new Array<number>(periods).fill(0)
  if (c < 0 || !r.hours.length) return out
  const col = r.values[c]
  let i = -1
  for (let p = 0; p < periods; p++) {
    const t = ((p + 1) * stepSec) / 3600 + 1e-9
    while (i + 1 < r.hours.length && r.hours[i + 1] <= t) i++
    out[p] = i >= 0 ? col[i] : 0
  }
  return out
}

export function lidUnit(col: LidColumn, us: boolean): string {
  if (col.unit === 'rate') return us ? 'in/hr' : 'mm/hr'
  if (col.unit === 'level') return us ? 'in' : 'mm'
  return 'fraction'
}

/** Columns that carry any non-zero value in at least one report (hide the rest). */
export function usedColumns(reports: LidReport[]): LidColumn[] {
  return LID_COLUMNS.filter((_, c) => reports.some((r) => r.values[c].some((v) => v !== 0)))
}

/**
 * The input text with a report file on every [LID_USAGE] row that has none
 * ("lid_000.txt", …), so a run writes each LID unit's time series. Rows that
 * name their own file are left alone.
 */
export function withLidReportFiles(text: string): { text: string; files: string[] } {
  const lines = text.split('\n')
  const files: string[] = []
  let section = ''
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim()
    if (/^\[.+\]$/.test(s)) {
      section = s.slice(1, -1).trim().toUpperCase()
      continue
    }
    if (section !== 'LID_USAGE' || !s || s.startsWith(';')) continue
    const tokens = s.split(';')[0].match(/"[^"]*"|\S+/g) ?? []
    if (tokens.length < 4) continue
    const k = n++
    const own = tokens[8]?.replace(/^"|"$/g, '')
    if (own && own !== '*') continue
    const t = tokens.slice(0, 8)
    while (t.length < 8) t.push('0')
    const file = `lid_${String(k).padStart(3, '0')}.txt`
    files.push(file)
    lines[i] = [...t, file].join(' ') + (lines[i].endsWith('\r') ? '\r' : '')
  }
  return { text: lines.join('\n'), files }
}
