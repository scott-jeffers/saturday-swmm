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

import { formatVolume } from './units'
describe('formatVolume', () => {
  it('reads like people speak', () => {
    expect(formatVolume(0.008, '10^6 gal')).toBe('8,000 gal')
    expect(formatVolume(1.256, '10^6 gal')).toBe('1.26 Mgal')
    expect(formatVolume(0.0004, '10^6 ltr')).toBe('400 L')
    expect(formatVolume(0, '10^6 gal')).toBe('0 gal')
    expect(formatVolume(3, 'acre-ft')).toBe('3 acre-ft')
  })
})
