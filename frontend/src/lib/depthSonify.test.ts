import { describe, expect, it } from 'vitest'
import {
  noteDurationSec,
  peakDepth,
  peakToGain,
  peakToMidi,
  profilePeakMax,
} from './depthSonify'

describe('profile peak sonify', () => {
  it('finds peak depth and period index', () => {
    expect(peakDepth([0.01, 0.4, 0.1])).toEqual({ depth: 0.4, periodIndex: 1 })
  })

  it('maps higher peaks to higher pitch and gain', () => {
    expect(peakToMidi(0.8, 1)).toBeGreaterThan(peakToMidi(0.1, 1))
    expect(peakToGain(0.8, 1)).toBeGreaterThan(peakToGain(0.1, 1))
  })

  it('uses shared peak max across junctions', () => {
    expect(
      profilePeakMax([
        { id: 'a', values: [0.1, 0.2] },
        { id: 'b', values: [0.05, 0.9] },
      ]),
    ).toBe(0.9)
  })

  it('shortens notes for long profiles', () => {
    expect(noteDurationSec(3)).toBeGreaterThan(noteDurationSec(30))
  })
})
