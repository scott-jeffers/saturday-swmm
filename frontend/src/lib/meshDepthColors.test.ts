/**
 * Unit tests for mesh depth → RGBA color ramp (WebGL path).
 */
import { describe, expect, it } from 'vitest'
import { depthToRgba, fillTriangleColorsRgba8 } from './meshDepthColors'

describe('meshDepthColors', () => {
  it('maps zero depth to transparent-ish zero stop', () => {
    const c = depthToRgba(0, 1)
    expect(c[3]).toBeLessThan(0.05)
    expect(c[0]).toBeGreaterThanOrEqual(0)
  })

  it('maps max depth to red-ish max stop', () => {
    const [r, g, b] = depthToRgba(1, 1)
    expect(r).toBeGreaterThan(0.8)
    expect(g).toBeLessThan(0.4)
    expect(b).toBeLessThan(0.4)
  })

  it('fills 3 vertices per triangle in RGBA8 buffer', () => {
    const values = new Float32Array([0, 1])
    const out = new Uint8Array(2 * 12)
    fillTriangleColorsRgba8(values, 1, out)
    // First triangle verts identical
    expect(out[0]).toBe(out[4])
    expect(out[4]).toBe(out[8])
    // Second triangle red channel high
    expect(out[12]).toBeGreaterThan(200)
  })
})
