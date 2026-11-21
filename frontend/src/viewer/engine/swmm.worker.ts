/// <reference lib="webworker" />
/**
 * Runs EPA SWMM 5.2.4, compiled to WebAssembly, on an in-memory file system.
 * The model never leaves the browser. Posts progress (0–100) while it runs and
 * the .rpt text and .out bytes when it finishes.
 */
import { ConsoleStdout, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim'
import { withLidReportFiles } from '../../lib/lidReport'

export type RunRequest = { inpText: string; wasmUrl: string; totalHours: number }
export type RunMessage =
  | { type: 'progress'; percent: number }
  | { type: 'done'; exitCode: number; rptText: string; outBuf: ArrayBuffer | null; seconds: number; lidReports: { name: string; text: string }[] }
  | { type: 'error'; message: string }

const post = (m: RunMessage, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { inpText, wasmUrl, totalHours } = e.data
  try {
    // Every LID unit writes its own report (time series) next to the model.
    const lid = withLidReportFiles(inpText)
    const root = new Map<string, File>([['model.inp', new File(new TextEncoder().encode(lid.text))]])
    const dec = new TextDecoder()
    let tail = ''
    let last = -1
    // swmm5's console prints "hour: N" as it goes (no newlines), so read the raw stream.
    const stdout = new ConsoleStdout((buf: Uint8Array) => {
      tail = (tail + dec.decode(buf, { stream: true })).slice(-200)
      const days = [...tail.matchAll(/day:\s*(\d+)\s+hour:\s*(\d+)/g)].pop()
      const hours = [...tail.matchAll(/hour:\s*(\d+)/g)].pop()
      if (totalHours > 0 && hours) {
        const d = days ? Number(days[1]) : 0
        const h = d * 24 + Number(hours[1])
        const pct = Math.min(99, Math.floor((100 * h) / totalHours))
        if (pct !== last) {
          last = pct
          post({ type: 'progress', percent: pct })
        }
      }
    })
    const fds = [new OpenFile(new File([])), stdout, ConsoleStdout.lineBuffered(() => {}), new PreopenDirectory('.', root)]
    const wasi = new WASI(['swmm5', 'model.inp', 'model.rpt', 'model.out'], [], fds)
    const mod = await WebAssembly.compileStreaming(fetch(wasmUrl))
    const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport })
    const t0 = performance.now()
    const exitCode = wasi.start(inst as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } })
    const seconds = (performance.now() - t0) / 1000
    const rpt = root.get('model.rpt')
    const out = root.get('model.out')
    const rptText = rpt ? dec.decode(rpt.data) : ''
    const outBuf = out && out.data.byteLength > 0 ? out.data.slice().buffer : null
    const lidReports = lid.files.flatMap((name) => {
      const f = root.get(name)
      return f && f.data.byteLength ? [{ name, text: dec.decode(f.data) }] : []
    })
    post({ type: 'done', exitCode, rptText, outBuf, seconds, lidReports }, outBuf ? [outBuf] : [])
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message ?? String(err) })
  }
}
