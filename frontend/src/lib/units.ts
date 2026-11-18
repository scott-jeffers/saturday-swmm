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
