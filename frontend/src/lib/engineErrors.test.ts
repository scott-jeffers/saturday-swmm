import { describe, expect, it } from 'vitest'
import { explainEngineMessage } from './engineErrors'

describe('explainEngineMessage', () => {
  it('explains an undefined object with section and line', () => {
    const e = explainEngineMessage('ERROR 209: undefined object J9 at line 45 of [CONDUITS] section:')
    expect(e.code).toBe(209)
    expect(e.objectId).toBe('J9')
    expect(e.objectType).toBe('link')
    expect(e.text).toContain('J9 is referred to but never defined')
    expect(e.text).toContain('Conduits, line 45')
    expect(e.hint).toBeTruthy()
  })
  it('names the conduit for adverse slope', () => {
    const e = explainEngineMessage('ERROR 115: adverse slope for Conduit C3.')
    expect(e.objectId).toBe('C3')
    expect(e.objectType).toBe('link')
    expect(e.text).toBe('Conduit C3 slopes uphill.')
  })
  it('keeps warnings as warnings', () => {
    const e = explainEngineMessage('WARNING 04: minimum elevation drop used for Conduit C1')
    expect(e.severity).toBe('warning')
    expect(e.objectId).toBe('C1')
  })
  it('passes through unknown text', () => {
    expect(explainEngineMessage('Something odd').text).toBe('Something odd')
  })
})
