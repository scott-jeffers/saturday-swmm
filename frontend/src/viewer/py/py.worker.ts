/// <reference lib="webworker" />
/**
 * The desktop app's Python backend, running in this browser tab (Pyodide).
 * Serves model editing, undo/redo, model and network tools, restore points
 * and project files for the online viewer. Loaded only when first needed.
 *
 * Messages in:  {id, op:'init', base} | {id, op:'call', method, path, query, body}
 *               | {id, op:'write', files:[{path, text|data}], clear?:boolean} | {id, op:'read', path}
 *               | {id, op:'dump'}: files under /project changed since the last dump or write
 * Messages out: {id, ok:true, result} | {id, ok:false, error} | {op:'progress', text}
 */

type PyProxy = { toJs: () => unknown; destroy?: () => void }
type Pyodide = {
  loadPackage: (names: string[], opts?: { messageCallback?: (m: string) => void }) => Promise<void>
  pyimport: (name: string) => { install: { callKwargs: (url: string, kw: Record<string, unknown>) => Promise<void> } }
  unpackArchive: (buf: Uint8Array, format: string, opts: { extractDir: string }) => void
  runPythonAsync: (code: string) => Promise<PyProxy | string | number | undefined>
  globals: { set: (k: string, v: unknown) => void }
  FS: {
    writeFile: (path: string, data: string | Uint8Array) => void
    readFile: ((path: string, opts: { encoding: 'utf8' }) => string) & ((path: string) => Uint8Array)
    mkdirTree: (path: string) => void
    readdir: (path: string) => string[]
    stat: (path: string) => { mode: number; mtime: Date | number; size: number }
    isDir: (mode: number) => boolean
    unlink: (path: string) => void
    rmdir: (path: string) => void
  }
}

let py: Pyodide | null = null
/** What each project file looked like at the last dump, to send only changes. */
let seen = new Map<string, string>()
let booting: Promise<Pyodide> | null = null
const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

async function boot(base: string): Promise<Pyodide> {
  const manifest = (await (await fetch(`${base}pyodide/manifest.json`)).json()) as { pyodide: string; packages: string[]; wheels: string[] }
  const cdn = `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodide}/full/`
  post({ op: 'progress', text: 'Starting the editor' })
  const mod = (await import(/* @vite-ignore */ `${cdn}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> }
  const p = await mod.loadPyodide({ indexURL: cdn })
  post({ op: 'progress', text: 'Starting the editor' })
  await p.loadPackage(manifest.packages)
  const mp = p.pyimport('micropip')
  for (const w of manifest.wheels) {
    const buf = new Uint8Array(await (await fetch(`${base}pyodide/wheels/${w}`)).arrayBuffer())
    p.FS.writeFile(`/tmp/${w}`, buf)
    await mp.install.callKwargs(`emfs:/tmp/${w}`, { deps: false })
  }
  post({ op: 'progress', text: 'Loading the model tools' })
  const zip = new Uint8Array(await (await fetch(`${base}pyodide/backend.zip`)).arrayBuffer())
  p.unpackArchive(zip, 'zip', { extractDir: '/srv' })
  await p.runPythonAsync(`import sys\nsys.path.insert(0, '/srv')\nimport app.browser as _sb`)
  p.FS.mkdirTree('/project')
  return p
}

function walkFiles(p: Pyodide, dir: string, out: string[] = []): string[] {
  for (const name of p.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue
    const full = `${dir}/${name}`
    if (p.FS.isDir(p.FS.stat(full).mode)) walkFiles(p, full, out)
    else out.push(full)
  }
  return out
}
/** A file's fingerprint: size plus an FNV-1a hash of its bytes (mtimes are too coarse). */
const stamp = (p: Pyodide, f: string) => {
  const b = p.FS.readFile(f)
  let h = 0x811c9dc5
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 0x01000193)
  return `${b.length}:${h >>> 0}`
}

function rmTree(p: Pyodide, dir: string) {
  for (const name of p.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue
    const full = `${dir}/${name}`
    if (p.FS.isDir(p.FS.stat(full).mode)) {
      rmTree(p, full)
      p.FS.rmdir(full)
    } else p.FS.unlink(full)
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; op: string; [k: string]: unknown }
  try {
    if (msg.op === 'init') {
      booting ??= boot(String(msg.base))
      py = await booting
      post({ id: msg.id, ok: true, result: null })
      return
    }
    if (!py) throw new Error('The editor isn’t loaded yet')
    if (msg.op === 'write') {
      if (msg.clear) rmTree(py, '/project')
      for (const f of msg.files as { path: string; text?: string; data?: Uint8Array }[]) {
        const dir = f.path.slice(0, f.path.lastIndexOf('/'))
        if (dir) py.FS.mkdirTree(dir)
        py.FS.writeFile(f.path, f.data ?? f.text ?? '')
      }
      // What was just written is known to the caller: later dumps send only what changes after it.
      seen = new Map(walkFiles(py, '/project').map((f) => [f, stamp(py!, f)]))
      post({ id: msg.id, ok: true, result: null })
      return
    }
    if (msg.op === 'read') {
      let text: string | null = null
      try {
        text = py.FS.readFile(String(msg.path), { encoding: 'utf8' })
      } catch {
        text = null
      }
      post({ id: msg.id, ok: true, result: text })
      return
    }
    if (msg.op === 'dump') {
      const now = new Map(walkFiles(py, '/project').map((f) => [f, stamp(py!, f)]))
      const changed: { path: string; data: Uint8Array }[] = []
      for (const [f, st] of now) if (seen.get(f) !== st) changed.push({ path: f, data: py.FS.readFile(f) })
      const removed = [...seen.keys()].filter((f) => !now.has(f))
      seen = now
      post({ id: msg.id, ok: true, result: { changed, removed } })
      return
    }
    if (msg.op === 'list') {
      // project files by path (text files only, not hidden run copies)
      const out: string[] = []
      const walk = (dir: string) => {
        for (const name of py!.FS.readdir(dir)) {
          if (name === '.' || name === '..') continue
          const full = `${dir}/${name}`
          if (py!.FS.isDir(py!.FS.stat(full).mode)) walk(full)
          else out.push(full)
        }
      }
      walk('/project')
      post({ id: msg.id, ok: true, result: out })
      return
    }
    if (msg.op === 'call') {
      py.globals.set('_m', msg.method)
      py.globals.set('_p', msg.path)
      py.globals.set('_q', msg.query ?? '')
      py.globals.set('_b', msg.body ?? null)
      const r = (await py.runPythonAsync('await _sb.call(_m, _p, _q, _b)')) as PyProxy
      const [status, body, ctype] = r.toJs() as [number, string, string]
      r.destroy?.()
      post({ id: msg.id, ok: true, result: { status, body, ctype } })
      return
    }
    throw new Error(`Unknown op ${msg.op}`)
  } catch (err) {
    post({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
