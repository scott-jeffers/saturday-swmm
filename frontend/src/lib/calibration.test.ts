import { describe, expect, it } from 'vitest'
import { fitStats, parseObserved, sampleAt } from './calibration'

const T0 = Date.UTC(2024, 5, 1, 0, 0)
const mod = [0, 1, 4, 2, 0].map((v, i) => ({ t: T0 + i * 3_600_000, v }))

describe('calibration', () => {
  it('parses ISO, US dates and hours', () => {
    const { points, skipped } = parseObserved('time,flow\n2024-06-01 01:00,1\n06/01/2024 02:00,4\n3,2\nbad line', T0)
    expect(points.map((p) => (p.t - T0) / 3_600_000)).toEqual([1, 2, 3])
    expect(skipped).toBe(2)
  })
  it('interpolates', () => {
    expect(sampleAt(mod, T0 + 1.5 * 3_600_000)).toBeCloseTo(2.5)
    expect(sampleAt(mod, T0 - 1)).toBeNull()
  })
  it('scores a perfect fit as NSE 1', () => {
    const f = fitStats(mod, mod)!
    expect(f.nse).toBeCloseTo(1)
    expect(f.rmse).toBeCloseTo(0)
    expect(f.peakErrPct).toBeCloseTo(0)
    expect(f.volErrPct).toBeCloseTo(0)
  })
  it('measures a peak that is 25 % high and an hour late', () => {
    const obs = [0, 4, 1, 0, 0].map((v, i) => ({ t: T0 + i * 3_600_000, v }))
    const m = [0, 1, 5, 0, 0].map((v, i) => ({ t: T0 + i * 3_600_000, v }))
    const f = fitStats(obs, m)!
    expect(f.peakErrPct).toBeCloseTo(25)
    expect(f.peakShiftMin).toBe(60)
    expect(f.nse!).toBeLessThan(0.5)
  })
})
