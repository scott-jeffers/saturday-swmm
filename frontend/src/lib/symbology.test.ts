import { describe, expect, it } from 'vitest'
import { breaksFor, classOf, jenks, recommendedFor, samplePalette } from './symbology'

describe('symbology', () => {
  it('finds natural breaks between clusters', () => {
    const v = [1, 1.1, 1.2, 5, 5.1, 5.2, 9, 9.1, 9.3]
    const b = jenks(v, 3)
    expect(b[0]).toBe(1)
    expect(b[3]).toBe(9.3)
    expect(b[1]).toBe(1.2)
    expect(b[2]).toBe(5.2)
  })
  it('makes rounded, equal and quantile edges', () => {
    expect(breaksFor([0.3, 4.7], 5, 'pretty')).toEqual([0, 1, 2, 3, 4, 5])
    expect(breaksFor([0, 10], 2, 'equal')).toEqual([0, 5, 10])
    expect(breaksFor([1, 1, 1, 1, 2], 4, 'quantile')).toEqual([1, 2])
  })
  it('classifies into open-ended recommended classes', () => {
    const r = recommendedFor('r:Link Flow Summary:Max/Full Flow', false)!
    const edges = [-Infinity, ...r.inner, Infinity]
    expect(classOf(0.2, edges)).toBe(0)
    expect(classOf(1.4, edges)).toBe(3)
    expect(recommendedFor('r:Link Flow Summary:Maximum Velocity', true)!.inner[0]).toBe(2)
  })
  it('samples a palette at any count', () => {
    expect(samplePalette(['#000000', '#ffffff'], 3)).toEqual(['#000000', '#808080', '#ffffff'])
    expect(samplePalette(['#000000', '#ffffff'], 2, true)).toEqual(['#ffffff', '#000000'])
  })
})
