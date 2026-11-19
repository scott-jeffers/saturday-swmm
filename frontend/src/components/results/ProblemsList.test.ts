import { describe, expect, it } from 'vitest'
import type { RptSummary } from '../../api/client'
import { problemsFromSummary } from './ProblemsList'

const s = {
  available: true,
  tables: [
    {
      title: 'Node Flooding Summary',
      object: 'node',
      columns: ['Node', 'Hours Flooded', 'Max Rate', 'Days', 'Time of Max', 'Total Flood Volume', 'Max Ponded Depth'],
      units: ['', 'hours', 'CFS', '', '', '10^6 gal', 'Feet'],
      rows: [
        ['J2', 0.1, 1.2, 0, '01:10', 0.001, 0],
        ['J5', 0.5, 4.0, 0, '01:05', 0.006, 0],
      ],
    },
    {
      title: 'Conduit Surcharge Summary',
      object: 'link',
      columns: ['Conduit', 'Hours Full Both Ends', 'Hours Full Upstream', 'Hours Full Dnstream', 'Hours Above Full Normal Flow', 'Hours Capacity Limited'],
      units: ['', '', '', '', '', ''],
      rows: [
        ['C1', 0.01, 0.01, 0.01, 0, 0],
        ['C4', 0.4, 0.4, 0.5, 0.3, 0.3],
      ],
    },
  ],
} as unknown as RptSummary

describe('problemsFromSummary', () => {
  it('puts flooding first, worst first, then pipes worst first', () => {
    const p = problemsFromSummary(s)
    expect(p.map((x) => x.id)).toEqual(['J5', 'J2', 'C4', 'C1'])
    expect(p[0].headline).toBe('Floods 6,000 gal')
    expect(p[2].headline).toBe('Full for 0.40 h')
    expect(p[2].detail).toContain('over capacity 0.30 h')
    expect(p[3].headline).toBe('Full for 0.01 h')
  })
  it('is empty for a clean run', () => {
    expect(problemsFromSummary({ available: true, tables: [] } as unknown as RptSummary)).toEqual([])
  })
})

import { engineFromReport } from '../RunSummaryCard'
describe('engineFromReport', () => {
  it('names the engine and flags pre-releases', () => {
    expect(engineFromReport('EPA STORM WATER MANAGEMENT MODEL - VERSION 5.2 (Build 5.2.4)')).toBe('EPA SWMM 5.2.4')
    expect(engineFromReport('OPENSWMM ENGINE - VERSION 6.0.0-alpha.4')).toBe('OpenSWMM 6.0.0-alpha.4 (pre-release)')
    expect(engineFromReport(null)).toBeNull()
  })
})
