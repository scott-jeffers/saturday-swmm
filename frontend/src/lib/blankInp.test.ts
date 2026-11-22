import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderBlankInp } from './blankInp'

const py = readFileSync(fileURLToPath(new URL('../../../backend/app/services/blank_inp.py', import.meta.url)), 'utf8')
const template = /BLANK_INP_TEMPLATE = """([\s\S]*?)"""/.exec(py)![1]!

describe('renderBlankInp', () => {
  it('matches the backend template exactly', () => {
    const vals: Record<string, string> = { title: 'Mill Creek', flow_units: 'CMS', infiltration: 'GREEN_AMPT', routing: 'KINWAVE', start_date: '06/01/2025', end_date: '06/02/2025' }
    const expected = template.replace(/\{(\w+)\}/g, (_, k: string) => vals[k]!)
    expect(renderBlankInp({ title: 'Mill Creek', flowUnits: 'cms', infiltration: 'green_ampt', routing: 'KINWAVE', startDate: '2025-06-01' })).toBe(expected)
  })
  it('falls back to safe defaults', () => {
    const t = renderBlankInp({ title: 'x', flowUnits: 'nope', startDate: 'bad' })
    expect(t).toContain('FLOW_UNITS           CFS')
    expect(t).toContain('START_DATE           01/01/2024')
    expect(t).toContain('END_DATE             01/02/2024')
  })
})
