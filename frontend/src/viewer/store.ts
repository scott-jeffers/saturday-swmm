/**
 * The viewer's "project": one .inp plus any number of result sets (.rpt/.out
 * pairs), all held in this browser. Kept in IndexedDB so a reload doesn't
 * lose them; nothing is uploaded anywhere.
 */

import { parseInp, type ParsedModel } from './inp'
import { OutError, SwmmOut } from './out'

export type ResultSet = {
  id: string
  label: string
  added: string
  rptName?: string
  rptText?: string | null
  outName?: string
  outBuf?: ArrayBuffer | null
  out?: SwmmOut | null
}

export type ViewerProject = {
  inpName: string
  inpText: string
  model: ParsedModel
  crs: string | null
  proj4: string | null
  results: ResultSet[] // newest first; results[0] is "current"
}

let project: ViewerProject | null = null
const listeners = new Set<() => void>()

export const getProject = () => project
export function subscribe(f: () => void) {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}
const notify = () => listeners.forEach((f) => f())

export function outOf(r: ResultSet | undefined): SwmmOut | null {
  if (!r?.outBuf) return null
  if (r.out === undefined) r.out = new SwmmOut(r.outBuf)
  return r.out
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase()
const now = () => new Date().toISOString().slice(0, 19)
let seq = 0
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`

export class ViewerFileError extends Error {}

/**
 * Add dropped files. A new .inp starts a new project (its results go with it);
 * .rpt/.out files become a result set, paired by file name.
 */
export async function addFiles(files: File[]): Promise<{ added: string[]; ignored: string[] }> {
  const added: string[] = []
  const ignored: string[] = []
  const inp = files.find((f) => /\.inp$/i.test(f.name))
  const rest = files.filter((f) => f !== inp)
  if (inp) {
    const text = await inp.text()
    project = { inpName: inp.name, inpText: text, model: parseInp(text), crs: null, proj4: null, results: [] }
    added.push(inp.name)
  }
  if (!project) {
    if (rest.length) throw new ViewerFileError('Add the model’s .inp file first (you can drop it together with its .rpt and .out).')
    return { added, ignored }
  }
  const groups = new Map<string, { rpt?: File; out?: File }>()
  for (const f of rest) {
    const kind = /\.rpt$/i.test(f.name) ? 'rpt' : /\.out$/i.test(f.name) ? 'out' : null
    if (!kind) {
      ignored.push(f.name)
      continue
    }
    const g = groups.get(stem(f.name)) ?? {}
    g[kind] = f
    groups.set(stem(f.name), g)
  }
  for (const [s, g] of groups) {
    // fill the newest set with the same name that is missing this half, else start a new set
    let set = project.results.find((r) => (r.rptName ? stem(r.rptName) : stem(r.outName ?? '')) === s && (g.rpt ? !r.rptName : !r.outName))
    if (!set || (g.rpt && g.out)) set = { id: newId(), label: '', added: now() }
    if (g.out) {
      const buf = await g.out.arrayBuffer()
      try {
        set.out = new SwmmOut(buf)
      } catch (e) {
        if (e instanceof OutError) throw new ViewerFileError(`${g.out.name}: ${e.message}`)
        throw e
      }
      set.outBuf = buf
      set.outName = g.out.name
      added.push(g.out.name)
    }
    if (g.rpt) {
      set.rptText = await g.rpt.text()
      set.rptName = g.rpt.name
      added.push(g.rpt.name)
    }
    if (!project.results.includes(set)) project.results.unshift(set)
  }
  await save()
  notify()
  return { added, ignored }
}

export async function setCrs(code: string | null, proj4: string | null) {
  if (!project) return
  project.crs = code
  project.proj4 = proj4
  await save()
  notify()
}

/** Store the .rpt/.out of a run made in this browser as the newest result set. */
export async function addRunResult(rptText: string, outBuf: ArrayBuffer | null, label: string) {
  if (!project) return
  const base = project.inpName.replace(/\.[^.]+$/, '')
  const set: ResultSet = { id: newId(), label, added: now(), rptName: `${base}.rpt`, rptText }
  if (outBuf) {
    set.outBuf = outBuf
    set.outName = `${base}.out`
    set.out = new SwmmOut(outBuf)
  }
  project.results.unshift(set)
  await save()
  notify()
}

export async function updateResult(id: string, patch: { label?: string }) {
  const r = project?.results.find((x) => x.id === id)
  if (r && patch.label !== undefined) r.label = patch.label.slice(0, 120)
  await save()
  notify()
}

export async function removeResult(id: string) {
  if (!project) return
  project.results = project.results.filter((r) => r.id !== id)
  await save()
  notify()
}

export async function closeProject() {
  project = null
  await idb('delete')
  notify()
}

// ------------------------------------------------------------ IndexedDB
const DB = 'saturday-swmm-viewer'
const KEY = 'project'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb(op: 'get' | 'put' | 'delete', value?: unknown): Promise<unknown> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await open()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', op === 'get' ? 'readonly' : 'readwrite')
      const st = tx.objectStore('files')
      const req = op === 'get' ? st.get(KEY) : op === 'put' ? st.put(value, KEY) : st.delete(KEY)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null // private mode or storage full: keep working in memory
  }
}

async function save() {
  if (!project) return
  const { model: _m, ...rest } = project
  void _m
  await idb('put', { ...rest, results: rest.results.map(({ out: _o, ...r }) => (void _o, r)) })
}

/** Restore the last session's files (call once at startup). */
export async function restore(): Promise<boolean> {
  const v = (await idb('get')) as Omit<ViewerProject, 'model'> | null
  if (!v?.inpText) return false
  project = { ...v, model: parseInp(v.inpText) }
  notify()
  return true
}

/** For tests: load a project directly from text and buffers. */
export function loadForTest(inpName: string, inpText: string, sets: { rptText?: string; outBuf?: ArrayBuffer; name?: string }[]) {
  project = {
    inpName, inpText, model: parseInp(inpText), crs: 'EPSG:25832', proj4: null,
    results: sets.map((s, i) => ({
      id: `r${i}`, label: s.name ?? '', added: now(), rptText: s.rptText ?? null, rptName: s.rptText ? 'model.rpt' : undefined,
      outBuf: s.outBuf ?? null, outName: s.outBuf ? 'model.out' : undefined,
    })),
  }
}
