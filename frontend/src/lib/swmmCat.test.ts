import { describe, expect, it } from 'vitest'
import { adjustmentRows, applyAdjustmentsToInp, distanceKm, isUsUnits, nearestStation, type CatData } from './swmmCat'

const months = (v: number) => Array.from({ length: 12 }, () => v)
const data: CatData = {
  station: { id: 'A', lat: 0, lon: 0, distanceKm: 1 },
  evapStation: { id: 'A', lat: 0, lon: 0, distanceKm: 1 },
  returnPeriods: [5],
  temperatureF: () => months(1.8),
  rainfallPct: () => months(-5),
  evaporationIn: () => months(0.01),
  storm: () => [],
}

describe('swmmCat', () => {
  it('converts to the model units', () => {
    const us = adjustmentRows(data, 2035, 'Central', ['TEMPERATURE', 'RAINFALL', 'EVAPORATION'], true)
    expect(us.map((r) => r.values[0])).toEqual([1.8, 0.95, 0.01])
    const si = adjustmentRows(data, 2035, 'Central', ['TEMPERATURE', 'EVAPORATION'], false)
    expect(si.map((r) => r.values[0])).toEqual([1, 0.254])
    expect(isUsUnits('cfs')).toBe(true)
    expect(isUsUnits('CMS')).toBe(false)
  })

  it('finds the nearest station, optionally with evaporation', () => {
    const st: [string, number, number, 0 | 1][] = [
      ['near', 40, -75, 0],
      ['far', 41, -75, 1],
    ]
    expect(nearestStation(st, 40.1, -75)?.i).toBe(0)
    expect(nearestStation(st, 40.1, -75, true)?.i).toBe(1)
    expect(distanceKm(40, -75, 41, -75)).toBeCloseTo(111.2, 0)
  })

  it('replaces matching rows and keeps others', () => {
    const inp = ['[OPTIONS]', 'FLOW_UNITS CFS', '', '[ADJUSTMENTS]', ';;comment', 'CONDUCTIVITY 1 1 1 1 1 1 1 1 1 1 1 1', 'RAINFALL 2 2 2 2 2 2 2 2 2 2 2 2', '', '[COORDINATES]', 'J1 0 0', ''].join('\n')
    const out = applyAdjustmentsToInp(inp, [{ kind: 'RAINFALL', values: months(1.1) }])
    const sec = out.split('[ADJUSTMENTS]')[1]!.split('[COORDINATES]')[0]!
    expect(sec).toContain(';;comment')
    expect(sec).toContain('CONDUCTIVITY')
    expect(sec.match(/RAINFALL/g)).toHaveLength(1)
    expect(sec).toContain('1.1')
    expect(out).toContain('[COORDINATES]\nJ1 0 0')
  })

  it('adds the section before the map sections', () => {
    const inp = '[OPTIONS]\nFLOW_UNITS CFS\n\n[COORDINATES]\nJ1 0 0\n'
    const out = applyAdjustmentsToInp(inp, [{ kind: 'TEMPERATURE', values: months(2) }])
    expect(out.indexOf('[ADJUSTMENTS]')).toBeGreaterThan(out.indexOf('[OPTIONS]'))
    expect(out.indexOf('[ADJUSTMENTS]')).toBeLessThan(out.indexOf('[COORDINATES]'))
    expect(out).toMatch(/TEMPERATURE\s+2\s+2/)
  })
})
