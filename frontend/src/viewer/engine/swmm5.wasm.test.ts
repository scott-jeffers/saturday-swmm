// @vitest-environment node
import { mkdtempSync, readFileSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WASI } from 'node:wasi'
import { describe, expect, it } from 'vitest'

describe('EPA SWMM 5.2.4 compiled to WebAssembly', () => {
  it('runs the sample model and writes a report and a binary output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swmm-wasm-'))
    copyFileSync(join(__dirname, '../../../../examples/sample.inp'), join(dir, 'm.inp'))
    const wasi = new WASI({ version: 'preview1', args: ['swmm5', 'm.inp', 'm.rpt', 'm.out'], preopens: { '.': dir }, stdout: 2 })
    const mod = await WebAssembly.compile(readFileSync(join(__dirname, 'swmm5.wasm')))
    const inst = await WebAssembly.instantiate(mod, wasi.getImportObject() as WebAssembly.Imports)
    wasi.start(inst)
    const rpt = readFileSync(join(dir, 'm.rpt'), 'utf8')
    expect(rpt).toContain('VERSION 5.2 (Build 5.2.4)')
    expect(rpt).toMatch(/Flow Routing Continuity/)
    expect(rpt).not.toMatch(/^\s*ERROR/m)
    expect(existsSync(join(dir, 'm.out'))).toBe(true)
  })
})
