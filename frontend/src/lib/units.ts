/** Show report values in US or SI units regardless of the model's units. */
import { usePref } from './prefs'

export type UnitSystem = 'model' | 'us' | 'si'

type Conv = { to: string; f: (v: number) => number }
// Keyed by the unit text SWMM writes in report headers (lower case).
const TO_SI: Record<string, Conv> = {
  feet: { to: 'm', f: (v) => v * 0.3048 },
  ft: { to: 'm', f: (v) => v * 0.3048 },
  'ft/sec': { to: 'm/s', f: (v) => v * 0.3048 },
  cfs: { to: 'm³/s', f: (v) => v * 0.0283168 },
  gpm: { to: 'L/s', f: (v) => v * 0.0630902 },
  mgd: { to: 'ML/d', f: (v) => v * 3.78541 },
  '10^6 gal': { to: 'ML', f: (v) => v * 3.78541 },
  in: { to: 'mm', f: (v) => v * 25.4 },
  inches: { to: 'mm', f: (v) => v * 25.4 },
  acres: { to: 'ha', f: (v) => v * 0.404686 },
  ac: { to: 'ha', f: (v) => v * 0.404686 },
  'in/hr': { to: 'mm/h', f: (v) => v * 25.4 },
}
const TO_US: Record<string, Conv> = {
  meters: { to: 'ft', f: (v) => v / 0.3048 },
  metres: { to: 'ft', f: (v) => v / 0.3048 },
  m: { to: 'ft', f: (v) => v / 0.3048 },
  'm/sec': { to: 'ft/s', f: (v) => v / 0.3048 },
  'm/s': { to: 'ft/s', f: (v) => v / 0.3048 },
  cms: { to: 'cfs', f: (v) => v / 0.0283168 },
  lps: { to: 'cfs', f: (v) => v / 28.3168 },
  mld: { to: 'MGD', f: (v) => v / 3.78541 },
  '10^6 ltr': { to: '10^6 gal', f: (v) => v / 3.78541 },
  ml: { to: '10^6 gal', f: (v) => v / 3.78541 },
  mm: { to: 'in', f: (v) => v / 25.4 },
  hectares: { to: 'ac', f: (v) => v / 0.404686 },
  ha: { to: 'ac', f: (v) => v / 0.404686 },
  'mm/hr': { to: 'in/hr', f: (v) => v / 25.4 },
}

export function converter(unit: string | undefined, system: UnitSystem): { unit: string | undefined; f: (v: number) => number } {
  if (!unit || system === 'model') return { unit, f: (v) => v }
  const c = (system === 'si' ? TO_SI : TO_US)[unit.trim().toLowerCase()]
  return c ? { unit: c.to, f: c.f } : { unit, f: (v) => v }
}

export function useUnitSystem(): UnitSystem {
  const v = usePref('display-units', 'model')
  return v === 'us' || v === 'si' ? v : 'model'
}

type TableLike = { units?: string[]; rows: (string | number | null)[][] }
/** A copy of a report table with numeric columns converted. */
export function convertTable<T extends TableLike>(t: T, system: UnitSystem): T {
  if (system === 'model' || !t.units?.length) return t
  const conv = t.units.map((u) => converter(u, system))
  if (conv.every((c, i) => c.unit === t.units![i])) return t
  return {
    ...t,
    units: conv.map((c) => c.unit ?? ''),
    rows: t.rows.map((r) => r.map((v, i) => (typeof v === 'number' && conv[i] ? Number(conv[i].f(v).toPrecision(5)) : v))),
  }
}

/**
 * SWMM reports volumes as "10^6 gal" / "10^6 ltr" with three decimals, so a
 * small volume is only known to the nearest 1,000 gal (or L). Show them as
 * people say them, and say when a number is approximate: "≈4,000 gal",
 * "1.26 Mgal". A volume reported as 0.000 is "< 500 gal" when something did
 * flood (`nonZero`), since the report rounded it away.
 */
export function formatVolume(v: number | null | undefined, units: string | null | undefined, opts: { nonZero?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const u = (units ?? '').trim().toLowerCase()
  const big = u === '10^6 gal' ? 'Mgal' : u === '10^6 ltr' ? 'ML' : null
  if (!big) return `${v} ${units ?? ''}`.trim()
  const small = big === 'Mgal' ? 'gal' : 'L'
  if (v === 0) return opts.nonZero ? `< 500 ${small}` : `0 ${small}`
  if (Math.abs(v) < 0.1) {
    const raw = Math.round(v * 1e6)
    // Exact multiples of the report's last digit are only known to ±500.
    const approx = raw % 1000 === 0 ? '≈' : ''
    return `${approx}${raw.toLocaleString('en-US')} ${small}`
  }
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${big}`
}

/** "1 outfall", "3 outfalls"; irregular plurals passed explicitly. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

/** "9 junctions, 1 outfall, 8 links and 6 subcatchments" (zero counts left out). */
export function networkCounts(c: { junctions?: number; outfalls?: number; storage?: number; links?: number; subcatchments?: number }): string {
  const parts = [
    plural(c.junctions ?? 0, 'junction'),
    plural(c.outfalls ?? 0, 'outfall'),
    (c.storage ?? 0) > 0 ? plural(c.storage ?? 0, 'storage unit') : '',
    plural(c.links ?? 0, 'link'),
    plural(c.subcatchments ?? 0, 'subcatchment'),
  ].filter(Boolean)
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
}
