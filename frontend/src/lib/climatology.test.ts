import { describe, expect, it } from 'vitest'
import { climateProblem, climateToText, parseClimate } from './climatology'

const rows = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => ({ values: l.trim().split(/\s+/).map((t) => t.replace(/^"|"$/g, '')) }))

describe('climatology', () => {
  it('reads and writes the climate sections', () => {
    const c = parseClimate(
      rows('MONTHLY 0.1 0.1 0.2 0.3 0.4 0.5 0.5 0.4 0.3 0.2 0.1 0.1\nRECOVERY P1\nDRY_ONLY YES'),
      rows('FILE "climate.dat" 01/01/2020\nWINDSPEED MONTHLY 1 2 3 4 5 6 7 8 9 10 11 12\nSNOWMELT 34 0.5 0.6 100 40 0\nADC IMPERVIOUS 1 1 1 1 1 0.9 0.8 0.7 0.6 0.5'),
      rows('RAINFALL 1.1 1.1 1.1 1.1 1.1 1.1 1.1 1.1 1.1 1.1 1.1 1.1\nN-PERV S1 P2'),
    )
    expect(c.evap.source).toBe('MONTHLY')
    expect(c.evap.dryOnly).toBe(true)
    expect(c.temp).toMatchObject({ source: 'FILE', file: 'climate.dat', fileStart: '01/01/2020' })
    expect(c.wind.monthly[11]).toBe('12')
    expect(c.snow.latitude).toBe('40')
    expect(c.adc.impervious[9]).toBe('0.5')
    const t = climateToText(c)
    expect(t.EVAPORATION).toContain('RECOVERY')
    expect(t.EVAPORATION).toMatch(/MONTHLY\s+0.1 0.1 0.2/)
    expect(t.TEMPERATURE).toMatch(/FILE\s+"climate.dat" 01\/01\/2020/)
    expect(t.TEMPERATURE).toContain('ADC IMPERVIOUS')
    expect(t.TEMPERATURE).not.toContain('ADC PERVIOUS')
    expect(t.ADJUSTMENTS).toContain('N-PERV S1 P2')
    expect(t.ADJUSTMENTS).toMatch(/RAINFALL\s+1.1/)
    expect(t.ADJUSTMENTS).not.toContain('TEMPERATURE')
    // round trip
    const again = parseClimate(rows(t.EVAPORATION.split('\n').slice(1).join('\n')), rows(t.TEMPERATURE!.split('\n').slice(1).join('\n')), rows(t.ADJUSTMENTS!))
    expect(again.evap).toEqual(c.evap)
    expect(again.temp).toEqual(c.temp)
  })

  it('flags evaporation from temperature without temperatures', () => {
    const c = parseClimate(rows('TEMPERATURE'), [], [])
    expect(climateProblem(c)).toMatch(/needs daily temperatures/)
    expect(climateToText(c).TEMPERATURE).toBeNull()
  })
})
