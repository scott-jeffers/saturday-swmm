/**
 * Client for the in-browser backend (py.worker.ts): the desktop app's own
 * Python code for model editing, undo/redo, model tools and restore points,
 * running in Pyodide. Booted on first use (a few seconds; Python and its
 * packages come from the jsDelivr CDN and are cached by the browser).
 *
 * The viewer store stays the source of truth: before each call the model and
 * rain files are written into the worker's /project folder if they changed,
 * and after a call the model is read back into the store.
 */
import { getProject, RAIN_FILE, setFromBackend } from '../store'

type Res = { status: number; body: string; ctype: string }
let worker: Worker | null = null
let ready: Promise<void> | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const progress = new Set<(text: string | null) => void>()
let synced: { name: string; text: string; rain: string } | null = null
const ROOT = '/project'
const rel = (abs: string) => (abs.startsWith(`${ROOT}/`) ? abs.slice(ROOT.length + 1) : abs)
const isRain = (path: string) => !path.includes('/') && RAIN_FILE.test(path)

/** Watch boot progress ("Loading Python"…, then null when ready). */
export function onBackendProgress(f: (text: string | null) => void) {
  progress.add(f)
  return () => void progress.delete(f)
}
const say = (t: string | null) => progress.forEach((f) => f(t))

function send<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ ...msg, id })
  })
}

/** Start the backend (idempotent). */
export function bootBackend(): Promise<void> {
  if (ready) return ready
  worker = new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { id?: number; ok?: boolean; result?: unknown; error?: string; op?: string; text?: string }
    if (m.op === 'progress') return say(m.text ?? null)
    const p = m.id !== undefined ? pending.get(m.id) : undefined
    if (!p) return
    pending.delete(m.id!)
    if (m.ok) p.resolve(m.result)
    else p.reject(new Error(m.error || 'The editor failed'))
  }
  say('Loading the editor')
  ready = send<void>({ op: 'init', base: import.meta.env.BASE_URL }).then(
    () => say(null),
    (e) => {
      ready = null
      worker?.terminate()
      worker = null
      say(null)
      throw new Error(`The editor couldn’t load (${(e as Error).message}). Check your connection and try again.`)
    },
  )
  return ready
}

export const backendStarted = () => ready !== null

/** Put the viewer's model and rain files into the worker if they changed. */
async function sync(): Promise<void> {
  const p = getProject()
  if (!p) throw Object.assign(new Error('No project is open'), { status: 404 })
  const rain = JSON.stringify(p.rainFiles ?? [])
  if (synced && synced.name === p.inpName && synced.text === p.inpText && synced.rain === rain) return
  // A model changed outside the editor (another file dropped in) starts afresh,
  // so undo can't step back into a different model.
  const fresh = !synced || synced.name !== p.inpName || synced.text !== p.inpText
  // The whole folder as saved in this browser (scenarios, restore points, storms…), then
  // the open model on top: the base .inp, or the scenario's when one is open.
  const active = p.activeInp ?? p.inpName
  const kept = fresh ? Object.entries(p.projectFiles ?? {}).map(([path, data]) => ({ path: `${ROOT}/${path}`, data })) : []
  const files = [
    ...kept,
    { path: `${ROOT}/${active}`, text: p.inpText },
    ...(p.rainFiles ?? []).map((f) => ({ path: `${ROOT}/${f.name}`, text: f.text })),
  ]
  await send({ op: 'write', files, clear: fresh })
  if (fresh) {
    const r = await send<Res>({ op: 'call', method: 'POST', path: '/api/projects/open', query: '', body: JSON.stringify({ path: '/project' }) })
    if (r.status >= 400) throw new Error(`Couldn’t open the model in the editor: ${r.body.slice(0, 200)}`)
  }
  synced = { name: p.inpName, text: p.inpText, rain }
}

/** Read the project back into the store after a change: which model is open (base or a
 *  scenario), its text, the rain files and every other file that changed. */
async function pull(): Promise<void> {
  const p = getProject()
  if (!p) return
  const cur = await send<Res>({ op: 'call', method: 'GET', path: '/api/projects/current', query: '', body: null })
  let info: { inp_path?: string; scenario_id?: string; scenario_name?: string; storm_id?: string; storm_name?: string } = {}
  try {
    info = JSON.parse(cur.body)
  } catch {
    /* keep the base */
  }
  const activeAbs = info.inp_path ?? `${ROOT}/${p.inpName}`
  const text = await send<string | null>({ op: 'read', path: activeAbs })
  if (text === null) return
  const d = await send<{ changed: { path: string; data: Uint8Array }[]; removed: string[] }>({ op: 'dump' })
  const changed: Record<string, Uint8Array> = {}
  for (const f of d.changed) {
    const r = rel(f.path)
    if (!isRain(r)) changed[r] = f.data
  }
  const listed = await send<string[]>({ op: 'list' })
  const rainFiles: { name: string; text: string }[] = []
  for (const f of listed.filter((x) => isRain(rel(x)))) {
    const t = await send<string | null>({ op: 'read', path: f })
    if (t !== null) rainFiles.push({ name: rel(f), text: t })
  }
  synced = { name: p.inpName, text, rain: JSON.stringify(rainFiles) }
  await setFromBackend({
    inpText: text,
    activeInp: rel(activeAbs),
    scenario: { id: info.scenario_id ?? 'base', name: info.scenario_name ?? 'Base' },
    storm: { id: info.storm_id ?? 'model', name: info.storm_name ?? 'Model rainfall' },
    changed,
    removed: d.removed.map(rel),
    rainFiles,
  })
}

let queue: Promise<unknown> = Promise.resolve()

/** Send one API request to the Python backend; calls run one at a time. */
export function callBackend(method: string, path: string, query: string, body: unknown): Promise<{ status: number; json: unknown }> {
  if (localStorage.getItem('saturday-swmm.debug') === '1') console.debug('[py]', method, path)
  const run = async () => {
    await bootBackend()
    await sync()
    const r = await send<Res>({ op: 'call', method, path, query, body: body === null || body === undefined ? null : JSON.stringify(body) })
    if (method !== 'GET') await pull()
    let json: unknown = r.body
    if (r.ctype.includes('json')) {
      try {
        json = JSON.parse(r.body)
      } catch {
        json = { detail: r.body }
      }
    }
    return { status: r.status, json }
  }
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

/** Paths the in-browser backend serves (everything else stays in TypeScript). */
export const BACKEND_PREFIXES = ['/api/model', '/api/edits', '/api/snapshots', '/api/inp', '/api/projects', '/api/scenarios', '/api/storms', '/api/scripts']
