import { describe, expect, it } from 'vitest'
import { flowVolumeUnit, seriesStats } from './chartZoom'

describe('graph values', () => {
  const xs = [0, 1, 2, 3, 4]
  const ys = [0, 2, 4, 2, 0]
  it('peak, min, mean over the whole range', () => {
    const s = seriesStats(xs, ys, 0, 4, 1)!
    expect([s.peak, s.peakX, s.min, s.mean]).toEqual([4, 2, 0, 1.6])
    expect(s.volume).toBeCloseTo(8) // triangle area
  })
  it('updates for a zoomed window and clips the volume', () => {
    const s = seriesStats(xs, ys, 0.5, 1.5, 60)!
    expect([s.peak, s.mean]).toEqual([2, 2])
    expect(s.volume).toBeCloseTo(2 * 60) // ∫ 2x dx from 0.5 to 1.5 = 2, × 60 s
  })
  it('holds values for step series', () => {
    expect(seriesStats([0, 1, 2], [3, 1, 1], 0, 2, 1, true)!.volume).toBeCloseTo(4)
  })
  it('no values in an empty window', () => {
    expect(seriesStats(xs, ys, 10, 20, 1)).toBeNull()
  })
  it('knows flow volume units', () => {
    expect(flowVolumeUnit('LPS')).toEqual({ unit: 'm³', perSecond: 0.001 })
    expect(flowVolumeUnit('mm')).toBeNull()
  })
})
