/**
 * SWMM water quality sections as plain objects, and back:
 * [POLLUTANTS], [LANDUSES], [BUILDUP], [WASHOFF], [COVERAGES].
 * Formats follow the SWMM 5 input file reference (Appendix D).
 */

export type Row = { values: string[]; comment: string }

export type Pollutant = {
  name: string
  units: string // MG/L, UG/L, #/L
  rain: string
  gw: string
  rdii: string
  decay: string
  snowOnly: string // YES / NO
  coPoll: string // * for none
  coFrac: string
  dwf: string
  init: string
}
export type LandUse = { name: string; sweepInterval: string; availability: string; lastSwept: string }
export type Buildup = { landuse: string; pollutant: string; fn: string; c1: string; c2: string; c3: string; perUnit: string }
export type Washoff = { landuse: string; pollutant: string; fn: string; c1: string; c2: string; sweep: string; bmp: string }
/** Subcatchment → land use → percent of its area. */
export type Coverage = Record<string, Record<string, string>>

const v = (r: Row, i: number, d = '') => (r.values[i] ?? d).trim()

export function parsePollutants(rows: Row[]): Pollutant[] {
  return rows
    .filter((r) => v(r, 0))
    .map((r) => ({
      name: v(r, 0),
      units: v(r, 1, 'MG/L').toUpperCase(),
      rain: v(r, 2, '0'),
      gw: v(r, 3, '0'),
      rdii: v(r, 4, '0'),
      decay: v(r, 5, '0'),
      snowOnly: v(r, 6, 'NO').toUpperCase(),
      coPoll: v(r, 7, '*'),
      coFrac: v(r, 8, '0'),
      dwf: v(r, 9, '0'),
      init: v(r, 10, '0'),
    }))
}
export const serializePollutants = (ps: Pollutant[]): Row[] =>
  ps.map((p) => ({
    values: [p.name, p.units || 'MG/L', p.rain || '0', p.gw || '0', p.rdii || '0', p.decay || '0', p.snowOnly || 'NO', p.coPoll || '*', p.coFrac || '0', p.dwf || '0', p.init || '0'],
    comment: '',
  }))

export const parseLandUses = (rows: Row[]): LandUse[] =>
  rows.filter((r) => v(r, 0)).map((r) => ({ name: v(r, 0), sweepInterval: v(r, 1, '0'), availability: v(r, 2, '0'), lastSwept: v(r, 3, '0') }))
export const serializeLandUses = (ls: LandUse[]): Row[] =>
  ls.map((l) => ({ values: [l.name, l.sweepInterval || '0', l.availability || '0', l.lastSwept || '0'], comment: '' }))

export const parseBuildup = (rows: Row[]): Buildup[] =>
  rows
    .filter((r) => v(r, 0) && v(r, 1))
    .map((r) => ({ landuse: v(r, 0), pollutant: v(r, 1), fn: v(r, 2, 'NONE').toUpperCase(), c1: v(r, 3, '0'), c2: v(r, 4, '0'), c3: v(r, 5, '0'), perUnit: v(r, 6, 'AREA').toUpperCase() }))
/** NONE rows add nothing to the model, so they aren't written. */
export const serializeBuildup = (bs: Buildup[]): Row[] =>
  bs
    .filter((b) => b.fn && b.fn !== 'NONE')
    .map((b) => ({ values: [b.landuse, b.pollutant, b.fn, b.c1 || '0', b.c2 || '0', b.c3 || '0', b.perUnit || 'AREA'], comment: '' }))

export const parseWashoff = (rows: Row[]): Washoff[] =>
  rows
    .filter((r) => v(r, 0) && v(r, 1))
    .map((r) => ({ landuse: v(r, 0), pollutant: v(r, 1), fn: v(r, 2, 'EMC').toUpperCase(), c1: v(r, 3, '0'), c2: v(r, 4, '0'), sweep: v(r, 5, '0'), bmp: v(r, 6, '0') }))
export const serializeWashoff = (ws: Washoff[]): Row[] =>
  ws
    .filter((w) => w.fn && w.fn !== 'NONE')
    .map((w) => ({ values: [w.landuse, w.pollutant, w.fn, w.c1 || '0', w.c2 || '0', w.sweep || '0', w.bmp || '0'], comment: '' }))

/** A [COVERAGES] line may hold several land use / percent pairs. */
export function parseCoverages(rows: Row[]): Coverage {
  const out: Coverage = {}
  for (const r of rows) {
    const sub = v(r, 0)
    if (!sub) continue
    for (let i = 1; i + 1 < r.values.length; i += 2) {
      const lu = v(r, i)
      if (lu) (out[sub] ??= {})[lu] = v(r, i + 1, '0')
    }
  }
  return out
}
export function serializeCoverages(c: Coverage, subOrder: string[]): Row[] {
  const subs = [...subOrder.filter((s) => c[s]), ...Object.keys(c).filter((s) => !subOrder.includes(s))]
  const rows: Row[] = []
  for (const s of subs) {
    const pairs = Object.entries(c[s] ?? {}).filter(([, p]) => p.trim() !== '' && Number(p) !== 0)
    if (pairs.length) rows.push({ values: [s, ...pairs.flat()], comment: '' })
  }
  return rows
}

export const coverageTotal = (row: Record<string, string> | undefined) =>
  Object.values(row ?? {}).reduce((t, p) => t + (Number(p) || 0), 0)

// ---------------------------------------------------------------- functions
export const BUILDUP_FNS: { key: string; label: string; help: string; coeffs: [string | null, string | null, string | null] }[] = [
  { key: 'NONE', label: 'None', help: 'No buildup on this land use.', coeffs: [null, null, null] },
  { key: 'POW', label: 'Power', help: 'Grows with time raised to a power, up to the maximum.', coeffs: ['Max buildup', 'Rate constant', 'Time exponent'] },
  { key: 'EXP', label: 'Exponential', help: 'Rises quickly at first, then levels off at the maximum.', coeffs: ['Max buildup', 'Rate constant (1/day)', null] },
  { key: 'SAT', label: 'Saturation', help: 'Reaches half the maximum after the half-saturation time.', coeffs: ['Max buildup', null, 'Half-saturation time (days)'] },
  { key: 'EXT', label: 'From a time series', help: 'Buildup rate read from a time series, up to the maximum.', coeffs: ['Max buildup', 'Scaling factor', 'Time series'] },
]
export const WASHOFF_FNS: { key: string; label: string; help: string; coeffs: [string | null, string | null] }[] = [
  { key: 'NONE', label: 'None', help: 'No washoff from this land use.', coeffs: [null, null] },
  { key: 'EMC', label: 'Event mean concentration', help: 'Runoff always carries the same concentration.', coeffs: ['Concentration', null] },
  { key: 'EXP', label: 'Exponential', help: 'Washes off in proportion to runoff rate and what has built up.', coeffs: ['Coefficient', 'Exponent'] },
  { key: 'RC', label: 'Rating curve', help: 'Load depends on runoff rate alone.', coeffs: ['Coefficient', 'Exponent'] },
]

/** Rename a pollutant or land use everywhere it is used. */
export function renameEverywhere(
  kind: 'pollutant' | 'landuse',
  from: string,
  to: string,
  data: { pollutants: Pollutant[]; buildup: Buildup[]; washoff: Washoff[]; coverage: Coverage },
) {
  const { pollutants, buildup, washoff, coverage } = data
  if (kind === 'pollutant') {
    return {
      pollutants: pollutants.map((p) => ({ ...p, coPoll: p.coPoll === from ? to : p.coPoll })),
      buildup: buildup.map((b) => (b.pollutant === from ? { ...b, pollutant: to } : b)),
      washoff: washoff.map((w) => (w.pollutant === from ? { ...w, pollutant: to } : w)),
      coverage,
    }
  }
  const cov: Coverage = {}
  for (const [s, m] of Object.entries(coverage)) cov[s] = Object.fromEntries(Object.entries(m).map(([lu, p]) => [lu === from ? to : lu, p]))
  return {
    pollutants,
    buildup: buildup.map((b) => (b.landuse === from ? { ...b, landuse: to } : b)),
    washoff: washoff.map((w) => (w.landuse === from ? { ...w, landuse: to } : w)),
    coverage: cov,
  }
}
