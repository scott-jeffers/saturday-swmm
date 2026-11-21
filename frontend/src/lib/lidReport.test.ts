import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lidSeriesAtPeriods, parseLidReport, parseLidReports, usedColumns } from './lidReport'

const TEXT = readFileSync(join(__dirname, '__fixtures__', 'lid_raingarden.txt'), 'utf8')

describe('LID report files', () => {
  it('reads the unit, its subcatchment and every line', () => {
    const r = parseLidReport(TEXT)!
    expect(r.key).toBe('S1 · RainGarden')
    expect(r.us).toBe(true)
    expect(r.hours.length).toBeGreaterThan(300)
    expect(r.hours[0]).toBeCloseTo(0.017)
    expect(r.values[0][0]).toBeCloseTo(0.055) // total inflow
  })

  it('holds values between lines when lined up with report steps', () => {
    const r = parseLidReport(TEXT)!
    const s = lidSeriesAtPeriods(r, 'inflow', 300, 72) // 5-minute steps, 6 hours
    expect(s).toHaveLength(72)
    expect(s[0]).toBeCloseTo(0.06) // the line at 00:05
    expect(Math.max(...s)).toBeGreaterThan(0.5)
  })

  it('names repeated units apart and skips other files', () => {
    const rs = parseLidReports([TEXT, TEXT, 'not a report'])
    expect(rs.map((r) => r.key)).toEqual(['S1 · RainGarden', 'S1 · RainGarden (2)'])
    expect(usedColumns(rs).map((c) => c.id)).toContain('infil')
  })
})
