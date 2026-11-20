/**
 * SWMM low-impact development (LID) controls: [LID_CONTROLS] and [LID_USAGE].
 *
 * A design is one header line (Name Type) followed by one line per layer
 * (Name LAYER values…). This module turns those rows into designs with named,
 * unit-labelled parameters and back, without losing values it doesn't know.
 */

export type LidType = 'BC' | 'RG' | 'GR' | 'IT' | 'PP' | 'RB' | 'RD' | 'VS'
export type LidLayer = 'SURFACE' | 'PAVEMENT' | 'SOIL' | 'STORAGE' | 'DRAIN' | 'DRAINMAT' | 'REMOVALS'

type Row = { values: string[]; comment: string }

/** Unit kinds: depth (in | mm), rate (in/hr | mm/hr), or none. */
type U = 'depth' | 'rate' | 'frac' | '' | 'pct' | 'hr' | 'days' | 'n' | 'yesno' | 'curve'

export type ParamDef = { label: string; unit: U; help?: string; def: string }

export const LAYER_PARAMS: Record<Exclude<LidLayer, 'REMOVALS'>, ParamDef[]> = {
  SURFACE: [
    { label: 'Berm height', unit: 'depth', def: '6', help: 'Ponding depth before overflow' },
    { label: 'Vegetation volume', unit: 'frac', def: '0', help: 'Fraction of the ponded volume taken by plants' },
    { label: 'Surface roughness', unit: 'n', def: '0.1', help: "Manning's n for overland flow" },
    { label: 'Surface slope', unit: 'pct', def: '1' },
    { label: 'Swale side slope', unit: '', def: '5', help: 'Run over rise (swales only)' },
  ],
  PAVEMENT: [
    { label: 'Thickness', unit: 'depth', def: '6' },
    { label: 'Void ratio', unit: '', def: '0.15', help: 'Voids over solids' },
    { label: 'Impervious surface', unit: 'frac', def: '0', help: 'Fraction for modular blocks' },
    { label: 'Permeability', unit: 'rate', def: '100' },
    { label: 'Clogging factor', unit: '', def: '0', help: '0 = never clogs' },
    { label: 'Regeneration interval', unit: 'days', def: '0' },
    { label: 'Regeneration fraction', unit: 'frac', def: '0' },
  ],
  SOIL: [
    { label: 'Thickness', unit: 'depth', def: '12' },
    { label: 'Porosity', unit: 'frac', def: '0.5' },
    { label: 'Field capacity', unit: 'frac', def: '0.2' },
    { label: 'Wilting point', unit: 'frac', def: '0.1' },
    { label: 'Conductivity', unit: 'rate', def: '0.5' },
    { label: 'Conductivity slope', unit: '', def: '10' },
    { label: 'Suction head', unit: 'depth', def: '3.5' },
  ],
  STORAGE: [
    { label: 'Thickness', unit: 'depth', def: '12' },
    { label: 'Void ratio', unit: '', def: '0.75' },
    { label: 'Seepage rate', unit: 'rate', def: '0.5', help: 'Into the native soil below' },
    { label: 'Clogging factor', unit: '', def: '0' },
    { label: 'Covered', unit: 'yesno', def: 'YES', help: 'Rain barrels only' },
  ],
  DRAIN: [
    { label: 'Flow coefficient', unit: '', def: '0', help: '0 = no underdrain' },
    { label: 'Flow exponent', unit: '', def: '0.5' },
    { label: 'Offset height', unit: 'depth', def: '6', help: 'Drain height above the bottom' },
    { label: 'Drain delay', unit: 'hr', def: '6', help: 'Rain barrels only' },
    { label: 'Open level', unit: 'depth', def: '0' },
    { label: 'Close level', unit: 'depth', def: '0' },
    { label: 'Control curve', unit: 'curve', def: '' },
  ],
  DRAINMAT: [
    { label: 'Thickness', unit: 'depth', def: '3' },
    { label: 'Void fraction', unit: 'frac', def: '0.5' },
    { label: 'Roughness', unit: 'n', def: '0.1' },
  ],
}

export const LAYER_LABEL: Record<LidLayer, string> = {
  SURFACE: 'Surface',
  PAVEMENT: 'Pavement',
  SOIL: 'Soil',
  STORAGE: 'Storage',
  DRAIN: 'Underdrain',
  DRAINMAT: 'Drainage mat',
  REMOVALS: 'Pollutant removal',
}

export const LID_TYPES: Record<LidType, { label: string; layers: LidLayer[]; optional?: LidLayer[]; color: string; blurb: string }> = {
  BC: { label: 'Bio-retention cell', layers: ['SURFACE', 'SOIL', 'STORAGE', 'DRAIN'], color: '#16a34a', blurb: 'Planted depression over engineered soil and gravel.' },
  RG: { label: 'Rain garden', layers: ['SURFACE', 'SOIL'], optional: ['STORAGE'], color: '#65a30d', blurb: 'Bio-retention without an underdrain.' },
  GR: { label: 'Green roof', layers: ['SURFACE', 'SOIL', 'DRAINMAT'], color: '#15803d', blurb: 'Soil and plants over a drainage mat on a roof.' },
  IT: { label: 'Infiltration trench', layers: ['SURFACE', 'STORAGE', 'DRAIN'], color: '#a16207', blurb: 'Gravel-filled trench that soaks runoff into the ground.' },
  PP: { label: 'Permeable pavement', layers: ['SURFACE', 'PAVEMENT', 'STORAGE', 'DRAIN'], optional: ['SOIL'], color: '#64748b', blurb: 'Porous paving over a gravel storage bed.' },
  RB: { label: 'Rain barrel', layers: ['STORAGE', 'DRAIN'], color: '#0891b2', blurb: 'Tank that collects roof runoff and releases it later.' },
  RD: { label: 'Rooftop disconnection', layers: ['SURFACE', 'DRAIN'], color: '#0e7490', blurb: 'Downspouts sent to pervious ground instead of the sewer.' },
  VS: { label: 'Vegetative swale', layers: ['SURFACE'], color: '#4d7c0f', blurb: 'Grassed channel that slows and soaks up runoff.' },
}

export type LidDesign = {
  name: string
  type: LidType
  /** Layer values as written in the file (strings, to round-trip exactly). */
  layers: Partial<Record<LidLayer, string[]>>
  comment: string
}

export type LidUse = {
  subcatchment: string
  lid: string
  number: string
  area: string
  width: string
  initSat: string
  fromImp: string
  toPerv: string
  rptFile: string
  drainTo: string
  fromPerv: string
}

const isType = (v: string): v is LidType => v.toUpperCase() in LID_TYPES

export function parseLidControls(rows: Row[]): LidDesign[] {
  const out: LidDesign[] = []
  const byName = new Map<string, LidDesign>()
  for (const r of rows) {
    const [name, second, ...rest] = r.values
    if (!name || !second) continue
    const up = second.toUpperCase()
    if (rest.length === 0 && isType(up)) {
      const d: LidDesign = { name, type: up as LidType, layers: {}, comment: r.comment }
      byName.set(name, d)
      out.push(d)
      continue
    }
    const d = byName.get(name)
    if (!d) continue
    if (up === 'REMOVALS') d.layers.REMOVALS = [...(d.layers.REMOVALS ?? []), ...rest]
    else d.layers[up as LidLayer] = rest
  }
  return out
}

export function serializeLidControls(designs: LidDesign[]): Row[] {
  const rows: Row[] = []
  for (const d of designs) {
    rows.push({ values: [d.name, d.type], comment: d.comment })
    const order: LidLayer[] = ['SURFACE', 'PAVEMENT', 'SOIL', 'STORAGE', 'DRAIN', 'DRAINMAT', 'REMOVALS']
    for (const layer of order) {
      const v = d.layers[layer]
      if (!v || (layer === 'REMOVALS' && v.length === 0)) continue
      rows.push({ values: [d.name, layer, ...trimTrailingDefaults(layer, v)], comment: '' })
    }
  }
  return rows
}

/** Drop empty trailing optional values so SWMM 5.1 files stay valid. */
function trimTrailingDefaults(layer: LidLayer, v: string[]): string[] {
  const out = [...v]
  while (out.length && out[out.length - 1] === '') out.pop()
  if (layer === 'REMOVALS') return out
  return out
}

export function parseLidUsage(rows: Row[]): LidUse[] {
  return rows
    .filter((r) => r.values.length >= 2)
    .map((r) => {
      const v = r.values
      return {
        subcatchment: v[0] ?? '',
        lid: v[1] ?? '',
        number: v[2] ?? '1',
        area: v[3] ?? '0',
        width: v[4] ?? '0',
        initSat: v[5] ?? '0',
        fromImp: v[6] ?? '0',
        toPerv: v[7] ?? '0',
        rptFile: v[8] ?? '',
        drainTo: v[9] ?? '',
        fromPerv: v[10] ?? '',
      }
    })
}

export function serializeLidUsage(uses: LidUse[]): Row[] {
  return uses.map((u) => {
    const tail = [u.rptFile || '*', u.drainTo || '*', u.fromPerv]
    while (tail.length && (tail[tail.length - 1] === '' || tail[tail.length - 1] === '*')) tail.pop()
    return {
      values: [u.subcatchment, u.lid, u.number || '1', u.area || '0', u.width || '0', u.initSat || '0', u.fromImp || '0', u.toPerv || '0', ...tail],
      comment: '',
    }
  })
}

/** Layer values for a new design, with every layer its type needs. */
export function newDesign(name: string, type: LidType, us: boolean): LidDesign {
  const layers: LidDesign['layers'] = {}
  for (const layer of LID_TYPES[type].layers) {
    if (layer === 'REMOVALS') continue
    layers[layer] = LAYER_PARAMS[layer].map((p) => (us || p.unit !== 'depth' && p.unit !== 'rate' ? p.def : toSi(p.def, p.unit)))
  }
  return { name, type, layers, comment: '' }
}

function toSi(v: string, _unit: U): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return v
  return String(Math.round(n * 25.4 * 100) / 100)
}

export function unitLabel(unit: U, us: boolean): string {
  switch (unit) {
    case 'depth':
      return us ? 'in' : 'mm'
    case 'rate':
      return us ? 'in/hr' : 'mm/hr'
    case 'frac':
      return 'fraction'
    case 'pct':
      return '%'
    case 'hr':
      return 'hours'
    case 'days':
      return 'days'
    default:
      return ''
  }
}

/** Total thickness of the layers that stack up (for the cross-section). */
export function layerThickness(d: LidDesign, layer: LidLayer): number {
  const v = d.layers[layer]
  if (!v) return 0
  const n = Number(v[0])
  return Number.isFinite(n) ? n : 0
}
