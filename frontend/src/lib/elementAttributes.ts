/**
 * Every number we know about each element (model inputs, values derived from
 * them, and results from the report), for queries, map colouring and design checks.
 */
import type { Feature } from 'geojson'
import type { RptTable } from '../api/client'

export type Target = 'node' | 'link' | 'subcatchment'
export type AttrGroup = 'Model' | 'Derived' | 'Results'

export type Attribute = {
  key: string
  label: string
  group: AttrGroup
  target: Target
  unit?: string
  values: Map<string, number>
}

const MODEL_FIELDS: Record<Target, [string, string, 'len' | 'area' | 'subarea' | 'pct' | null][]> = {
  node: [
    ['elevation', 'Invert elevation', 'len'],
    ['max_depth', 'Max depth', 'len'],
    ['init_depth', 'Initial depth', 'len'],
    ['sur_depth', 'Surcharge depth', 'len'],
    ['aponded', 'Ponded area', 'area'],
  ],
  link: [
    ['length', 'Length', 'len'],
    ['diameter', 'Height / diameter', 'len'],
    ['roughness', "Manning's n", null],
    ['in_offset', 'Inlet offset', 'len'],
    ['out_offset', 'Outlet offset', 'len'],
  ],
  subcatchment: [
    ['area', 'Area', 'subarea'],
    ['pct_imperv', 'Impervious', 'pct'],
    ['width', 'Width', 'len'],
    ['slope', 'Slope', 'pct'],
  ],
}

export function unitText(kind: 'len' | 'area' | 'subarea' | 'pct' | null, us: boolean) {
  if (!kind) return undefined
  return { len: us ? 'ft' : 'm', area: us ? 'ft²' : 'm²', subarea: us ? 'ac' : 'ha', pct: '%' }[kind]
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function buildAttributes(features: Feature[], tables: RptTable[] | undefined, us: boolean): Attribute[] {
  const by: Record<Target, Feature[]> = { node: [], link: [], subcatchment: [] }
  for (const f of features) {
    const t = f.properties?.object_type as Target | undefined
    if (t && by[t]) by[t].push(f)
  }
  const out: Attribute[] = []
  for (const target of ['node', 'link', 'subcatchment'] as Target[]) {
    for (const [key, label, u] of MODEL_FIELDS[target]) {
      const values = new Map<string, number>()
      for (const f of by[target]) {
        const n = num(f.properties?.[key])
        if (n != null) values.set(String(f.properties?.id), n)
      }
      if (values.size) out.push({ key: `m:${key}`, label, group: 'Model', target, unit: unitText(u, us), values })
    }
  }

  // Derived: rim elevation, conduit slope and the smallest cover over each pipe.
  const node = new Map(by.node.map((f) => [String(f.properties?.id), f.properties ?? {}]))
  const rim = new Map<string, number>()
  for (const [id, p] of node) {
    const e = num(p.elevation)
    const d = num(p.max_depth)
    if (e != null && d != null) rim.set(id, e + d)
  }
  if (rim.size) out.push({ key: 'd:rim', label: 'Rim elevation', group: 'Derived', target: 'node', unit: unitText('len', us), values: rim })
  const slope = new Map<string, number>()
  const cover = new Map<string, number>()
  for (const f of by.link) {
    const p = f.properties ?? {}
    if (p.link_kind && p.link_kind !== 'conduit') continue
    const a = node.get(String(p.from_node))
    const b = node.get(String(p.to_node))
    const L = num(p.length)
    const ea = num(a?.elevation)
    const eb = num(b?.elevation)
    if (!a || !b || ea == null || eb == null) continue
    // Offsets as heights above the inverts (the *_depth values also cover LINK_OFFSETS ELEVATION).
    const za = ea + (num(p.in_offset_depth ?? p.in_offset) ?? 0)
    const zb = eb + (num(p.out_offset_depth ?? p.out_offset) ?? 0)
    if (L && L > 0) slope.set(String(p.id), ((za - zb) / L) * 100)
    const dia = num(p.diameter) ?? 0
    // Cover only means something at manholes: outfalls have no rim above the pipe.
    const ends: number[] = []
    const ra = rim.get(String(p.from_node))
    const rb = rim.get(String(p.to_node))
    if (ra != null && a.node_kind !== 'outfall') ends.push(ra - (za + dia))
    if (rb != null && b.node_kind !== 'outfall') ends.push(rb - (zb + dia))
    if (ends.length) cover.set(String(p.id), Math.min(...ends))
  }
  if (slope.size) out.push({ key: 'd:slope', label: 'Slope', group: 'Derived', target: 'link', unit: '%', values: slope })
  if (cover.size) out.push({ key: 'd:cover', label: 'Minimum cover', group: 'Derived', target: 'link', unit: unitText('len', us), values: cover })

  // Results: every numeric column of every report table, keyed by element.
  for (const t of tables ?? []) {
    if (!t.object) continue
    t.columns.forEach((c, ci) => {
      if (ci === 0) return
      const values = new Map<string, number>()
      for (const r of t.rows) {
        const n = num(r[ci])
        if (n != null && typeof r[ci] === 'number') values.set(String(r[0]), n)
      }
      if (values.size)
        out.push({
          key: `r:${t.title}:${c}`,
          label: `${c} (${t.title.replace(/ Summary$/, '')})`,
          group: 'Results',
          target: t.object as Target,
          unit: t.units?.[ci] || undefined,
          values,
        })
    })
  }
  return out
}

// ------------------------------------------------------------------ queries
export type Op = '>' | '>=' | '<' | '<=' | '=' | '!='
export type Condition = { attr: string; op: Op; value: number }

export function runQuery(attrs: Attribute[], conds: Condition[], ids: string[]): string[] {
  const byKey = new Map(attrs.map((a) => [a.key, a]))
  return ids.filter((id) =>
    conds.every((c) => {
      const v = byKey.get(c.attr)?.values.get(id)
      if (v == null) return false
      switch (c.op) {
        case '>': return v > c.value
        case '>=': return v >= c.value
        case '<': return v < c.value
        case '<=': return v <= c.value
        case '=': return Math.abs(v - c.value) < 1e-9
        case '!=': return Math.abs(v - c.value) >= 1e-9
      }
    }),
  )
}

// ------------------------------------------------------------------ classes
export const RAMPS: Record<string, string[]> = {
  Blues: ['#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'],
  Heat: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'],
  Greens: ['#c7e9c0', '#a1d99b', '#74c476', '#31a354', '#006d2c'],
  Diverging: ['#2166ac', '#67a9cf', '#f7f7f7', '#ef8a62', '#b2182b'],
}

/** Class edges (n+1 values) by quantile or equal interval. */
export function classBreaks(values: number[], n: number, method: 'quantile' | 'equal'): number[] {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return []
  const lo = v[0]
  const hi = v[v.length - 1]
  if (method === 'equal' || lo === hi) return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n)
  return Array.from({ length: n + 1 }, (_, i) => v[Math.min(v.length - 1, Math.round(((v.length - 1) * i) / n))])
}

export function classify(v: number, breaks: number[]): number {
  for (let i = 1; i < breaks.length; i++) if (v <= breaks[i]) return i - 1
  return breaks.length - 2
}

// ------------------------------------------------------------------ checks
export type Rule = {
  id: string
  label: string
  attr: string
  op: Op
  /** Fails when value <op> limit. */
  limit: number
  unit?: string
  enabled: boolean
}

export function defaultRules(us: boolean): Rule[] {
  const L = us ? 'ft' : 'm'
  const V = us ? 'ft/s' : 'm/s'
  return [
    { id: 'vmin', label: 'Self-cleansing velocity', attr: 'r:Link Flow Summary:Maximum Velocity', op: '<', limit: us ? 2 : 0.6, unit: V, enabled: true },
    { id: 'vmax', label: 'Maximum velocity', attr: 'r:Link Flow Summary:Maximum Velocity', op: '>', limit: us ? 10 : 3, unit: V, enabled: true },
    { id: 'cap', label: 'Pipe capacity (max/full flow)', attr: 'r:Link Flow Summary:Max/Full Flow', op: '>', limit: 1, enabled: true },
    { id: 'slope', label: 'Minimum slope', attr: 'd:slope', op: '<', limit: 0.3, unit: '%', enabled: true },
    { id: 'adverse', label: 'Adverse slope', attr: 'd:slope', op: '<', limit: 0, unit: '%', enabled: true },
    { id: 'cover', label: 'Minimum cover', attr: 'd:cover', op: '<', limit: us ? 3 : 0.9, unit: L, enabled: true },
    { id: 'flood', label: 'Flooding', attr: 'r:Node Flooding Summary:Hours Flooded', op: '>', limit: 0, unit: 'h', enabled: true },
    { id: 'surch', label: 'Surcharge (hours full both ends)', attr: 'r:Conduit Surcharge Summary:Hours Full Both Ends', op: '>', limit: 0, unit: 'h', enabled: false },
  ]
}

export type Failure = { rule: Rule; id: string; target: Target; value: number }

export function runChecks(attrs: Attribute[], rules: Rule[]): { failures: Failure[]; missing: Rule[] } {
  const byKey = new Map(attrs.map((a) => [a.key, a]))
  const failures: Failure[] = []
  const missing: Rule[] = []
  for (const r of rules) {
    if (!r.enabled) continue
    const a = byKey.get(r.attr)
    if (!a) {
      missing.push(r)
      continue
    }
    for (const [id, v] of a.values) {
      const bad = runQuery([a], [{ attr: r.attr, op: r.op, value: r.limit }], [id]).length > 0
      if (bad) failures.push({ rule: r, id, target: a.target, value: v })
    }
  }
  return { failures, missing }
}
