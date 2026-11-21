import { describe, expect, it } from 'vitest'
import { binHyetograph, fromRainFile, fromRun, hyetograph, parseRainGages } from './rainGages'

describe('rain gages', () => {
  it('reads TIMESERIES and FILE gages', () => {
    const g = parseRainGages([
      ['RG1', 'INTENSITY', '0:15', '1.0', 'TIMESERIES', 'TS1'],
      ['RG2', 'VOLUME', '1:00', '1.0', 'FILE', '"C:\\data\\rain.dat"', 'STA1', 'MM'],
    ])
    expect(g[0]).toMatchObject({ name: 'RG1', format: 'INTENSITY', intervalHr: 0.25, source: 'TIMESERIES', series: 'TS1' })
    expect(g[1]).toMatchObject({ format: 'VOLUME', source: 'FILE', file: 'C:\\data\\rain.dat', station: 'STA1', units: 'MM' })
  })

  it('turns each format into depth', () => {
    const hrs = [0, 0.25, 0.5]
    expect(hyetograph(hrs, [4, 8, 0], 'INTENSITY', 0.25, undefined).total).toBeCloseTo(3)
    const v = hyetograph(hrs, [1, 2, 0], 'VOLUME', 0.25)
    expect(v.total).toBeCloseTo(3)
    expect(v.peak).toBeCloseTo(8)
    expect(v.wetSpanHr).toBeCloseTo(0.5)
    expect(hyetograph(hrs, [1, 3, 3], 'CUMULATIVE', 0.25).total).toBeCloseTo(3)
  })

  it('bins long records without losing depth', () => {
    const n = 10000
    const h = hyetograph(Array.from({ length: n }, (_, i) => i / 12), Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 0.6 : 0)), 'INTENSITY', 1 / 12)
    const b = binHyetograph(h, 500)
    expect(b.hours.length).toBe(500)
    expect(b.cumulative[499]).toBeCloseTo(h.total, 6)
  })

  it('reads a station rain file for its own station', () => {
    const g = parseRainGages([['RG', 'VOLUME', '1:00', '1', 'FILE', 'r.dat', 'B', 'IN']])[0]
    const h = fromRainFile(g, 'A 2020 1 1 0 0 9\nB 2020 1 1 0 0 0.5\nB 2020 1 1 1 0 0.25\n')!
    expect(h.records).toBe(2)
    expect(h.total).toBeCloseTo(0.75)
  })

  it('uses run rainfall as intensity per report step', () => {
    expect(fromRun([1, 2, 0], 900).total).toBeCloseTo(0.75)
  })
})
