import { describe, expect, it } from 'vitest'
import { filterReady, matchFilter, parsePasteGrid } from './tableFilter'

describe('matchFilter', () => {
  it('compares numbers', () => {
    expect(matchFilter('12', '> 10', true)).toBe(true)
    expect(matchFilter('8', '> 10', true)).toBe(false)
    expect(matchFilter('0.5', '<=0.5', true)).toBe(true)
    expect(matchFilter('0', '!= 0', true)).toBe(false)
    expect(matchFilter('3', '<> 0', true)).toBe(true)
    expect(matchFilter('12', '12', true)).toBe(true)
    expect(matchFilter('', '> 0', true)).toBe(false)
  })
  it('takes ranges either way round', () => {
    expect(matchFilter('0.3', '0.1-0.5', true)).toBe(true)
    expect(matchFilter('0.3', '0.5 to 0.1', true)).toBe(true)
    expect(matchFilter('0.6', '0.1..0.5', true)).toBe(false)
    expect(matchFilter('-2', '-5 - -1', true)).toBe(true)
  })
  it('matches words by contains, or exactly with =', () => {
    expect(matchFilter('MH012', 'mh01', false)).toBe(true)
    expect(matchFilter('MH012', '=mh01', false)).toBe(false)
    expect(matchFilter('MH01', '=mh01', false)).toBe(true)
    expect(matchFilter('CIRCULAR', '!=circ', false)).toBe(false)
    expect(matchFilter('anything', '  ', false)).toBe(true)
  })
})

describe('filterReady', () => {
  it('ignores half-typed comparisons', () => {
    expect(filterReady('>', true)).toBe(false)
    expect(filterReady('> 3', true)).toBe(true)
    expect(filterReady('', false)).toBe(false)
  })
})

describe('parsePasteGrid', () => {
  it('splits Excel blocks and ignores single values', () => {
    expect(parsePasteGrid('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']])
    expect(parsePasteGrid('a\nb')).toEqual([['a'], ['b']])
    expect(parsePasteGrid('12.5')).toBeNull()
  })
})
