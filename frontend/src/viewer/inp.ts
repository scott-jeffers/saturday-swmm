/**
 * SWMM .inp reading in the browser: a port of backend/app/services/
 * inp_model_service.py (network, objects, simulation window) and
 * profile_service.py. Kept line-for-line close to the Python so the two can be
 * compared by viewer/golden.test.ts.
 */

type Attrs = Record<string, unknown>
type XY = [number, number]

const SECTION_ALIASES: Record<string, string> = { POLYGONS: 'Polygons' }

export function isComment(line: string): boolean {
  const s = line.trim()
  return !s || s.startsWith(';')
}

/** Tokens of a data line; quotes stripped, inline `;` comment dropped. */
export function tokenize(line: string): string[] {
  const out: string[] = []
  let i = 0
  const n = line.length
  while (i < n) {
    const ch = line[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++
      continue
    }
    if (ch === ';') break
    const start = i
    if (ch === '"') {
      const close = line.indexOf('"', i + 1)
      i = close < 0 ? n : close + 1
    } else {
      while (i < n && !' \t\r\n;'.includes(line[i])) i++
    }
    let tok = line.slice(start, i)
    if (tok.length >= 2 && tok[0] === '"' && tok[tok.length - 1] === '"') tok = tok.slice(1, -1)
    out.push(tok)
  }
  return out
}

/** Inline comment text after `;` (outside quotes), trimmed. */
export function inlineComment(line: string): string {
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') q = !q
    else if (c === ';' && !q) return line.slice(i + 1).trim()
  }
  return ''
}

function f(val: string | undefined, dflt: number | null = null): number | null {
  if (val === undefined) return dflt
  const s = val.trim()
  if (!s || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|infinity|nan)$/i.test(s)) return dflt
  return Number(s)
}
const fz = (toks: string[], i: number, d = 0) => (toks.length > i ? f(toks[i], d) : d)

export class ParsedModel {
  lines: string[] = []
  sections: Record<string, { idx: number; raw: string }[]> = {}
  mapBounds: [number, number, number, number] | null = null
  coordinates = new Map<string, XY>()
  vertices = new Map<string, XY[]>()
  polygons = new Map<string, XY[]>()
  junctions = new Map<string, Attrs>()
  outfalls = new Map<string, Attrs>()
  storage = new Map<string, Attrs>()
  conduits = new Map<string, Attrs>()
  pumps = new Map<string, Attrs>()
  orifices = new Map<string, Attrs>()
  weirs = new Map<string, Attrs>()
  outlets = new Map<string, Attrs>()
  subcatchments = new Map<string, Attrs>()
  xsections = new Map<string, Attrs>()

  rows(section: string): string[][] {
    return (this.sections[section] ?? []).filter((r) => !isComment(r.raw)).map((r) => tokenize(r.raw))
  }

  allNodes(): Map<string, Attrs> {
    const m = new Map<string, Attrs>()
    for (const [k, a] of this.junctions) m.set(k, { ...a, node_kind: 'junction' })
    for (const [k, a] of this.outfalls) m.set(k, { ...a, node_kind: 'outfall' })
    for (const [k, a] of this.storage) m.set(k, { ...a, node_kind: 'storage' })
    return m
  }

  /** [OPTIONS] LINK_OFFSETS ELEVATION: offsets are elevations, not heights above the node inverts. */
  offsetsAreElevations(): boolean {
    const r = this.rows('OPTIONS').find((t) => (t[0] ?? '').toUpperCase() === 'LINK_OFFSETS')
    return (r?.[1] ?? '').toUpperCase() === 'ELEVATION'
  }

  /** A link's offsets as heights above its nodes' inverts, whichever way the file gives them. */
  offsetDepths(attrs: Attrs): Record<string, number> {
    const keys = ['in_offset', 'out_offset', 'offset', 'crest_height'].filter((k) => k in attrs)
    const out: Record<string, number> = {}
    if (!this.offsetsAreElevations()) {
      for (const k of keys) out[`${k}_depth`] = Number(attrs[k] || 0)
      return out
    }
    const elev = (id: unknown) => Number(this.junctions.get(id as string)?.elevation ?? this.outfalls.get(id as string)?.elevation ?? this.storage.get(id as string)?.elevation ?? 0)
    for (const k of keys) {
      const ref = k === 'out_offset' ? elev(attrs.to_node) : elev(attrs.from_node)
      const v = Number(attrs[k])
      // "*" means at the invert; an elevation below the invert is the invert.
      out[`${k}_depth`] = Number.isFinite(v) && attrs[k] !== '' && attrs[k] != null ? Math.max(0, v - ref) : 0
    }
    return out
  }

  allLinks(): Map<string, Attrs> {
    const m = new Map<string, Attrs>()
    for (const [k, a] of this.conduits) m.set(k, { ...a, link_kind: 'conduit' })
    for (const [k, a] of this.pumps) m.set(k, { ...a, link_kind: 'pump' })
    for (const [k, a] of this.orifices) m.set(k, { ...a, link_kind: 'orifice' })
    for (const [k, a] of this.weirs) m.set(k, { ...a, link_kind: 'weir' })
    for (const [k, a] of this.outlets) m.set(k, { ...a, link_kind: 'outlet' })
    return m
  }

  /** First token → rest, for [OPTIONS]-like sections (keys upper-cased). */
  options(): Record<string, string> {
    const o: Record<string, string> = {}
    for (const t of this.rows('OPTIONS')) if (t.length >= 2) o[t[0].toUpperCase()] = t[1]
    return o
  }
}

export function splitSections(text: string): { lines: string[]; sections: ParsedModel['sections'] } {
  const lines = text.split(/(?<=\n)/)
  const sections: ParsedModel['sections'] = {}
  let current: string | null = null
  lines.forEach((raw, i) => {
    const s = raw.trim()
    if (s.startsWith('[') && s.endsWith(']')) {
      const name = s.slice(1, -1)
      current = SECTION_ALIASES[name.toUpperCase()] ?? name
      return
    }
    if (current === null) return
    ;(sections[current] ??= []).push({ idx: i, raw })
  })
  return { lines, sections }
}

export function parseInp(text: string): ParsedModel {
  const m = new ParsedModel()
  const { lines, sections } = splitSections(text)
  m.lines = lines
  m.sections = sections

  for (const t of m.rows('MAP')) {
    if (t.length >= 5 && t[0].toUpperCase() === 'DIMENSIONS') {
      const v = t.slice(1, 5).map((x) => f(x))
      if (v.every((x) => x !== null)) m.mapBounds = v as [number, number, number, number]
    }
  }
  const pts = (sec: string, into: Map<string, XY[]> | null, single: Map<string, XY> | null) => {
    for (const t of m.rows(sec)) {
      if (t.length < 3) continue
      const x = f(t[1])
      const y = f(t[2])
      if (x === null || y === null) continue
      if (single) single.set(t[0], [x, y])
      else into!.set(t[0], [...(into!.get(t[0]) ?? []), [x, y]])
    }
  }
  pts('COORDINATES', null, m.coordinates)
  pts('VERTICES', m.vertices, null)
  pts('Polygons', m.polygons, null)
  pts('POLYGONS', m.polygons, null)

  for (const t of m.rows('JUNCTIONS')) {
    if (t.length < 2) continue
    m.junctions.set(t[0], {
      id: t[0],
      elevation: f(t[1], 0),
      max_depth: fz(t, 2),
      init_depth: fz(t, 3),
      sur_depth: fz(t, 4),
      aponded: fz(t, 5),
    })
  }
  for (const t of m.rows('OUTFALLS')) {
    if (t.length < 2) continue
    const otype = (t[2] ?? 'FREE').toUpperCase()
    const a: Attrs = { id: t[0], elevation: f(t[1], 0), type: otype, stage_data: '', gated: 'NO', route_to: '', max_depth: 0 }
    if (otype === 'FREE' || otype === 'NORMAL') {
      if (t.length > 3) a.gated = t[3]
      if (t.length > 4) a.route_to = t[4]
    } else {
      if (t.length > 3) a.stage_data = t[3]
      if (t.length > 4) a.gated = t[4]
      if (t.length > 5) a.route_to = t[5]
    }
    m.outfalls.set(t[0], a)
  }
  for (const t of m.rows('STORAGE')) {
    if (t.length < 3) continue
    const shape = (t[4] ?? 'TABULAR').toUpperCase()
    const a: Attrs = {
      id: t[0], elevation: f(t[1], 0), max_depth: f(t[2], 0), init_depth: fz(t, 3), shape,
      curve: '', coeff_a: 0, coeff_b: 0, coeff_c: 0, coeff_d: 0, fevap: 0,
    }
    if (shape === 'TABULAR') {
      if (t.length > 5) a.curve = t[5]
      if (t.length > 6) a.fevap = f(t[6], 0)
    } else if (shape === 'FUNCTIONAL') {
      ;['coeff_a', 'coeff_b', 'coeff_c', 'coeff_d', 'fevap'].forEach((k, i) => {
        if (t.length > 5 + i) a[k] = f(t[5 + i], 0)
      })
    } else if (t.length > 5) a.curve = t.slice(5).join(' ')
    m.storage.set(t[0], a)
  }
  for (const t of m.rows('CONDUITS')) {
    if (t.length < 3) continue
    m.conduits.set(t[0], {
      id: t[0], from_node: t[1], to_node: t[2], length: fz(t, 3),
      roughness: t.length > 4 ? f(t[4], 0.01) : 0.01,
      in_offset: fz(t, 5), out_offset: fz(t, 6), init_flow: fz(t, 7), max_flow: fz(t, 8),
    })
  }
  for (const t of m.rows('PUMPS')) {
    if (t.length < 3) continue
    m.pumps.set(t[0], {
      id: t[0], from_node: t[1], to_node: t[2], pump_curve: t[3] ?? '*',
      status: (t[4] ?? 'ON').toUpperCase(), startup: fz(t, 5), shutoff: fz(t, 6),
    })
  }
  for (const t of m.rows('ORIFICES')) {
    if (t.length < 3) continue
    m.orifices.set(t[0], {
      id: t[0], from_node: t[1], to_node: t[2], orifice_type: (t[3] ?? 'SIDE').toUpperCase(),
      offset: fz(t, 4), qcoeff: t.length > 5 ? f(t[5], 0.65) : 0.65,
      gated: (t[6] ?? 'NO').toUpperCase(), close_time: fz(t, 7),
    })
  }
  for (const t of m.rows('WEIRS')) {
    if (t.length < 3) continue
    m.weirs.set(t[0], {
      id: t[0], from_node: t[1], to_node: t[2], weir_type: (t[3] ?? 'TRANSVERSE').toUpperCase(),
      crest_height: fz(t, 4), qcoeff: t.length > 5 ? f(t[5], 3.33) : 3.33,
      gated: (t[6] ?? 'NO').toUpperCase(), end_con: fz(t, 7), end_coeff: fz(t, 8),
    })
  }
  for (const t of m.rows('OUTLETS')) {
    if (t.length < 3) continue
    const otype = (t[4] ?? 'FUNCTIONAL/DEPTH').toUpperCase()
    const a: Attrs = {
      id: t[0], from_node: t[1], to_node: t[2], offset: fz(t, 3), outlet_type: otype,
      qcoeff_or_curve: t[5] ?? '1.0', qexpon: 0.5, gated: 'NO',
    }
    if (otype.includes('FUNCTIONAL')) {
      a.qexpon = t.length > 6 ? f(t[6], 0.5) : 0.5
      a.gated = (t[7] ?? 'NO').toUpperCase()
    } else a.gated = (t[6] ?? 'NO').toUpperCase()
    m.outlets.set(t[0], a)
  }
  for (const t of m.rows('SUBCATCHMENTS')) {
    if (t.length < 5) continue
    m.subcatchments.set(t[0], {
      id: t[0], raingage: t[1], outlet: t[2], area: f(t[3], 0), pct_imperv: f(t[4], 0),
      width: fz(t, 5), slope: fz(t, 6), curb_len: fz(t, 7), snow_pack: t[8] ?? '',
    })
  }
  for (const t of m.rows('SUBAREAS')) {
    const sc = m.subcatchments.get(t[0])
    if (t.length < 2 || !sc) continue
    Object.assign(sc, {
      n_imperv: f(t[1], 0), n_perv: fz(t, 2), s_imperv: fz(t, 3), s_perv: fz(t, 4), pct_zero: fz(t, 5),
      subarea_route_to: t[6] ?? 'OUTLET', pct_routed: t.length > 7 ? f(t[7], 100) : 100,
    })
  }
  for (const t of m.rows('INFILTRATION')) {
    const sc = m.subcatchments.get(t[0])
    if (t.length < 2 || !sc) continue
    Object.assign(sc, { infil_p1: f(t[1], 0), infil_p2: fz(t, 2), infil_p3: fz(t, 3), infil_p4: fz(t, 4), infil_p5: fz(t, 5) })
  }
  for (const t of m.rows('XSECTIONS')) {
    if (t.length < 3) continue
    m.xsections.set(t[0], {
      id: t[0], shape: t[1], geom1: f(t[2], 0), geom2: fz(t, 3), geom3: fz(t, 4), geom4: fz(t, 5),
      barrels: t.length > 6 ? f(t[6], 1) : 1,
    })
  }
  return m
}

function linkCoords(m: ParsedModel, id: string, from: string, to: string): number[][] {
  const c: number[][] = []
  const a = m.coordinates.get(from)
  if (a) c.push([...a])
  for (const v of m.vertices.get(id) ?? []) c.push([...v])
  const b = m.coordinates.get(to)
  if (b) c.push([...b])
  return c
}

function simplifyRing(ring: XY[], tol = 2.0): number[][] {
  if (ring.length <= 4) return ring.map(([x, y]) => [x, y])
  const out: number[][] = [[...ring[0]]]
  let last = ring[0]
  for (const pt of ring.slice(1, -1)) {
    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= tol) {
      out.push([pt[0], pt[1]])
      last = pt
    }
  }
  const end = ring[ring.length - 1]
  out.push([end[0], end[1]])
  if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) out.push([...out[0]])
  return out
}

const sameXY = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1]

export function toGeojson(m: ParsedModel) {
  const features: unknown[] = []
  for (const [sid, attrs] of m.subcatchments) {
    const ring = m.polygons.get(sid) ?? []
    if (ring.length < 3) continue
    const coords = simplifyRing(ring)
    if (!sameXY(coords[0], coords[coords.length - 1])) coords.push([...coords[0]])
    features.push({
      type: 'Feature', id: `subcatchment:${sid}`,
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: { object_type: 'subcatchment', id: sid, ...attrs },
    })
  }
  for (const [lid, attrs] of m.allLinks()) {
    const line = linkCoords(m, lid, attrs.from_node as string, attrs.to_node as string)
    if (line.length < 2) continue
    const xs = m.xsections.get(lid) ?? {}
    features.push({
      type: 'Feature', id: `link:${lid}`,
      geometry: { type: 'LineString', coordinates: line },
      properties: { object_type: 'link', id: lid, diameter: xs.geom1 ?? null, shape: xs.shape ?? null, ...attrs, ...m.offsetDepths(attrs) },
    })
  }
  for (const [nid, attrs] of m.allNodes()) {
    const c = m.coordinates.get(nid)
    if (!c) continue
    features.push({
      type: 'Feature', id: `node:${nid}`,
      geometry: { type: 'Point', coordinates: [c[0], c[1]] },
      properties: { object_type: 'node', id: nid, x: c[0], y: c[1], ...attrs },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function networkPayload(m: ParsedModel, crs: string) {
  let bounds: Record<string, number> | null = null
  if (m.coordinates.size) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    for (const [x, y] of m.coordinates.values()) {
      if (x < minx) minx = x
      if (y < miny) miny = y
      if (x > maxx) maxx = x
      if (y > maxy) maxy = y
    }
    bounds = { minx, miny, maxx, maxy }
  } else if (m.mapBounds) {
    const [minx, miny, maxx, maxy] = m.mapBounds
    bounds = { minx, miny, maxx, maxy }
  }
  return {
    crs,
    bounds,
    geojson: toGeojson(m),
    counts: {
      nodes: m.allNodes().size, links: m.allLinks().size, subcatchments: m.subcatchments.size,
      coordinates: m.coordinates.size, junctions: m.junctions.size, outfalls: m.outfalls.size,
      storage: m.storage.size, conduits: m.conduits.size, pumps: m.pumps.size, orifices: m.orifices.size,
      weirs: m.weirs.size, outlets: m.outlets.size,
    },
  }
}

export class NotFound extends Error {
  status = 404
}

export function getObject(m: ParsedModel, type: string, id: string) {
  if (type === 'node') {
    const n = m.allNodes().get(id)
    if (!n) throw new NotFound(`Node not found: ${id}`)
    const attrs: Attrs = { ...n }
    const c = m.coordinates.get(id)
    let geometry = null
    if (c) {
      attrs.x = c[0]
      attrs.y = c[1]
      geometry = { type: 'Point', coordinates: [c[0], c[1]] }
    }
    return { object_type: 'node', id, attributes: attrs, geometry }
  }
  if (type === 'link') {
    const l = m.allLinks().get(id)
    if (!l) throw new NotFound(`Link not found: ${id}`)
    const xs = m.xsections.get(id) ?? {}
    const attrs: Attrs = {
      ...l, diameter: xs.geom1 ?? null, shape: xs.shape ?? null, geom1: xs.geom1 ?? null, geom2: xs.geom2 ?? null,
      geom3: xs.geom3 ?? null, geom4: xs.geom4 ?? null, barrels: xs.barrels ?? 1,
      vertices: (m.vertices.get(id) ?? []).map(([x, y]) => [x, y]),
    }
    const line = linkCoords(m, id, l.from_node as string, l.to_node as string)
    return { object_type: 'link', id, attributes: attrs, geometry: line.length ? { type: 'LineString', coordinates: line } : null }
  }
  if (type === 'subcatchment') {
    const s = m.subcatchments.get(id)
    if (!s) throw new NotFound(`Subcatchment not found: ${id}`)
    const ring = m.polygons.get(id) ?? []
    let geometry = null
    if (ring.length >= 3) {
      const coords = ring.map(([x, y]) => [x, y])
      if (!sameXY(coords[0], coords[coords.length - 1])) coords.push([...coords[0]])
      geometry = { type: 'Polygon', coordinates: [coords] }
    }
    return { object_type: 'subcatchment', id, attributes: { ...s }, geometry }
  }
  throw Object.assign(new Error(`Unknown object type: ${type}`), { status: 400 })
}

export function simulationWindow(m: ParsedModel) {
  const o = m.options()
  const sd = o.START_DATE ?? null
  const st = o.START_TIME ?? '00:00:00'
  const ed = o.END_DATE ?? null
  const et = o.END_TIME ?? '00:00:00'
  const rsd = o.REPORT_START_DATE ?? sd
  const rst = o.REPORT_START_TIME ?? st
  let threads = 1
  if (o.THREADS !== undefined) {
    const v = Number(o.THREADS)
    threads = Number.isFinite(v) ? Math.trunc(v) : 1
  }
  if (threads < 0) threads = 1
  const combine = (d: string | null, t: string | null) => (d ? `${d} ${t || '00:00:00'}` : null)
  return {
    start: combine(sd, st), end: combine(ed, et), report_start: combine(rsd, rst),
    start_date: sd, start_time: st, end_date: ed, end_time: et, threads,
    cpu_count: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1,
    report_step: o.REPORT_STEP ?? null, routing_step: o.ROUTING_STEP ?? null, flow_routing: o.FLOW_ROUTING ?? null,
  }
}

// ---------------------------------------------------------------- profile
export type ProfileResults = {
  depths: Map<string, number>
  heads: Map<string, number>
  flood?: Map<string, number>
  maxDepth?: Map<string, number>
  flow?: Map<string, number>
  maxFlow?: Map<string, number>
}

export function buildProfile(
  m: ParsedModel,
  start: string,
  end: string,
  results?: ProfileResults,
  via: string[] = [],
) {
  const nodes = m.allNodes()
  const links = m.allLinks()
  const adj = new Map<string, [string, string, number][]>()
  for (const [lid, a] of links) {
    const fa = a.from_node as string
    const tb = a.to_node as string
    let length = Number(a.length || 0)
    if (length <= 0) {
      const ca = m.coordinates.get(fa)
      const cb = m.coordinates.get(tb)
      length = ca && cb ? Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) : 1
    }
    if (!adj.has(fa)) adj.set(fa, [])
    if (!adj.has(tb)) adj.set(tb, [])
    adj.get(fa)!.push([tb, lid, length])
    adj.get(tb)!.push([fa, lid, length])
  }
  const shortest = (from: string, to: string): [string[], string[], number[]] => {
    if (!adj.has(from)) throw new NotFound(`Start node not in network: ${from}`)
    if (!adj.has(to)) throw new NotFound(`End node not in network: ${to}`)
    const dist = new Map<string, number>([[from, 0]])
    const prev = new Map<string, [string, string, number]>()
    const pq: [number, string][] = [[0, from]]
    while (pq.length) {
      pq.sort((x, y) => x[0] - y[0])
      const [d, u] = pq.shift()!
      if (u === to) break
      if (d > (dist.get(u) ?? 1e100)) continue
      for (const [v, lid, len] of adj.get(u) ?? []) {
        const nd = d + len
        if (nd < (dist.get(v) ?? 1e100)) {
          dist.set(v, nd)
          prev.set(v, [u, lid, len])
          pq.push([nd, v])
        }
      }
    }
    if (!dist.has(to)) throw new NotFound(`No path found between ${from} and ${to}`)
    const n = [to]
    const l: string[] = []
    const d: number[] = []
    let cur = to
    while (cur !== from) {
      const [u, lid, len] = prev.get(cur)!
      l.push(lid)
      d.push(len)
      n.push(u)
      cur = u
    }
    return [n.reverse(), l.reverse(), d.reverse()]
  }
  const stops = [start, ...via.filter(Boolean), end]
  const pn: string[] = [start]
  const pl: string[] = []
  const lens: number[] = []
  for (let i = 0; i + 1 < stops.length; i++) {
    if (stops[i] === stops[i + 1]) continue
    const [n, l, d] = shortest(stops[i]!, stops[i + 1]!)
    pn.push(...n.slice(1))
    pl.push(...l)
    lens.push(...d)
  }

  const outNodes: unknown[] = []
  const outLinks: unknown[] = []
  let distance = 0
  pn.forEach((nid, i) => {
    const a = nodes.get(nid) ?? { elevation: 0, max_depth: 0 }
    const elev = Number(a.elevation || 0)
    const maxDepth = Number(a.max_depth || 0)
    const ground = maxDepth ? elev + maxDepth : elev
    const dep = results?.depths.get(nid)
    const water = dep !== undefined ? elev + dep : null
    let hgl: number | null = results?.heads.get(nid) ?? null
    if (hgl === null && water !== null) hgl = water
    const xy = m.coordinates.get(nid)
    outNodes.push({
      id: nid, distance, elevation: elev, max_depth: maxDepth, ground, water_surface: water, hgl,
      x: xy ? xy[0] : null, y: xy ? xy[1] : null,
      node_kind: a.node_kind ?? null,
      max_hgl: results?.maxDepth?.has(nid) ? elev + results.maxDepth.get(nid)! : null,
      flooding: results?.flood?.get(nid) ?? null,
    })
    if (i < pl.length) {
      const lid = pl[i]
      const length = lens[i]
      const la = links.get(lid) ?? {}
      const xs = m.xsections.get(lid) ?? {}
      // Heights above the node inverts, also when the file gives elevations.
      const od = m.offsetDepths(la)
      const inOff = od.in_offset_depth ?? 0
      const outOff = od.out_offset_depth ?? 0
      const fromN = la.from_node
      const toN = la.to_node
      const next = pn[i + 1]
      const elevOf = (k: unknown) => Number(nodes.get(k as string)?.elevation || 0)
      let us: number, ds: number
      if (fromN === nid && toN === next) {
        us = elev + inOff
        ds = elevOf(toN) + outOff
      } else if (toN === nid && fromN === next) {
        us = elev + outOff
        ds = elevOf(fromN) + inOff
      } else {
        us = elev + inOff
        ds = elevOf(next) + outOff
      }
      let diam = xs.geom1 != null ? Number(xs.geom1) : null
      if (diam === null || diam <= 0) diam = 0.3
      outLinks.push({
        id: lid, from_node: nid, to_node: next, length, start_distance: distance, end_distance: distance + length,
        invert_us: us, invert_ds: ds, diameter: diam, crown_us: us + diam, crown_ds: ds + diam,
        link_kind: la.link_kind ?? null, shape: xs.shape ?? null,
        flow: results?.flow?.get(lid) ?? null, max_flow: results?.maxFlow?.get(lid) ?? null,
        reversed: !(fromN === nid && toN === next),
      })
      distance += length
    }
  })
  const fu = (m.options().FLOW_UNITS ?? 'CMS').toUpperCase()
  return {
    start, end, via, length_unit: ['CFS', 'GPM', 'MGD'].includes(fu) ? 'ft' : 'm', flow_unit: fu,
    total_length: distance, nodes: outNodes, links: outLinks, path_node_ids: pn, path_link_ids: pl,
  }
}
