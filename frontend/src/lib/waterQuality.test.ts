import { describe, expect, it } from 'vitest'
import {
  coverageTotal,
  parseBuildup,
  parseCoverages,
  parsePollutants,
  renameEverywhere,
  serializeBuildup,
  serializeCoverages,
  serializePollutants,
} from './waterQuality'

const row = (s: string) => ({ values: s.split(/\s+/), comment: '' })

describe('water quality sections', () => {
  it('round-trips pollutants with defaults filled in', () => {
    const ps = parsePollutants([row('TSS MG/L 0 0 0 0'), row('Lead UG/L 0 0 0 0 NO TSS 0.2')])
    expect(ps[0]).toMatchObject({ name: 'TSS', units: 'MG/L', snowOnly: 'NO', coPoll: '*' })
    expect(ps[1]).toMatchObject({ coPoll: 'TSS', coFrac: '0.2' })
    expect(serializePollutants(ps)[0]!.values).toEqual(['TSS', 'MG/L', '0', '0', '0', '0', 'NO', '*', '0', '0', '0'])
  })
  it('reads several land uses on one coverage line and writes one line per subcatchment', () => {
    const c = parseCoverages([row('S1 Residential 50 Commercial 30'), row('S2 Residential 100')])
    expect(c.S1).toEqual({ Residential: '50', Commercial: '30' })
    expect(coverageTotal(c.S1)).toBe(80)
    const out = serializeCoverages({ ...c, S3: { Residential: '0' } }, ['S2', 'S1', 'S3'])
    expect(out.map((r) => r.values)).toEqual([['S2', 'Residential', '100'], ['S1', 'Residential', '50', 'Commercial', '30']])
  })
  it('skips NONE buildup rows', () => {
    const b = parseBuildup([row('Residential TSS POW 50 2 0.5 AREA'), row('Commercial TSS NONE 0 0 0 AREA')])
    expect(serializeBuildup(b).map((r) => r.values[0])).toEqual(['Residential'])
  })
  it('renames a land use in buildup, washoff and coverage', () => {
    const r = renameEverywhere('landuse', 'Res', 'Residential', {
      pollutants: [],
      buildup: [{ landuse: 'Res', pollutant: 'TSS', fn: 'EXP', c1: '1', c2: '1', c3: '0', perUnit: 'AREA' }],
      washoff: [{ landuse: 'Res', pollutant: 'TSS', fn: 'EMC', c1: '80', c2: '0', sweep: '0', bmp: '0' }],
      coverage: { S1: { Res: '60' } },
    })
    expect(r.buildup[0]!.landuse).toBe('Residential')
    expect(r.washoff[0]!.landuse).toBe('Residential')
    expect(r.coverage.S1).toEqual({ Residential: '60' })
  })
})
