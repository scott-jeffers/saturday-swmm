/**
 * What a map label says: the element's ID, or one of its properties with
 * units, the way engineers mark up a plan ("18 in", "0.45 %", "IE 76.96").
 */
type Props = Record<string, unknown>

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
