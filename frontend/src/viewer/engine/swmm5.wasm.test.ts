// @vitest-environment node
import { mkdtempSync, readFileSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WASI } from 'node:wasi'
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { parseLidReport, withLidReportFiles } from '../../lib/lidReport'

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

  it('writes a report for every LID unit when the run adds report files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'swmm-wasm-lid-'))
    const src = readFileSync(join(__dirname, '../../../../examples/LID_Sample/LID_Sample.inp'), 'utf8')
    const lid = withLidReportFiles(src)
    expect(lid.files).toHaveLength(7)
    writeFileSync(join(dir, 'm.inp'), lid.text)
    const wasi = new WASI({ version: 'preview1', args: ['swmm5', 'm.inp', 'm.rpt', 'm.out'], preopens: { '.': dir }, stdout: 2 })
    const mod = await WebAssembly.compile(readFileSync(join(__dirname, 'swmm5.wasm')))
    wasi.start(await WebAssembly.instantiate(mod, wasi.getImportObject() as WebAssembly.Imports))
    const reports = lid.files.map((f) => parseLidReport(readFileSync(join(dir, f), 'utf8')))
    expect(reports.map((r) => r?.key)).toContain('S1 · RainGarden')
    expect(reports.every((r) => r && r.hours.length > 10)).toBe(true)
  })
})
