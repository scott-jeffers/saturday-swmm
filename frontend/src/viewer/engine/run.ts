/**
 * Run the open model with EPA SWMM 5.2.4 in this browser (WebAssembly in a
 * Web Worker), then keep the results like a dropped .rpt/.out pair.
 */
import wasmUrl from './swmm5.wasm?url'
import { addRunResult, getProject } from '../store'
import { backendStarted, callBackend } from '../py/backend'
import { simulationWindow } from '../inp'
import type { RunMessage } from './swmm.worker'

export type BrowserRunState =
  | { status: 'idle' }
  | { status: 'running'; percent: number; started: number }
  | { status: 'completed'; seconds: number }
  /** A failed run's report is kept here (for INP text → Report), not among the results. */
  | { status: 'failed'; error: string; rptText?: string }

let state: BrowserRunState = { status: 'idle' }
const subs = new Set<() => void>()
const set = (s: BrowserRunState) => {
  state = s
  subs.forEach((f) => f())
}
export const browserRunState = () => state
export function subscribeBrowserRun(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

function hoursBetween(a: string | null, b: string | null): number {
  const t = (x: string | null) => (x ? Date.parse(x.replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2').replace(' ', 'T')) : NaN)
  const h = (t(b) - t(a)) / 3_600_000
  return Number.isFinite(h) && h > 0 ? h : 0
}

/** The engine's ERROR lines, so a failed run says why. */
function reportErrors(rpt: string): string {
  const lines = rpt.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^ERROR\b/.test(l))
  return [...new Set(lines)].slice(0, 6).join('\n')
}

export async function runInBrowser(): Promise<void> {
  const p = getProject()
  if (!p) throw new Error('Open a model first')
  if (state.status === 'running') return
  const win = simulationWindow(p.model)
  // The text that runs: results are up to date while the model still matches it.
  const ranText = p.inpText
  const totalHours = hoursBetween(win.start, win.end)
  set({ status: 'running', percent: 0, started: Date.now() })
  // As on the desktop, a version is kept automatically before each run (History), once the editor is up.
  if (backendStarted()) await callBackend('POST', '/api/snapshots/before-run', '', null).catch(() => undefined)
  // Under a storm from the project's storm list, the model runs with that storm's rain
  // wired in (as the desktop's run copy does); the editor prepares it.
  let runText = p.inpText
  let files = p.rainFiles ?? []
  let ran: { scenario?: { id: string; name: string }; storm?: { id: string; name: string } } | undefined
  if (p.storm && p.storm.id !== 'model' && (backendStarted() || Object.keys(p.projectFiles ?? {}).some((k) => k.startsWith('storms/')))) {
    const r = await callBackend('POST', '/api/storms/run-input', '', null).catch((e: Error) => ({ status: 500, json: { detail: e.message } }))
    if (r.status >= 400) {
      set({ status: 'failed', error: (r.json as { detail?: string })?.detail ?? 'Couldn’t prepare the storm for this run' })
      return
    }
    const j = r.json as { text: string; files: { name: string; text: string }[]; scenario: { id: string; name: string }; storm: { id: string; name: string } }
    runText = j.text
    files = [...files.filter((f) => !j.files.some((g) => g.name === f.name)), ...j.files]
    ran = { scenario: j.scenario, storm: j.storm }
  }
  const worker = new Worker(new URL('./swmm.worker.ts', import.meta.url), { type: 'module' })
  await new Promise<void>((resolve) => {
    worker.onmessage = async (e: MessageEvent<RunMessage>) => {
      const m = e.data
      if (m.type === 'progress') {
        set({ status: 'running', percent: m.percent, started: state.status === 'running' ? state.started : Date.now() })
        return
      }
      worker.terminate()
      if (m.type === 'error') {
        set({ status: 'failed', error: m.message })
      } else if (m.exitCode !== 0 || !m.outBuf) {
        set({ status: 'failed', error: reportErrors(m.rptText) || `EPA SWMM stopped (exit code ${m.exitCode})`, rptText: m.rptText || undefined })
      } else {
        // A time in the name tells runs apart; it can be renamed from the results menu.
        const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        await addRunResult(m.rptText, m.outBuf, `Run at ${at} (EPA SWMM 5.2)`, m.lidReports, ranText, ran)
        set({ status: 'completed', seconds: m.seconds })
      }
      resolve()
    }
    worker.onerror = (e) => {
      worker.terminate()
      set({ status: 'failed', error: e.message || 'The engine could not start in this browser' })
      resolve()
    }
    worker.postMessage({ inpText: runText, wasmUrl: new URL(wasmUrl, window.location.href).href, totalHours, files })
  })
}
