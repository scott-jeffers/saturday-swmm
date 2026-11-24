import { describe, expect, it } from 'vitest'
import { crc32, makeZip } from './zip'
import { unzip } from './unzip'

describe('makeZip', () => {
  it('writes a zip the app can read back', async () => {
    const blob = makeZip([
      { path: 'model.inp', data: '[TITLE]\nhello\n' },
      { path: 'scenarios/a/model.inp', data: new TextEncoder().encode('ünïcode') },
    ])
    const out = await unzip(await blob.arrayBuffer())
    const names = out.map((f: { name: string }) => f.name)
    expect(names).toEqual(['model.inp', 'scenarios/a/model.inp'])
  })
  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
