/**
 * What a map label says: the element's ID, or one of its properties with
 * units, the way engineers mark up a plan ("18 in", "0.45 %", "IE 76.96").
 */
type Props = Record<string, unknown>

/** Element kinds that get their own "Labels show" choice in Layers. */
export type LabelKind = 'junction' | 'outfall' | 'storage' | 'conduit' | 'pump' | 'orifice' | 'weir' | 'outlet' | 'subcatchment'

/** Per kind: what its label can say. "none" hides that kind's labels. */
export const LABEL_OPTIONS: Record<LabelKind, readonly (readonly [string, string])[]> = {
  junction: [['id', 'ID'], ['invert', 'Invert elevation'], ['rim', 'Rim elevation'], ['max_depth', 'Depth'], ['none', 'No labels']],
  outfall: [['id', 'ID'], ['invert', 'Invert elevation'], ['outfall_type', 'Outfall type'], ['none', 'No labels']],
  storage: [['id', 'ID'], ['invert', 'Invert elevation'], ['rim', 'Top elevation'], ['max_depth', 'Depth'], ['none', 'No labels']],
  conduit: [['id', 'ID'], ['size', 'Size'], ['length', 'Length'], ['slope', 'Slope'], ['roughness', "Manning's n"], ['none', 'No labels']],
  pump: [['id', 'ID'], ['pump_curve', 'Pump curve'], ['status', 'Initial status'], ['none', 'No labels']],
  orifice: [['id', 'ID'], ['orifice_type', 'Type'], ['size', 'Size'], ['offset', 'Inlet offset'], ['none', 'No labels']],
  weir: [['id', 'ID'], ['weir_type', 'Type'], ['crest_height', 'Crest height'], ['size', 'Height'], ['none', 'No labels']],
  outlet: [['id', 'ID'], ['offset', 'Inlet offset'], ['none', 'No labels']],
  subcatchment: [['id', 'ID'], ['area', 'Area'], ['pct_imperv', '% impervious'], ['width', 'Width'], ['slope', 'Slope'], ['outlet', 'Outlet'], ['raingage', 'Rain gage'], ['none', 'No labels']],
}

export const labelPrefKey = (k: LabelKind) => `map-label2-${k}`

/** The kind a map feature's label follows. */
export function labelKindOf(p: Props): LabelKind {
  if (p.object_type === 'subcatchment') return 'subcatchment'
  if (p.object_type === 'link' || p.link_kind != null || p.from_node != null) {
    const k = String(p.link_kind ?? 'conduit')
    return (['pump', 'orifice', 'weir', 'outlet'].includes(k) ? k : 'conduit') as LabelKind
  }
  const k = String(p.node_kind ?? 'junction')
  return (['outfall', 'storage'].includes(k) ? k : 'junction') as LabelKind
}

/** A label for any element: ID, a property with units, or '' for none. */
export function elementLabel(p: Props, what: string, us: boolean, elevOf: (id: string) => number | undefined): string {
  const kind = labelKindOf(p)
  const u = us ? 'ft' : 'm'
  const str = (v: unknown) => (v == null || v === '' || v === '*' ? '' : String(v))
  switch (what) {
    case 'none':
      return ''
    case 'id':
      return String(p.id ?? '')
    case 'outfall_type':
      return str(p.type)
    case 'pump_curve':
    case 'status':
    case 'orifice_type':
    case 'weir_type':
    case 'outlet':
    case 'raingage':
      return str(p[what])
    case 'offset':
    case 'crest_height':
      return Number.isFinite(num(p[what])) ? `${fix(num(p[what]), 2)} ${u}` : ''
  }
  if (kind === 'subcatchment') {
    switch (what) {
      case 'area':
        return Number.isFinite(num(p.area)) ? `${fix(num(p.area), 2)} ${us ? 'ac' : 'ha'}` : ''
      case 'pct_imperv':
        return Number.isFinite(num(p.pct_imperv)) ? `${fix(num(p.pct_imperv), 1)} % imp.` : ''
      case 'width':
        return Number.isFinite(num(p.width)) ? `W ${fix(num(p.width), 1)} ${u}` : ''
      case 'slope':
        return Number.isFinite(num(p.slope)) ? `${fix(num(p.slope), 2)} %` : ''
    }
    return String(p.id ?? '')
  }
  if (['junction', 'outfall', 'storage'].includes(kind)) return nodeLabel(p, what, us)
  if (what === 'size' && kind !== 'conduit') {
    const d = num(p.diameter)
    if (!Number.isFinite(d) || d <= 0) return ''
    return us ? `${fix(d, 2)} ft` : `${fix(d, 2)} m`
  }
  return linkLabel(p, what, us, elevOf)
}

export const NODE_LABELS = [
  ['id', 'ID'],
  ['invert', 'Invert elevation'],
  ['rim', 'Rim elevation'],
  ['max_depth', 'Depth'],
] as const
export const LINK_LABELS = [
  ['id', 'ID'],
  ['size', 'Size'],
  ['length', 'Length'],
  ['slope', 'Slope'],
  ['roughness', "Manning's n"],
] as const

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
const fix = (v: number, d: number) => (Number.isFinite(v) ? (+v.toFixed(d)).toLocaleString('en-US') : '')

export function nodeLabel(p: Props, what: string, us: boolean): string {
  const u = us ? 'ft' : 'm'
  const elev = num(p.elevation)
  switch (what) {
    case 'invert':
      return Number.isFinite(elev) ? `IE ${fix(elev, 2)}` : ''
    case 'rim':
      return Number.isFinite(elev) && Number.isFinite(num(p.max_depth)) ? `RIM ${fix(elev + num(p.max_depth), 2)}` : ''
    case 'max_depth':
      return Number.isFinite(num(p.max_depth)) ? `${fix(num(p.max_depth), 2)} ${u}` : ''
    default:
      return String(p.id ?? '')
  }
}

/** `elevOf` gives a node's invert, for the slope between a link's ends. */
export function linkLabel(p: Props, what: string, us: boolean, elevOf: (id: string) => number | undefined): string {
  switch (what) {
    case 'size': {
      const d = num(p.diameter)
      if (!Number.isFinite(d) || d <= 0) return ''
      return us ? `${fix(d * 12, 0)} in` : `${fix(d * 1000, 0)} mm`
    }
    case 'length':
      return Number.isFinite(num(p.length)) ? `${fix(num(p.length), 0)} ${us ? 'ft' : 'm'}` : ''
    case 'slope': {
      const a = elevOf(String(p.from_node ?? ''))
      const b = elevOf(String(p.to_node ?? ''))
      const L = num(p.length)
      if (a === undefined || b === undefined || !(L > 0)) return ''
      const s = ((a + (num(p.in_offset) || 0) - (b + (num(p.out_offset) || 0))) / L) * 100
      return `${fix(s, 2)} %`
    }
    case 'roughness':
      return Number.isFinite(num(p.roughness)) ? `n ${fix(num(p.roughness), 3)}` : ''
    default:
      return String(p.id ?? '')
  }
}
