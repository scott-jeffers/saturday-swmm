/** CPU color ramp matching meshDepthColorExpr for WebGL face coloring. */

import { MESH_DEPTH_COLORS } from './resultsSymbology'

function parseColor(css: string): [number, number, number, number] {
  if (css.startsWith('rgba')) {
    const m = css.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const parts = m[1].split(',').map((s) => Number(s.trim()))
      return [
        (parts[0] ?? 0) / 255,
        (parts[1] ?? 0) / 255,
        (parts[2] ?? 0) / 255,
        parts[3] ?? 0,
      ]
    }
  }
  const hex = css.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
}

const STOPS: { t: number; c: [number, number, number, number] }[] = [
  { t: 0, c: parseColor(MESH_DEPTH_COLORS.zero) },
  { t: 0.05, c: parseColor(MESH_DEPTH_COLORS.low) },
  { t: 0.35, c: parseColor(MESH_DEPTH_COLORS.mid) },
  { t: 0.65, c: parseColor(MESH_DEPTH_COLORS.high) },
  { t: 1, c: parseColor(MESH_DEPTH_COLORS.max) },
]

function lerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  u: number,
): [number, number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
    a[3] + (b[3] - a[3]) * u,
  ]
}

/** Map depth [0, depthMax] to RGBA in 0–1. */
export function depthToRgba(
  depth: number,
  depthMax: number,
): [number, number, number, number] {
  const max = Math.max(depthMax, 0.001)
  const t = Math.max(0, Math.min(1, depth / max))
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (t <= b.t) {
      const span = b.t - a.t || 1e-9
      return lerp(a.c, b.c, (t - a.t) / span)
    }
  }
  return STOPS[STOPS.length - 1].c
}

/**
 * Fill a packed RGBA8 buffer: 3 identical vertex colors per triangle.
 * `out` must be length >= values.length * 12.
 */
export function fillTriangleColorsRgba8(
  values: Float32Array | ArrayLike<number>,
  depthMax: number,
  out: Uint8Array,
): void {
  const n = values.length
  for (let i = 0; i < n; i++) {
    const [r, g, b, a] = depthToRgba(Number(values[i]) || 0, depthMax)
    const base = i * 12
    const R = Math.round(r * 255)
    const G = Math.round(g * 255)
    const B = Math.round(b * 255)
    const A = Math.round(a * 255)
    for (let v = 0; v < 3; v++) {
      const o = base + v * 4
      out[o] = R
      out[o + 1] = G
      out[o + 2] = B
      out[o + 3] = A
    }
  }
}
