import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { buildAttributes, classBreaks, classify, defaultRules, runChecks, runQuery } from './elementAttributes'

const f = (p: Record<string, unknown>): Feature => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [0, 0] } })
const features = [
  f({ object_type: 'node', id: 'A', elevation: 100, max_depth: 8 }),
  f({ object_type: 'node', id: 'B', elevation: 99.9, max_depth: 4 }),
  f({ object_type: 'link', id: 'L', link_kind: 'conduit', from_node: 'A', to_node: 'B', length: 100, diameter: 1, in_offset: 0, out_offset: 0 }),
]
const tables = [
  { title: 'Link Flow Summary', object: 'link' as const, columns: ['Link', 'Maximum Velocity', 'Max/Full Flow'], units: ['', 'ft/sec', ''], rows: [['L', 1.2, 1.4]] },
]

describe('element attributes', () => {
  const attrs = buildAttributes(features, tables, true)
  it('derives slope and cover', () => {
    expect(attrs.find((a) => a.key === 'd:slope')!.values.get('L')).toBeCloseTo(0.1)
    // rim A = 108, crown 101 → 7; rim B = 103.9, crown 100.9 → 3
    expect(attrs.find((a) => a.key === 'd:cover')!.values.get('L')).toBeCloseTo(3)
  })
  it('queries', () => {
    expect(runQuery(attrs, [{ attr: 'm:max_depth', op: '>', value: 5 }], ['A', 'B'])).toEqual(['A'])
  })
  it('checks design rules', () => {
    const { failures } = runChecks(attrs, defaultRules(true))
    const ids = failures.map((x) => x.rule.id).sort()
    expect(ids).toEqual(['cap', 'slope', 'vmin'])
  })
  it('classes', () => {
    const b = classBreaks([1, 2, 3, 4, 5], 4, 'equal')
    expect(b).toEqual([1, 2, 3, 4, 5])
    expect(classify(4.5, b)).toBe(3)
  })
})
