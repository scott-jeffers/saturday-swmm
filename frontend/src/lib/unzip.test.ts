import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unzip } from './unzip'

describe('unzip', () => {
  it('reads deflate entries', async () => {
    const buf = readFileSync(new URL('./unzip.fixture.zip', import.meta.url))
    const files = await unzip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    expect(files.map((f) => f.name)).toEqual(['a.inp', 'b.txt'])
    expect(new TextDecoder().decode(files[0].data)).toContain('hello hello')
  })
})
