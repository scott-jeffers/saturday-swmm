import { describe, expect, it } from 'vitest'
import { curveAxes, parseCurves, parseHours, parseTimeseries } from './inputSeries'

const rows = (lines: string[]) => lines.map((l) => ({ values: l.split(/\s+/) }))

describe('parseTimeseries', () => {
  it('reads time-only series and decimal hours', () => {
    const [s, t] = parseTimeseries(rows(['DESIGN 0:00 0.1', 'DESIGN 0:05 0.3', 'INFLOW 0 0', 'INFLOW 1.5 2']))
    expect(s.name).toBe('DESIGN')
    expect(s.hours).toEqual([0, 5 / 60])
    expect(s.values).toEqual([0.1, 0.3])
    expect(t.hours).toEqual([0, 1.5])
    expect(s.dated).toBe(false)
  })
  it('carries dates across rows and days', () => {
    const [s] = parseTimeseries(rows(['R 06/01/2024 23:00 1', 'R 06/02/2024 01:00 2', 'R 02:00 3']))
    expect(s.hours).toEqual([0, 2, 3])
    expect(s.dated).toBe(true)
  })
  it('reads several pairs on one row and FILE series', () => {
    const [a, b] = parseTimeseries(rows(['A 0:00 1 0:10 2 0:20 3', 'B FILE "C:\\rain\\gage.dat"']))
    expect(a.values).toEqual([1, 2, 3])
    expect(b.file).toBe('C:\\rain\\gage.dat')
    expect(b.values).toEqual([])
  })
  it('parses H:MM:SS', () => {
    expect(parseHours('1:30:36')).toBeCloseTo(1.51)
  })
})

describe('parseCurves', () => {
  it('takes the type from the first row of each curve', () => {
    const c = parseCurves(rows(['P1 Pump4 0 0.021', 'P1 4.6 0.021', 'S1 Storage 0 100 2 150 4 200']))
    expect(c).toHaveLength(2)
    expect(c[0]).toMatchObject({ name: 'P1', type: 'PUMP4', x: [0, 4.6], y: [0.021, 0.021] })
    expect(c[1]).toMatchObject({ type: 'STORAGE', x: [0, 2, 4], y: [100, 150, 200] })
  })
  it('labels axes by curve type', () => {
    expect(curveAxes('STORAGE', 'ft', 'CFS')).toMatchObject({ x: 'Depth (ft)', y: 'Area (ft²)' })
    expect(curveAxes('PUMP4', 'm', 'CMS').y).toBe('Flow (CMS)')
  })
})
