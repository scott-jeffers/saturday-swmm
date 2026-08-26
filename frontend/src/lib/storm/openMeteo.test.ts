import { describe, expect, it } from 'vitest'
import {
  aggregateDailyTemperature,
  buildClimateDatBody,
  defaultSimulationYear,
  hourlyToStormSteps,
  parseOpenMeteoResponse,
  resolveDateRange,
  suggestedOpenMeteoFilename,
} from './openMeteo'

describe('openMeteo helpers', () => {
  it('defaults simulation year to previous calendar year', () => {
    expect(defaultSimulationYear()).toBe(new Date().getFullYear() - 1)
  })

  it('resolves a full calendar year', () => {
    const r = resolveDateRange({ year: 2023 })
    expect(r).toEqual({
      startDate: '2023-01-01',
      endDate: '2023-12-31',
      startYear: 2023,
      labelStart: '2023-01-01',
      labelEnd: '2023-12-31',
    })
  })

  it('rejects custom ranges longer than 366 days', () => {
    expect(() =>
      resolveDateRange({ startDate: '2020-01-01', endDate: '2021-12-31' }),
    ).toThrow(/366/)
  })

  it('rejects inverted custom ranges', () => {
    expect(() =>
      resolveDateRange({ startDate: '2023-06-01', endDate: '2023-01-01' }),
    ).toThrow(/on or before/)
  })

  it('aggregates daily min/max temperature', () => {
    const daily = aggregateDailyTemperature(
      ['2023-01-01T00:00', '2023-01-01T12:00', '2023-01-02T00:00'],
      [0, 10, -5],
    )
    expect(daily['2023-01-01']).toEqual({ minC: 0, maxC: 10 })
    expect(daily['2023-01-02']).toEqual({ minC: -5, maxC: -5 })
  })

  it('parses Open-Meteo JSON and builds storm steps', () => {
    const climate = parseOpenMeteoResponse(
      {
        hourly: {
          time: ['2023-06-01T00:00', '2023-06-01T01:00'],
          precipitation: [2.54, 0],
          temperature_2m: [20, 21],
        },
      },
      { startDate: '2023-06-01', endDate: '2023-06-01' },
    )
    expect(climate.totalPrecipMm).toBeCloseTo(2.54)
    expect(climate.precipitationMm).toEqual([2.54, 0])
    const metric = hourlyToStormSteps(climate, 'metric')
    expect(metric[0]!.depthStep).toBeCloseTo(2.54)
    const us = hourlyToStormSteps(climate, 'us')
    expect(us[0]!.depthStep).toBeCloseTo(0.1)
  })

  it('builds climate.dat with Celsius or Fahrenheit', () => {
    const daily = { '2023-01-01': { minC: 0, maxC: 10 } }
    const metric = buildClimateDatBody(daily, 'metric')
    expect(metric).toContain('OPENMETEO 2023 1 1 10.000 0.000')
    const us = buildClimateDatBody(daily, 'us')
    expect(us).toContain('OPENMETEO 2023 1 1 50.000 32.000')
  })

  it('suggests openmeteo_YYYY.dat for full years', () => {
    expect(suggestedOpenMeteoFilename(resolveDateRange({ year: 2022 }))).toBe(
      'openmeteo_2022.dat',
    )
  })
})
