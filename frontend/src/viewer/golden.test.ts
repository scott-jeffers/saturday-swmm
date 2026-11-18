/**
 * The viewer's in-browser API must answer exactly like the desktop backend.
 * __golden__/<case>/ holds a model, the .rpt/.out a real run wrote, and the
 * backend's responses (made with scripts/make_viewer_golden.py). Extra cases
 * can be checked with VIEWER_GOLDEN=/path/to/case1,/path/to/case2.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { handle } from './router'
import { loadForTest } from './store'

const here = join(__dirname, '__golden__')
const cases = [
  ...readdirSync(here).map((d) => join(here, d)),
  ...(process.env.VIEWER_GOLDEN ?? '').split(',').filter(Boolean),
].filter((d) => existsSync(join(d, 'golden.json')))

// Fields that legitimately differ between the two (machine or file paths).
const SKIP = new Set(['cpu_count', 'path'])

function diff(a: unknown, b: unknown, at: string, out: string[]) {
  if (out.length > 20) return
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)))) out.push(`${at}: ${a} != ${b}`)
    return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at}: length ${a.length} != ${b.length}`)
    else a.forEach((v, i) => diff(v, b[i], `${at}[${i}]`, out))
    return
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).filter((k) => !SKIP.has(k))
    const kb = Object.keys(b as object).filter((k) => !SKIP.has(k))
    for (const k of new Set([...ka, ...kb])) {
      if (!(k in (a as object))) out.push(`${at}.${k}: missing in viewer`)
      else if (!(k in (b as object))) out.push(`${at}.${k}: extra in viewer`)
      else diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`, out)
    }
    return
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
}

for (const dir of cases) {
  describe(`viewer matches backend: ${dir.split('/').pop()}`, () => {
    const golden = JSON.parse(readFileSync(join(dir, 'golden.json'), 'utf8')) as Record<string, { status: number; json: unknown }>
    beforeAll(() => {
      const out = readFileSync(join(dir, 'model.out'))
      loadForTest('model.inp', readFileSync(join(dir, 'model.inp'), 'utf8'), [
        { rptText: readFileSync(join(dir, 'model.rpt'), 'utf8'), outBuf: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) },
      ])
    })
    for (const [key, want] of Object.entries(golden)) {
      it(key, async () => {
        const got = await handle('GET', new URL(key.replace(/ /g, '%20'), 'http://x'), null)
        expect(got.status).toBe(want.status)
        if (want.status !== 200) return
        const problems: string[] = []
        diff(got.json, want.json, 'response', problems)
        expect(problems).toEqual([])
      })
    }
  })
}
