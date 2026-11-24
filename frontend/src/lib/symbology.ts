/**
 * Colouring the map by a value: palettes, ways to split values into classes,
 * and engineering defaults for the values engineers colour by most (capacity,
 * velocity, flooding, slope, cover) so the first map already means something.
 */

// ------------------------------------------------------------------ palettes

export type PaletteKind = 'sequential' | 'diverging' | 'traffic'
export type Palette = { id: string; label: string; kind: PaletteKind; colors: string[]; safe?: boolean }

/** ColorBrewer and matplotlib palettes; `safe` = readable with common colour-vision deficiencies. */
export const PALETTES: Palette[] = [
  { id: 'YlOrRd', label: 'Yellow → red', kind: 'sequential', colors: ['#ffffb2', '#fecc5c', '#fd8d3c', '#f03b20', '#bd0026'], safe: true },
  { id: 'Blues', label: 'Blues', kind: 'sequential', colors: ['#deebf7', '#9ecae1', '#6baed6', '#3182bd', '#08519c'], safe: true },
  { id: 'YlGnBu', label: 'Yellow → blue', kind: 'sequential', colors: ['#ffffcc', '#a1dab4', '#41b6c4', '#2c7fb8', '#253494'], safe: true },
  { id: 'Viridis', label: 'Viridis', kind: 'sequential', colors: ['#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'], safe: true },
  { id: 'Magma', label: 'Magma', kind: 'sequential', colors: ['#fcfdbf', '#fc8961', '#b73779', '#51127c', '#000004'], safe: true },
  { id: 'Cividis', label: 'Cividis', kind: 'sequential', colors: ['#fee838', '#c3b369', '#7c7b78', '#3b496c', '#00224e'], safe: true },
  { id: 'Greens', label: 'Greens', kind: 'sequential', colors: ['#e5f5e0', '#a1d99b', '#74c476', '#31a354', '#006d2c'], safe: true },
  { id: 'Purples', label: 'Purples', kind: 'sequential', colors: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'], safe: true },
  { id: 'Greys', label: 'Greys', kind: 'sequential', colors: ['#f7f7f7', '#cccccc', '#969696', '#636363', '#252525'], safe: true },
  { id: 'Traffic', label: 'Good → bad (green to red)', kind: 'traffic', colors: ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'] },
  { id: 'TrafficSafe', label: 'Good → bad (blue to orange)', kind: 'traffic', colors: ['#2166ac', '#67a9cf', '#f7f7f7', '#fdb863', '#b35806'], safe: true },
  { id: 'RdBu', label: 'Blue ↔ red', kind: 'diverging', colors: ['#2166ac', '#67a9cf', '#f7f7f7', '#ef8a62', '#b2182b'], safe: true },
  { id: 'Spectral', label: 'Spectral', kind: 'diverging', colors: ['#2b83ba', '#abdda4', '#ffffbf', '#fdae61', '#d7191c'] },
  { id: 'BrBG', label: 'Brown ↔ teal', kind: 'diverging', colors: ['#a6611a', '#dfc27d', '#f5f5f5', '#80cdc1', '#018571'], safe: true },
]

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`

/** `n` colours spread evenly along a palette (interpolated between its stops). */
export function samplePalette(colors: string[], n: number, reverse = false): string[] {
  const stops = reverse ? [...colors].reverse() : colors
  if (n <= 1) return [stops[stops.length - 1]!]
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (stops.length - 1)
    const a = Math.floor(t)
    const b = Math.min(stops.length - 1, a + 1)
    const f = t - a
    const A = hex(stops[a]!)
    const B = hex(stops[b]!)
    return toHex(A.map((v, k) => v + (B[k]! - v) * f))
  })
}

// ------------------------------------------------------------------ classes

export type Method = 'recommended' | 'jenks' | 'quantile' | 'equal' | 'pretty' | 'stddev' | 'manual'
export const METHOD_LABEL: Record<Method, string> = {
  recommended: 'Recommended',
  jenks: 'Natural breaks',
  quantile: 'Quantile (equal counts)',
  equal: 'Equal interval',
  pretty: 'Rounded intervals',
  stddev: 'Standard deviation',
  manual: 'Manual',
}

const sorted = (values: number[]) => values.filter(Number.isFinite).sort((a, b) => a - b)

/** Jenks natural breaks: classes that keep similar values together. Large sets are sampled. */
export function jenks(values: number[], n: number): number[] {
  let v = sorted(values)
  if (!v.length) return []
  const lo = v[0]!
  const hi = v[v.length - 1]!
  if (v.length > 2000) v = Array.from({ length: 2000 }, (_, i) => v[Math.round((i * (v.length - 1)) / 1999)]!)
  const m = v.length
  n = Math.min(n, new Set(v).size)
  if (n < 2) return [lo, hi]
  const lower = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[])
  const varc = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity) as number[])
  for (let j = 1; j <= n; j++) {
    lower[1]![j] = 1
    varc[1]![j] = 0
  }
  for (let l = 2; l <= m; l++) {
    let s1 = 0
    let s2 = 0
    let w = 0
    let vv = 0
    for (let k = 1; k <= l; k++) {
      const i3 = l - k + 1
      const val = v[i3 - 1]!
      s2 += val * val
      s1 += val
      w++
      vv = s2 - (s1 * s1) / w
      const i4 = i3 - 1
      if (i4 !== 0) {
        for (let j = 2; j <= n; j++) {
          if (varc[l]![j]! >= vv + varc[i4]![j - 1]!) {
            lower[l]![j] = i3
            varc[l]![j] = vv + varc[i4]![j - 1]!
          }
        }
      }
    }
    lower[l]![1] = 1
    varc[l]![1] = vv
  }
  const out = new Array(n + 1).fill(0) as number[]
  out[n] = hi
  out[0] = lo
  let k = m
  for (let j = n; j >= 2; j--) {
    const id = lower[k]![j]! - 2
    out[j - 1] = v[id]!
    k = lower[k]![j]! - 1
  }
  return out
}

/** A round step near `span / n` (1, 2, 2.5, 5 × 10^k). */
function niceStep(span: number, n: number) {
  const raw = span / Math.max(1, n)
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw
}

/** Class edges (n + 1 values, lowest to highest). */
export function breaksFor(values: number[], n: number, method: Exclude<Method, 'recommended' | 'manual'>): number[] {
  const v = sorted(values)
  if (!v.length) return []
  const lo = v[0]!
  const hi = v[v.length - 1]!
  if (lo === hi) return [lo, hi]
  switch (method) {
    case 'equal':
      return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n)
    case 'pretty': {
      const step = niceStep(hi - lo, n)
      const start = Math.floor(lo / step) * step
      const edges = [start]
      while (edges[edges.length - 1]! < hi - 1e-12) edges.push(+(edges[edges.length - 1]! + step).toPrecision(12))
      return edges
    }
    case 'stddev': {
      const mean = v.reduce((a, b) => a + b, 0) / v.length
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1
      const half = (n - 2) / 2
      const inner = Array.from({ length: n - 1 }, (_, i) => mean + (i - half) * sd)
      return [lo, ...inner.filter((x) => x > lo && x < hi), hi]
    }
    case 'jenks':
      return jenks(v, n)
    case 'quantile':
    default: {
      const q = Array.from({ length: n + 1 }, (_, i) => v[Math.min(v.length - 1, Math.round(((v.length - 1) * i) / n))]!)
      return q.filter((x, i) => i === 0 || x > q[i - 1]!)
    }
  }
}

export function classOf(v: number, edges: number[]): number {
  for (let i = 1; i < edges.length; i++) if (v <= edges[i]!) return i - 1
  return edges.length - 2
}

// --------------------------------------------------------- engineering defaults

export type Recommended = {
  /** Inner edges; the outer ones are open (below the first, above the last). */
  inner: number[]
  colors: string[]
  labels: string[]
  /** Colour and label for elements with no value (e.g. nodes that never flooded). */
  noValue?: { color: string; label: string }
  note: string
}

const GOOD = '#1a9850'
const OK = '#91cf60'
const WATCH = '#fee08b'
const WARN = '#fc8d59'
const BAD = '#d73027'
const SLOW = '#8c6bb1'

export function recommendedFor(key: string, us: boolean): Recommended | null {
  const k = key.toLowerCase()
  if (k.endsWith(':max/full flow'))
    return {
      inner: [0.5, 0.8, 1.0],
      colors: [GOOD, OK, WARN, BAD],
      labels: ['Under half capacity', 'Half to 80 %', '80 % to full', 'Over capacity'],
      note: 'Peak flow ÷ full-pipe flow. Above 1 the pipe is over its capacity.',
    }
  if (k.endsWith(':max/full depth'))
    return {
      inner: [0.5, 0.8, 0.999],
      colors: [GOOD, OK, WARN, BAD],
      labels: ['Under half full', 'Half to 80 % full', '80 % to nearly full', 'Full (surcharged)'],
      note: 'Peak depth ÷ pipe height. At 1 the pipe flows full.',
    }
  if (k.endsWith(':maximum velocity') || k.endsWith(':max velocity'))
    return us
      ? { inner: [2, 5, 10], colors: [SLOW, GOOD, WATCH, BAD], labels: ['Under 2 ft/s (may silt up)', '2 to 5 ft/s', '5 to 10 ft/s', 'Over 10 ft/s (scour risk)'], note: 'Typical limits: 2 ft/s to stay self-cleansing, 10 ft/s before scour. Use your own design standard.' }
      : { inner: [0.6, 1.5, 3], colors: [SLOW, GOOD, WATCH, BAD], labels: ['Under 0.6 m/s (may silt up)', '0.6 to 1.5 m/s', '1.5 to 3 m/s', 'Over 3 m/s (scour risk)'], note: 'Typical limits: 0.6 m/s to stay self-cleansing, 3 m/s before scour. Use your own design standard.' }
  if (k.startsWith('r:node flooding summary:hours flooded'))
    return {
      inner: [0.1, 0.5, 2],
      colors: [WATCH, WARN, '#e34a33', BAD],
      labels: ['Under 6 minutes', '6 to 30 minutes', '30 minutes to 2 hours', 'Over 2 hours'],
      noValue: { color: GOOD, label: 'Not flooded' },
      note: 'How long each node floods. Nodes that never flood aren’t in the report table.',
    }
  if (k.startsWith('r:node flooding summary:') && (k.includes('volume') || k.includes('rate')))
    return null
  if (k.startsWith('r:node surcharge summary:hours surcharged'))
    return {
      inner: [0.5, 2, 6],
      colors: [OK, WATCH, WARN, BAD],
      labels: ['Under 30 minutes', '30 minutes to 2 hours', '2 to 6 hours', 'Over 6 hours'],
      noValue: { color: GOOD, label: 'Never surcharged' },
      note: 'How long the water level stands above the crown of the highest pipe.',
    }
  if (k === 'd:slope')
    return {
      inner: [0, 0.3, 1, 5],
      colors: [BAD, WARN, OK, GOOD, '#2b83ba'],
      labels: ['Adverse (runs uphill)', 'Flatter than 0.3 %', '0.3 to 1 %', '1 to 5 %', 'Steeper than 5 %'],
      note: 'Conduit slope from inverts and offsets. Check minimums against your design standard.',
    }
  if (k === 'd:cover')
    return us
      ? { inner: [0, 3, 6], colors: [BAD, WARN, GOOD, '#2b83ba'], labels: ['Above ground', 'Under 3 ft', '3 to 6 ft', 'Over 6 ft'], note: 'Smallest depth of ground over the pipe at either end.' }
      : { inner: [0, 0.9, 2], colors: [BAD, WARN, GOOD, '#2b83ba'], labels: ['Above ground', 'Under 0.9 m', '0.9 to 2 m', 'Over 2 m'], note: 'Smallest depth of ground over the pipe at either end.' }
  if (k === 'm:pct_imperv')
    return { inner: [25, 50, 75], colors: ['#c7e9c0', '#fee08b', '#fc8d59', '#7f7f7f'], labels: ['Under 25 %', '25 to 50 %', '50 to 75 %', 'Over 75 %'], note: 'Share of each subcatchment that is paved or roofed.' }
  if (k.endsWith(':runoff coeff'))
    return { inner: [0.25, 0.5, 0.75], colors: ['#c6dbef', '#6baed6', '#3182bd', '#08519c'], labels: ['Under 0.25', '0.25 to 0.5', '0.5 to 0.75', 'Over 0.75'], note: 'Runoff ÷ rainfall for each subcatchment.' }
  return null
}

/** A default palette for a value with no recommended classes. */
export function defaultPalette(key: string): string {
  const k = key.toLowerCase()
  if (k.includes('flood') || k.includes('surcharg')) return 'YlOrRd'
  if (k.includes('depth') || k.includes('hgl') || k.includes('flow') || k.includes('runoff') || k.includes('volume')) return 'Blues'
  if (k.includes('velocity')) return 'Viridis'
  return 'Viridis'
}

export const fmtNum = (v: number) =>
  !Number.isFinite(v) ? '' : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString()
