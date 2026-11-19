/**
 * SWMM binary output (.out) reader for EPA SWMM 5 and OpenSWMM 6 files, plus a
 * port of the result endpoints in backend/app/services/output_service.py.
 *
 * Layout: 7-int header, object IDs, input properties, the reporting-variable
 * codes, start date (double, days since 1899-12-30) and report step (int s),
 * then one record per period (double date + float32 values), and a closing
 * record of 6 ints holding the section offsets.
 */

import T from './tables.json'

const MAGIC = 516114522
const FLOW_UNITS = ['CFS', 'GPM', 'MGD', 'CMS', 'LPS', 'MLD']
type Kind = 'node' | 'link' | 'subcatchment'
const VARS = T.out_vars as Record<Kind, [string, string, string][]>
// index of each variable in the file's per-object record
const VAR_INDEX: Record<Kind, Record<string, number>> = {
  subcatchment: { rainfall: 0, snow_depth: 1, evap: 2, infil: 3, runoff: 4, gw_flow: 5, gw_elev: 6, soil_moist: 7 },
  node: { depth: 0, head: 1, volume: 2, lateral_inflow: 3, total_inflow: 4, overflow: 5 },
  link: { flow: 0, depth: 1, velocity: 2, volume: 3, capacity: 4 },
}
const DEFAULT_VAR: Record<Kind, string> = { node: 'depth', link: 'flow', subcatchment: 'runoff' }

function amax(a: number[]) {
  let m = -Infinity
  for (const v of a) if (v > m) m = v
  return a.length ? m : 0
}
function amin(a: number[]) {
  let m = Infinity
  for (const v of a) if (v < m) m = v
  return a.length ? m : 0
}
function aabsmax(a: number[]) {
  let m = 0
  for (const v of a) if (Math.abs(v) > m) m = Math.abs(v)
  return m
}

export class OutError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function unitFor(key: string, flowUnits: string) {
  const us = ['CFS', 'GPM', 'MGD'].includes(flowUnits)
  switch (key) {
    case 'flow': return flowUnits
    case 'length': return us ? 'ft' : 'm'
    case 'velocity': return us ? 'ft/s' : 'm/s'
    case 'volume': return us ? 'ft³' : 'm³'
    case 'rainfall': return us ? 'in/hr' : 'mm/hr'
    default: return ''
  }
}

/** numpy.datetime64 text, e.g. 2024-06-01T00:05:00, from a time in ms. */
function isoSeconds(ms: number) {
  return new Date(Math.round(ms / 1000) * 1000).toISOString().slice(0, 19)
}

export class SwmmOut {
  readonly dv: DataView
  readonly flowUnits: string
  readonly version: number
  readonly nSub: number
  readonly nNode: number
  readonly nLink: number
  readonly nPoll: number
  readonly subIds: string[] = []
  readonly nodeIds: string[] = []
  readonly linkIds: string[] = []
  readonly nSubV: number
  readonly nNodeV: number
  readonly nLinkV: number
  readonly nSysV: number
  readonly startMs: number
  readonly stepSec: number
  readonly periods: number
  readonly resultsOffset: number
  readonly bytesPerPeriod: number
  private idx = { node: new Map<string, number>(), link: new Map<string, number>(), subcatchment: new Map<string, number>() }
  private envelopeCache: ReturnType<SwmmOut['computeEnvelope']> | null = null
  private peaksCache: ReturnType<SwmmOut['computePeaks']> | null = null

  constructor(buf: ArrayBuffer) {
    if (buf.byteLength < 52) throw new OutError(422, 'This file is too small to be a SWMM results (.out) file.')
    const dv = (this.dv = new DataView(buf))
    const i32 = (o: number) => dv.getInt32(o, true)
    const end = buf.byteLength
    if (i32(0) !== MAGIC || i32(end - 4) !== MAGIC)
      throw new OutError(422, 'This isn’t a complete SWMM results (.out) file. It may be from a run that didn’t finish.')
    const err = i32(end - 8)
    this.periods = i32(end - 12)
    this.resultsOffset = i32(end - 16)
    const idOffset = i32(end - 24)
    if (err !== 0) throw new OutError(422, `The run that wrote this file ended with SWMM error ${err}.`)
    this.version = i32(4)
    this.flowUnits = FLOW_UNITS[i32(8)] ?? 'CFS'
    this.nSub = i32(12)
    this.nNode = i32(16)
    this.nLink = i32(20)
    this.nPoll = i32(24)

    const td = new TextDecoder('latin1')
    let o = idOffset
    const readIds = (n: number, into: string[]) => {
      for (let k = 0; k < n; k++) {
        const len = i32(o)
        o += 4
        into.push(td.decode(new Uint8Array(buf, o, len)))
        o += len
      }
    }
    readIds(this.nSub, this.subIds)
    readIds(this.nNode, this.nodeIds)
    readIds(this.nLink, this.linkIds)
    this.subIds.forEach((id, k) => this.idx.subcatchment.set(id, k))
    this.nodeIds.forEach((id, k) => this.idx.node.set(id, k))
    this.linkIds.forEach((id, k) => this.idx.link.set(id, k))

    // Reporting variables sit just before the results: walk back from the
    // known end of that block (start date + step = 12 bytes).
    o = this.resultsOffset - 12
    this.startMs = (dv.getFloat64(o, true) - 25569) * 86400000
    this.stepSec = i32(o + 8)
    // Variable code lists: nSubV, codes, nNodeV, codes, nLinkV, codes, nSysV, codes.
    // Find them by reading forward from the property block end.
    const propOffset = i32(end - 20)
    let p = propOffset
    const skipProps = (n: number) => {
      const np = i32(p)
      p += 4 + 4 * np + 4 * np * n
    }
    skipProps(this.nSub)
    skipProps(this.nNode)
    skipProps(this.nLink)
    const readVars = () => {
      const nv = i32(p)
      p += 4 + 4 * nv
      return nv
    }
    this.nSubV = readVars()
    this.nNodeV = readVars()
    this.nLinkV = readVars()
    this.nSysV = readVars()
    this.bytesPerPeriod = 8 + 4 * (this.nSub * this.nSubV + this.nNode * this.nNodeV + this.nLink * this.nLinkV + this.nSysV)
  }

  get periodTimes(): string[] {
    return Array.from({ length: this.periods }, (_, p) => isoSeconds(this.startMs + (p + 1) * this.stepSec * 1000))
  }

  private base(kind: Kind, period: number) {
    let o = this.resultsOffset + period * this.bytesPerPeriod + 8
    if (kind === 'subcatchment') return o
    o += 4 * this.nSub * this.nSubV
    if (kind === 'node') return o
    return o + 4 * this.nNode * this.nNodeV
  }

  private stride(kind: Kind) {
    return kind === 'subcatchment' ? this.nSubV : kind === 'node' ? this.nNodeV : this.nLinkV
  }

  count(kind: Kind) {
    return kind === 'subcatchment' ? this.nSub : kind === 'node' ? this.nNode : this.nLink
  }

  ids(kind: Kind) {
    return kind === 'subcatchment' ? this.subIds : kind === 'node' ? this.nodeIds : this.linkIds
  }

  /** One variable for every object of a kind at one period. */
  result(kind: Kind, period: number, varIndex: number): number[] {
    const b = this.base(kind, period) + 4 * varIndex
    const s = 4 * this.stride(kind)
    const n = this.count(kind)
    const out = new Array<number>(n)
    for (let k = 0; k < n; k++) out[k] = this.dv.getFloat32(b + k * s, true)
    return out
  }

  /** One variable for one object over every period. */
  series(kind: Kind, index: number, varIndex: number): number[] {
    const off = this.base(kind, 0) + 4 * (index * this.stride(kind) + varIndex)
    const out = new Array<number>(this.periods)
    for (let p = 0; p < this.periods; p++) out[p] = this.dv.getFloat32(off + p * this.bytesPerPeriod, true)
    return out
  }

  indexOf(kind: Kind, id: string) {
    return this.idx[kind].get(id)
  }

  // --------------------------------------------- endpoint-shaped results
  metadata(path: string) {
    return {
      node_count: this.nNode, link_count: this.nLink, subcatchment_count: this.nSub,
      period_count: this.periods, report_step_sec: this.stepSec, path,
    }
  }

  variables(kind: Kind) {
    return { kind, variables: VARS[kind].map(([id, label, key]) => ({ id, label, unit: unitFor(key, this.flowUnits) })) }
  }

  seriesResponse(kind: Kind, id: string, variable?: string | null) {
    const i = this.indexOf(kind, id)
    if (i === undefined) throw new OutError(404, `${kind} id not found: ${id}`)
    if (this.periods < 1) throw new OutError(400, 'Output has no reporting periods')
    const v = (variable || DEFAULT_VAR[kind]).trim().toLowerCase()
    const meta = VARS[kind].find((r) => r[0] === v)
    if (!meta) throw new OutError(400, `Unknown ${kind} variable '${v}'. Allowed: ${VARS[kind].map((r) => r[0]).join(', ')}`)
    const values = this.series(kind, i, VAR_INDEX[kind][v])
    return {
      object_id: id, variable: v, variable_label: meta[1], unit: unitFor(meta[2], this.flowUnits),
      report_step_sec: this.stepSec, values, times_sec: values.map((_, k) => k * this.stepSec), times: this.periodTimes.slice(0, values.length),
    }
  }

  private computePeaks() {
    if (this.periods < 1)
      return { peak_depth_period: null, peak_depth_max: null, peak_time: null, peak_flow_max: null, peak_runoff_max: null }
    let bestP = 0
    let bestV = -Infinity
    let bestFlow = 0
    let bestRunoff = 0
    for (let p = 0; p < this.periods; p++) {
      const d = this.result('node', p, 0)
      if (d.length) {
        const m = amax(d)
        if (m > bestV) {
          bestV = m
          bestP = p
        }
      }
      for (const fl of this.result('link', p, 0)) bestFlow = Math.max(bestFlow, Math.abs(fl))
      for (const r of this.result('subcatchment', p, 4)) bestRunoff = Math.max(bestRunoff, Math.abs(r))
    }
    return {
      peak_depth_period: bestP, peak_depth_max: bestV > -Infinity ? bestV : 0, peak_time: this.periodTimes[bestP] ?? null,
      peak_flow_max: bestFlow, peak_runoff_max: bestRunoff,
    }
  }

  periodsResponse() {
    this.peaksCache ??= this.computePeaks()
    return { period_count: this.periods, report_step_sec: this.stepSec, times: this.periodTimes, ...this.peaksCache }
  }

  snapshot(period: number) {
    if (this.periods < 1) throw new OutError(400, 'Output has no reporting periods')
    if (!(period >= 0 && period < this.periods)) throw new OutError(400, `period must be in [0, ${this.periods - 1}]`)
    const depths = this.result('node', period, 0)
    const flows = this.result('link', period, 0)
    const runoffs = this.result('subcatchment', period, 4)
    return {
      period, time: this.periodTimes[period] ?? null, node_ids: this.nodeIds, link_ids: this.linkIds, subcatchment_ids: this.subIds,
      node_depths: depths, link_flows: flows, subcatchment_runoffs: runoffs,
      node_depth_min: amin(depths), node_depth_max: amax(depths),
      link_flow_min: amin(flows), link_flow_max: aabsmax(flows),
      subcatchment_runoff_min: amin(runoffs), subcatchment_runoff_max: aabsmax(runoffs),
    }
  }

  private computeEnvelope() {
    if (this.periods < 1) throw new OutError(400, 'Output has no reporting periods')
    const nodeMax = new Array<number>(this.nNode).fill(0)
    const linkMax = new Array<number>(this.nLink).fill(0)
    const runMax = new Array<number>(this.nSub).fill(0)
    for (let p = 0; p < this.periods; p++) {
      this.result('node', p, 0).forEach((d, i) => d > nodeMax[i] && (nodeMax[i] = d))
      this.result('link', p, 0).forEach((fl, i) => Math.abs(fl) > linkMax[i] && (linkMax[i] = Math.abs(fl)))
      this.result('subcatchment', p, 4).forEach((r, i) => Math.abs(r) > runMax[i] && (runMax[i] = Math.abs(r)))
    }
    const mn = amin
    const mx = amax
    return {
      period: -1, time: 'max envelope', node_ids: this.nodeIds, link_ids: this.linkIds, subcatchment_ids: this.subIds,
      node_depths: nodeMax, link_flows: linkMax, subcatchment_runoffs: runMax,
      node_depth_min: mn(nodeMax), node_depth_max: mx(nodeMax), link_flow_min: mn(linkMax), link_flow_max: mx(linkMax),
      subcatchment_runoff_min: mn(runMax), subcatchment_runoff_max: mx(runMax),
    }
  }

  envelope() {
    return (this.envelopeCache ??= this.computeEnvelope())
  }

  /** Results for profiles: values at one period plus run maxima. */
  profileResults(period: number | null) {
    const depths = new Map<string, number>()
    const heads = new Map<string, number>()
    const flood = new Map<string, number>()
    const flow = new Map<string, number>()
    if (period !== null && period >= 0 && period < this.periods) {
      const d = this.result('node', period, 0)
      const h = this.result('node', period, 1)
      const o = this.result('node', period, 5)
      const f = this.result('link', period, 0)
      this.nodeIds.forEach((id, i) => {
        depths.set(id, d[i])
        heads.set(id, h[i])
        flood.set(id, o[i])
      })
      this.linkIds.forEach((id, i) => flow.set(id, f[i]))
    }
    const env = this.periods > 0 ? this.envelope() : null
    const maxDepth = new Map(env ? env.node_ids.map((id, i) => [id, env.node_depths[i]] as const) : [])
    const maxFlow = new Map(env ? env.link_ids.map((id, i) => [id, env.link_flows[i]] as const) : [])
    return { depths, heads, flood, flow, maxDepth, maxFlow }
  }
}
