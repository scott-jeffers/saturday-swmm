/**
 * The viewer's "project": one .inp plus any number of result sets (.rpt/.out
 * pairs), all held in this browser. Kept in IndexedDB so a reload doesn't
 * lose them; nothing is uploaded anywhere.
 */

import { parseInp, type ParsedModel } from './inp'
import { OutError, SwmmOut } from './out'
import { readTwoDPackage, TwoDPackageError, type TwoDPackage } from './twod'
import type { FeatureCollection } from 'geojson'
import type { GisLayer, GisLayerStyle, GisWebSource } from '../api/client'
import { fieldNames, geometryTypes, lonLatBounds } from '../lib/gisSources'

export type ResultSet = {
  id: string
  label: string
  added: string
  rptName?: string
  rptText?: string | null
  outName?: string
  outBuf?: ArrayBuffer | null
  out?: SwmmOut | null
  /** SWMM LID report files from this run: each LID unit's own time series. */
  lidReports?: { name: string; text: string }[]
}

export type ViewerProject = {
  inpName: string
  inpText: string
  model: ParsedModel
  crs: string | null
  proj4: string | null
  results: ResultSet[] // newest first; results[0] is "current"
  /** 2D mesh + results package (.ss2d / .ss2d.gz), kept as the file's bytes. */
  twod?: { name: string; buf: ArrayBuffer; pkg?: TwoDPackage } | null
  /** Rain data files (.dat, .txt…) that rain gages or time series read. */
  rainFiles?: { name: string; text: string }[]
  /** Background GIS layers: vector data held here, web layers by address. */
  gisLayers?: GisLayer[]
}

/** Extensions taken as rain data files. */
export const RAIN_FILE = /\.(dat|txt|rain|prn|tsf|csv)$/i

let project: ViewerProject | null = null
const listeners = new Set<() => void>()

export const getProject = () => project
export function subscribe(f: () => void) {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}
let version = 0
/** Bumps on every change, so React can tell an in-place update happened. */
export const getVersion = () => version
const notify = () => {
  version++
  listeners.forEach((f) => f())
}

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
  const twodFile = files.find((f) => /\.ss2d(\.gz)?$/i.test(f.name))
  const rain = files.filter((f) => RAIN_FILE.test(f.name))
  const rest = files.filter((f) => f !== inp && f !== twodFile && !rain.includes(f))
  if (inp) {
    const text = await inp.text()
    project = { inpName: inp.name, inpText: text, model: parseInp(text), crs: null, proj4: null, results: [] }
    added.push(inp.name)
  }
  if (!project) {
    if (rest.length || rain.length) throw new ViewerFileError('Add the model’s .inp file first (you can drop it together with its .rpt and .out).')
    return { added, ignored }
  }
  if (twodFile) {
    const buf = await twodFile.arrayBuffer()
    try {
      const { pkg } = await readTwoDPackage(buf)
      project.twod = { name: twodFile.name, buf, pkg }
      added.push(twodFile.name)
    } catch (e) {
      if (e instanceof TwoDPackageError) throw new ViewerFileError(`${twodFile.name}: ${e.message}`)
      throw e
    }
  }
  for (const f of rain) {
    const text = await f.text()
    // An LID report (a unit's own time series) belongs to the current run.
    if (/^\s*SWMM5? LID Report File/i.test(text)) {
      const cur = project.results[0]
      if (cur) {
        cur.lidReports = [...(cur.lidReports ?? []).filter((r) => r.name !== f.name), { name: f.name, text }]
        added.push(f.name)
      }
      continue
    }
    const kept = (project.rainFiles ?? []).filter((r) => r.name.toLowerCase() !== f.name.toLowerCase())
    project.rainFiles = [...kept, { name: f.name, text }]
    added.push(f.name)
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
export async function addRunResult(rptText: string, outBuf: ArrayBuffer | null, label: string, lidReports?: { name: string; text: string }[]) {
  if (!project) return
  const base = project.inpName.replace(/\.[^.]+$/, '')
  const set: ResultSet = { id: newId(), label, added: now(), rptName: `${base}.rpt`, rptText, lidReports }
  if (outBuf) {
    set.outBuf = outBuf
    set.outName = `${base}.out`
    set.out = new SwmmOut(outBuf)
  }
  project.results.unshift(set)
  await save()
  notify()
}

/** Attach LID report files to a result set (e.g. a bundled example's). */
export async function setLidReports(id: string, reports: { name: string; text: string }[]) {
  const r = project?.results.find((x) => x.id === id)
  if (!r) return
  r.lidReports = reports
  await save()
  notify()
}

/** Make a result set the current one (the one the map, graphs and report show). */
export async function makeCurrent(id: string) {
  if (!project) return
  const i = project.results.findIndex((r) => r.id === id)
  if (i <= 0) return
  const [r] = project.results.splice(i, 1)
  project.results.unshift(r)
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

// ------------------------------------------------------------ GIS layers

const nextZ = () => Math.max(-1, ...(project?.gisLayers ?? []).map((l) => l.z_order)) + 1
const gisId = (prefix: string, name: string) =>
  `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'layer'}-${Math.random().toString(36).slice(2, 7)}`

export async function addGisVectorLayer(name: string, fc: FeatureCollection, opts: { visible?: boolean; style?: GisLayerStyle; warning?: string } = {}) {
  if (!project) throw new ViewerFileError('Open a model first')
  const features = fc.features.filter((f) => f.geometry)
  if (!features.length) throw new ViewerFileError(`${name}: no features with a location`)
  const data: FeatureCollection = { type: 'FeatureCollection', features }
  const layer: GisLayer = {
    id: gisId('vec', name),
    name,
    type: 'vector',
    crs: 'EPSG:4326',
    source_crs: 'EPSG:4326',
    visible: opts.visible ?? true,
    opacity: 0.8,
    z_order: nextZ(),
    bounds: lonLatBounds(data),
    feature_count: features.length,
    geometry_types: geometryTypes(data),
    fields: fieldNames(data),
    style: opts.style ?? null,
    warning: opts.warning ?? null,
    data,
  }
  project.gisLayers = [...(project.gisLayers ?? []), layer]
  await save()
  notify()
  return layer
}

export async function addGisWebLayer(name: string, web: GisWebSource) {
  if (!project) throw new ViewerFileError('Open a model first')
  if (!/^https?:\/\//i.test(web.url.trim())) throw new ViewerFileError('The address must start with http:// or https://')
  const layer: GisLayer = {
    id: gisId('web', name),
    name: name.trim() || 'Web layer',
    type: 'tiles',
    crs: 'EPSG:3857',
    visible: true,
    opacity: 0.8,
    z_order: nextZ(),
    web: { ...web, url: web.url.trim() },
  }
  project.gisLayers = [...(project.gisLayers ?? []), layer]
  await save()
  notify()
  return layer
}

export async function patchGisLayer(id: string, patch: { visible?: boolean; opacity?: number; z_order?: number; name?: string; style?: GisLayerStyle }) {
  const l = project?.gisLayers?.find((x) => x.id === id)
  if (!l) return null
  if (patch.visible !== undefined) l.visible = patch.visible
  if (patch.opacity !== undefined) l.opacity = Math.max(0, Math.min(1, patch.opacity))
  if (patch.z_order !== undefined) l.z_order = patch.z_order
  if (patch.name !== undefined) l.name = patch.name.trim() || l.name
  if (patch.style) {
    const st = { ...(l.style ?? {}) }
    for (const [k, v] of Object.entries(patch.style)) if (v !== undefined && v !== null) (st as Record<string, unknown>)[k] = v
    if (st.label_field === '') delete st.label_field
    l.style = st
  }
  project!.gisLayers = [...project!.gisLayers!]
  await save()
  notify()
  return l
}

export async function removeGisLayer(id: string) {
  if (!project) return
  project.gisLayers = (project.gisLayers ?? []).filter((l) => l.id !== id)
  await save()
  notify()
}

/** Take the model text (and rain files) back after an edit made by the
 *  in-browser backend; re-parses, saves and tells the app. */
export async function setModelFiles(inpText: string, rainFiles?: { name: string; text: string }[]) {
  if (!project) return
  const same = inpText === project.inpText && (!rainFiles || JSON.stringify(rainFiles) === JSON.stringify(project.rainFiles ?? []))
  if (same) return
  project.inpText = inpText
  project.model = parseInp(inpText)
  if (rainFiles) project.rainFiles = rainFiles
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
  const twod = rest.twod ? { name: rest.twod.name, buf: rest.twod.buf } : null
  await idb('put', { ...rest, twod, results: rest.results.map(({ out: _o, ...r }) => (void _o, r)) })
}

/** Restore the last session's files (call once at startup). */
export async function restore(): Promise<boolean> {
  const v = (await idb('get')) as Omit<ViewerProject, 'model'> | null
  if (!v?.inpText) return false
  project = { ...v, model: parseInp(v.inpText) }
  if (v.twod?.buf) {
    try {
      project.twod = { ...v.twod, pkg: (await readTwoDPackage(v.twod.buf)).pkg }
    } catch {
      project.twod = null
    }
  }
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
