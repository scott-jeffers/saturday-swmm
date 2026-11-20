import { describe, expect, it } from 'vitest'
import { haversine, sphericalArea } from './MeasureTool'

describe('measure maths', () => {
  it('one degree of latitude is about 111.2 km', () => {
    expect(haversine([10, 55], [10, 56]) / 1000).toBeCloseTo(111.19, 1)
  })
  it('a 0.01° square near the equator is about 1.236 km²', () => {
    const a = sphericalArea([
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
    ])
    expect(a / 1e6).toBeCloseTo(1.2364, 2)
  })
  it('needs three points for an area', () => {
    expect(sphericalArea([[0, 0], [1, 1]])).toBe(0)
  })
})
