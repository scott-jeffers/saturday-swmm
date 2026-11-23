import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { explainError, explainText } from './explainError'

describe('explainError', () => {
  it('uses the field and fix the server gives', () => {
    const e = explainError(new ApiError(422, { message: 'Length can’t be 0.', field: 'length', fix: 'Enter more than 0.' }, 'x'))
    expect(e).toMatchObject({ message: 'Length can’t be 0.', field: 'length', fix: 'Enter more than 0.', status: 422 })
  })
  it('reads FastAPI validation lists', () => {
    const e = explainError(new ApiError(422, [{ loc: ['body', 'max_depth'], msg: 'Input should be a valid number' }], 'x'))
    expect(e.field).toBe('max_depth')
    expect(e.message).toBe('Max depth: should be a valid number.')
  })
  it('explains SWMM error codes', () => {
    const e = explainText('ERROR 138: node J4 has initial depth greater than maximum depth.')
    expect(e.message).toMatch(/starts deeper than its maximum depth/)
    expect(e.fix).toMatch(/initial depth/)
  })
  it('explains a lost connection', () => {
    expect(explainError(new TypeError('Failed to fetch')).fix).toMatch(/still running/)
  })
})
