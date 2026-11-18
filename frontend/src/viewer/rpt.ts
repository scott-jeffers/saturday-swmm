/** Port of backend/app/services/rpt_service.py: run summary and report tables. */

import T from './tables.json'

const COLUMNS = T.rpt_columns as Record<string, string[]>
const OBJECT_KIND = T.rpt_object_kind as Record<string, string>
const UNIT = new RegExp(T.rpt_unit_pattern)
const STAR = /^\s*\*{5,}\s*$/
const DASH = /^\s*-{10,}\s*$/
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

type Cell = string | number | null
export type RptTable = { title: string; object: string | null; columns: string[]; units: string[]; rows: Cell[][] }

const num = (t: string): Cell => (NUM.test(t) ? Number(t) : t)

function sections(lines: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let i = 0
  const n = lines.length
  let title: string | null = null
  let buf: string[] = []
  while (i < n) {
    if (STAR.test(lines[i]) && i + 2 < n && STAR.test(lines[i + 2])) {
      if (title) out.set(title, buf)
      title = lines[i + 1].trim()
      buf = []
      i += 3
      continue
    }
    if (lines[i].trim().startsWith('*****') && i + 2 < n && lines[i + 2].trim().startsWith('*****')) {
      if (title) out.set(title, buf)
      title = lines[i + 1].trim().split(/\s{2,}/)[0]
      buf = []
      i += 3
      continue
    }
    buf.push(lines[i])
    i++
  }
  if (title) out.set(title, buf)
  return out
}

function table(title: string, body: string[]): RptTable | null {
  const dashes = body.flatMap((ln, k) => (DASH.test(ln) ? [k] : []))
  if (dashes.length < 2) return null
  const head = body.slice(dashes[0] + 1, dashes[1])
  const unitsLine = head.length ? head[head.length - 1] : ''
  let rows: Cell[][] = []
  for (const ln of body.slice(dashes[1] + 1)) {
    if (!ln.trim()) {
      if (rows.length) break
      continue
    }
    if (DASH.test(ln)) break
    rows.push(ln.trim().split(/\s+/).map(num))
  }
  const cols = COLUMNS[title] ?? Array.from({ length: Math.max(0, ...rows.map((r) => r.length)) }, (_, k) => `Col ${k + 1}`)
  rows = rows.map((r) => (r.length < cols.length ? [...r, ...Array(cols.length - r.length).fill(null)] : r.slice(0, cols.length)))
  const merged: string[] = []
  for (const t of unitsLine.trim().split(/\s+/).filter(Boolean)) {
    if (merged.length && merged[merged.length - 1] === '10^6') merged[merged.length - 1] = `10^6 ${t}`
    else merged.push(t)
  }
  const units = merged.length === cols.length ? merged.map((u) => (UNIT.test(u) ? u : '')) : cols.map(() => '')
  if (units.length) units[0] = ''
  return { title, object: OBJECT_KIND[title] ?? null, columns: cols, units, rows }
}

function continuity(body: string[] | undefined): number | null {
  for (const ln of body ?? []) {
    if (ln.includes('Continuity Error')) {
      const m = /([-+]?\d+\.\d+)\s*$/.exec(ln)
      if (m) return Number(m[1])
    }
  }
  return null
}

export function parseReport(text: string) {
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const secs = sections(lines)
  const tables = new Map<string, RptTable>()
  for (const [t, body] of secs) {
    if (!(t in COLUMNS)) continue
    const tb = table(t, body)
    if (tb) tables.set(t, tb)
  }
  const warnings = lines.filter((ln) => /^\s*WARNING\b/.test(ln)).map((l) => l.trim())
  const errors = lines.filter((ln) => /^\s*ERROR\b/.test(ln)).map((l) => l.trim())
  const engine = lines.slice(0, 6).find((ln) => ln.toUpperCase().includes('VERSION'))?.trim() ?? null
  const flood = tables.get('Node Flooding Summary')
  const flooded = flood ? flood.rows : []
  const floodVolume = flooded.reduce<number>((s, r) => s + (typeof r[5] === 'number' ? r[5] : 0), 0)
  const floodUnits = (flood ? flood.units[5] : '') || ''
  const surch = tables.get('Node Surcharge Summary')
  const csurch = tables.get('Conduit Surcharge Summary')
  const el = lines.find((ln) => ln.includes('Total elapsed time'))
  return {
    engine,
    runoff_continuity_pct: continuity(secs.get('Runoff Quantity Continuity')),
    routing_continuity_pct: continuity(secs.get('Flow Routing Continuity')),
    flooded_nodes: flooded.length,
    flood_volume: Math.round(floodVolume * 1e4) / 1e4,
    flood_volume_units: floodUnits,
    surcharged_nodes: surch ? surch.rows.length : 0,
    surcharged_conduits: csurch ? csurch.rows.length : 0,
    warnings: warnings.slice(0, 200),
    errors: errors.slice(0, 200),
    elapsed: el ? el.slice(el.indexOf(':') + 1).trim() : null,
    highest_continuity_errors: (secs.get('Highest Continuity Errors') ?? []).filter((l) => l.trim()).map((l) => l.trim()).slice(0, 10),
    tables: [...tables.values()],
  }
}

export function summarize(text: string | null) {
  if (text == null) return { available: false }
  return { ...parseReport(text), available: true }
}
