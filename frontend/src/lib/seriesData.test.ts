import { describe, expect, it } from 'vitest'
import {
  allReferenced,
  dwfSlots,
  dwfWeek,
  importedToSeries,
  normalisePattern,
  parseCurveList,
  parseDwfRows,
  parseHydrographs,
  parsePatternList,
  parseTimeSeries,
  perCapitaToFlow,
  readPairs,
  readSeriesText,
  readStamp,
  renameRefs,
  rtkCurve,
  serializeCurves,
  serializeHydrographs,
  serializePatterns,
  serializeTimeSeries,
  usedBy,
  freeName,
} from './seriesData'

const R = (...v: string[]) => ({ values: v })

describe('time series', () => {
  it('round-trips inline and file series, keeping dates where given', () => {
    const rows = [R('TS1', '01/01/2024', '0:00', '0'), R('TS1', '0:15', '0.5'), R('TS1', '01/02/2024', '0:00', '1'), R('TS2', 'FILE', '"rain.dat"'), R('TS3', '0', '1', '2', '3')]
    const list = parseTimeSeries(rows)
    expect(list.map((s) => s.name)).toEqual(['TS1', 'TS2', 'TS3'])
    expect(list[0]!.points).toEqual([
      { date: '01/01/2024', time: '0:00', value: '0' },
      { date: '', time: '0:15', value: '0.5' },
      { date: '01/02/2024', time: '0:00', value: '1' },
    ])
    expect(list[1]!.file).toBe('rain.dat')
    expect(list[2]!.points).toHaveLength(2)
    const back = serializeTimeSeries(list)
    expect(back[0]!.values).toEqual(['TS1', '01/01/2024', '0:00', '0'])
    expect(back[1]!.values).toEqual(['TS1', '0:15', '0.5'])
    expect(back[3]!.values).toEqual(['TS2', 'FILE', '"rain.dat"'])
  })
})

describe('curves and patterns', () => {
  it('reads a curve whose type is on the first row only', () => {
    const c = parseCurveList([R('P1', 'Pump2', '0', '0'), R('P1', '2', '5'), R('P1', '', '4', '9')])
    expect(c[0]).toEqual({ name: 'P1', type: 'PUMP2', points: [['0', '0'], ['2', '5'], ['4', '9']] })
    expect(serializeCurves(c).map((r) => r.values)).toEqual([['P1', 'PUMP2', '0', '0'], ['P1', '', '2', '5'], ['P1', '', '4', '9']])
  })
  it('reads patterns over several lines and writes six factors a line', () => {
    const p = parsePatternList([R('H', 'HOURLY', ...Array(6).fill('1')), R('H', ...Array(18).fill('2'))])
    expect(p[0]!.factors).toHaveLength(24)
    expect(serializePatterns(p)).toHaveLength(4)
    const n = normalisePattern({ name: 'M', type: 'DAILY', factors: ['1', '1', '1', '1', '1', '2', '0'] })
    expect(n.factors.map(Number).reduce((a, b) => a + b, 0)).toBeCloseTo(7, 2)
  })
})

describe('dry-weather flow', () => {
  const pats = parsePatternList([R('M', 'MONTHLY', ...Array(12).fill('1')), R('H', 'HOURLY', ...Array(24).fill('1')), R('W', 'WEEKEND', ...Array(24).fill('2'))])
  it('sorts a node’s patterns by type', () => {
    const d = parseDwfRows([R('J1', 'FLOW', '0.5', '"W"', '"M"', '"H"', '"X"')])[0]!
    expect(dwfSlots(d, pats)).toEqual({ MONTHLY: 'M', HOURLY: 'H', WEEKEND: 'W', other: ['X'] })
  })
  it('builds a week with weekend factors on Saturday and Sunday', () => {
    const w = dwfWeek(parseDwfRows([R('J1', 'FLOW', '1', 'H', 'W')]), pats)
    expect(w[0]).toBe(1) // Monday
    expect(w[24 * 5]).toBe(2) // Saturday
    expect(w[24 * 6]).toBe(2) // Sunday
  })
  it('converts per-capita flow', () => {
    expect(perCapitaToFlow(200, 1000, 'LPS')).toBeCloseTo(2.3148, 3)
    expect(perCapitaToFlow(100, 1440, 'GPM')).toBeCloseTo(100, 6)
  })
})

describe('unit hydrographs', () => {
  it('round-trips groups and integrates each triangle to its R', () => {
    const rows = [R('UH1', 'RG1'), R('UH1', 'ALL', 'SHORT', '0.02', '1', '2'), R('UH1', 'ALL', 'MEDIUM', '0.03', '3', '2', '0.1', '0.01', '0'), R('UH1', 'JUL', 'SHORT', '0.05', '1', '1')]
    const u = parseHydrographs(rows)
    expect(u[0]!.gage).toBe('RG1')
    expect(u[0]!.months.JUL?.SHORT?.r).toBe('0.05')
    expect(serializeHydrographs(u).map((r) => r.values)).toEqual([
      ['UH1', 'RG1'],
      ['UH1', 'ALL', 'SHORT', '0.02', '1', '2'],
      ['UH1', 'ALL', 'MEDIUM', '0.03', '3', '2', '0.1', '0.01', '0'],
      ['UH1', 'JUL', 'SHORT', '0.05', '1', '1'],
    ])
    const { pts, totalR } = rtkCurve(u[0]!.months.ALL, 0.01)
    expect(totalR).toBeCloseTo(0.05)
    let area = 0
    for (let i = 1; i < pts.length; i++) area += ((pts[i]!.total + pts[i - 1]!.total) / 2) * (pts[i]!.t - pts[i - 1]!.t)
    expect(area).toBeCloseTo(0.05, 3)
  })
})

describe('references', () => {
  const secs = {
    RAINGAGES: [R('RG1', 'INTENSITY', '0:15', '1.0', 'TIMESERIES', 'TS1')],
    INFLOWS: [R('J1', 'FLOW', 'TS1', 'FLOW', '1.0', '1.0', '0', 'H')],
    PUMPS: [R('P1', 'J1', 'J2', 'C1', 'ON')],
    DWF: [R('J1', 'FLOW', '0.5', '"H"')],
    RDII: [R('J1', 'UH1', '10')],
  }
  it('lists what uses a name', () => {
    expect(usedBy('timeseries', 'ts1', secs).map((r) => r.id)).toEqual(['RG1', 'J1'])
    expect(usedBy('pattern', 'H', secs)).toHaveLength(2)
    expect(usedBy('curve', 'C1', secs)[0]!.what).toBe('Pump')
    expect([...allReferenced('hydrograph', secs).keys()]).toEqual(['UH1'])
  })
  it('renames everywhere it is used', () => {
    const ch = renameRefs('timeseries', 'TS1', 'Storm', secs)
    expect(ch.RAINGAGES![0]!.values[5]).toBe('Storm')
    expect(ch.INFLOWS![0]!.values[2]).toBe('Storm')
    expect(ch.PUMPS).toBeUndefined()
    expect(renameRefs('pattern', 'H', 'Hour', secs).DWF![0]!.values[3]).toBe('Hour')
  })
})

describe('reading files', () => {
  it('reads timestamps in common forms', () => {
    expect(readStamp('2024-06-01T13:15:00Z')).toEqual({ date: '06/01/2024', time: '13:15' })
    expect(readStamp('6/1/2024 1:15 PM')).toEqual({ date: '06/01/2024', time: '13:15' })
    expect(readStamp('01/06/2024', '01:15', true)).toEqual({ date: '06/01/2024', time: '01:15' })
    expect(readStamp('1.5')).toEqual({ date: '', time: '1.5' })
  })
  it('reads a SWMM file with a station column', () => {
    const imp = readSeriesText('; rain\nRG1 06/01/2024 00:15 0.12\nRG1 06/01/2024 00:30 0.2\n')
    expect(imp.points).toHaveLength(2)
    expect(imp.points[0]).toEqual({ date: '06/01/2024', time: '00:15', values: ['0.12'] })
    const ymd = readSeriesText('STA1 2024 6 1 0 15 0.1\nSTA1 2024 6 1 1 0 0.3\n')
    expect(ymd.names).toEqual(['STA1'])
    expect(ymd.points[1]).toEqual({ date: '06/01/2024', time: '01:00', values: ['0.3'] })
  })
  it('reads CSV with a header and several value columns', () => {
    const imp = readSeriesText('Timestamp,Flow A,Flow B\n2024-06-01 00:00,1.5,2\n2024-06-01 00:15,1.6,\n2024-06-02 00:00,1.7,2.2\n')
    expect(imp.names).toEqual(['Flow A', 'Flow B'])
    const s = importedToSeries(imp, 1, 'B')
    expect(s.points).toEqual([
      { date: '06/01/2024', time: '00:00', value: '2' },
      { date: '06/02/2024', time: '00:00', value: '2.2' },
    ])
  })
  it('reads pasted spreadsheet cells with separate date and time columns', () => {
    const imp = readSeriesText('Date\tTime\tDepth\n6/1/2024\t0:00\t0.1\n6/1/2024\t0:05\t0.2\n')
    expect(imp.names).toEqual(['Depth'])
    expect(imp.points[1]).toEqual({ date: '06/01/2024', time: '00:05', values: ['0.2'] })
  })
  it('reads elapsed hours and curve pairs', () => {
    expect(readSeriesText('0 0\n0.5 1.2\n1 0').points).toHaveLength(3)
    expect(readPairs('Depth\tArea\n0\t100\n2\t300')).toEqual([['0', '100'], ['2', '300']])
  })
  it('makes free names', () => {
    expect(freeName('Pump curve', ['Pump_curve', 'pump_curve2'])).toBe('Pump_curve3')
  })
})
