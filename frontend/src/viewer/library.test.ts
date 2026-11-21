import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER, matches, parseRepo, rawUrl, type LibraryModel } from './library'

const lid: LibraryModel = { p: 'LID/lid2_evap timeseries.inp', t: 'LID with evaporation', u: 'CFS', r: 'DYNWAVE', n: 1, s: 2, st: 'ok', g: ['lid'], rpt: '.rpt', out: '.out', md: 1 }
const big: LibraryModel = { p: 'SWMM5_NCIMM/12350_H_Elements.inp', u: 'CMS', r: 'DYNWAVE', n: 6153, l: 6239, st: 'warn', g: ['pumps', 'storage'] }

describe('model library', () => {
  it('searches words in any order across path, title and tags', () => {
    expect(matches(lid, { ...EMPTY_FILTER, q: 'evaporation lid' })).toBe(true)
    expect(matches(lid, { ...EMPTY_FILTER, q: 'pumps' })).toBe(false)
    expect(matches(big, { ...EMPTY_FILTER, q: 'storage ncimm' })).toBe(true)
  })
  it('filters by folder, feature, units, size, status and results', () => {
    expect(matches(lid, { ...EMPTY_FILTER, folders: ['LID'], features: ['lid'], units: 'US', size: 'small', status: 'ok', results: true })).toBe(true)
    expect(matches(big, { ...EMPTY_FILTER, units: 'US' })).toBe(false)
    expect(matches(big, { ...EMPTY_FILTER, size: 'large', features: ['pumps', 'storage'] })).toBe(true)
    expect(matches(big, { ...EMPTY_FILTER, results: true })).toBe(false)
  })
  it('reads repositories from text or URLs', () => {
    expect(parseRepo('SWMMBobSWMM6/1729-SWMM5-Models-2030')).toEqual({ repo: 'SWMMBobSWMM6/1729-SWMM5-Models-2030', branch: undefined })
    expect(parseRepo('https://github.com/HydroCouple/openswmm.gui/tree/dev/examples')).toEqual({ repo: 'HydroCouple/openswmm.gui', branch: 'dev' })
    expect(parseRepo('not a repo')).toBeNull()
  })
  it('encodes raw URLs', () => {
    expect(rawUrl('a/b', 'master', 'LID/lid2_evap timeseries.inp')).toBe('https://raw.githubusercontent.com/a/b/master/LID/lid2_evap%20timeseries.inp')
  })
})
