import { describe, expect, it } from 'vitest'
import { converter } from './units'

describe('display units', () => {
  it('converts US report units to SI', () => {
    expect(converter('Feet', 'si').unit).toBe('m')
    expect(converter('CFS', 'si').f(1)).toBeCloseTo(0.0283168)
    expect(converter('10^6 gal', 'si').f(1)).toBeCloseTo(3.78541)
  })
  it('converts SI to US and leaves unknown or model units alone', () => {
    expect(converter('CMS', 'us').f(0.0283168)).toBeCloseTo(1)
    expect(converter('Percent', 'si').unit).toBe('Percent')
    expect(converter('Feet', 'model').f(3)).toBe(3)
  })
})
