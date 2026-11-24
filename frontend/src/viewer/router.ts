/**
 * Answers the app's /api requests inside the browser, from the files in the
 * viewer store. Edits, undo/redo, model tools and restore points go to the
 * desktop app's Python code running in the browser (py/backend.ts); what
 * needs the desktop itself returns 501 with a pointer to the download.
 */

import { browserRunState, runInBrowser } from './engine/run'
import { fingerprint } from '../lib/fingerprint'
import { buildProfile, getObject, networkPayload, NotFound, simulationWindow } from './inp'
import { OutError } from './out'
import { parseReport, summarize } from './rpt'
import { addGisVectorLayer, addGisWebLayer, getProject, makeCurrent, outOf, patchGisLayer, removeGisLayer, removeResult, setCrs, updateResult, type ResultSet } from './store'
import type { FeatureCollection } from 'geojson'
import type { GisWebSource } from '../api/client'
import T from './tables.json'
import { BACKEND_PREFIXES, backendStarted, callBackend } from './py/backend'
import { noaaPfdsCsv, openMeteoArchive, openMeteoForecast, WebDataError } from './web'
import { checkModel, getOptions, getSection, listSections } from './tools'

declare const __APP_VERSION__: string
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const DOWNLOAD_URL = 'https://saturday-swmm.com/#start'
export const DESKTOP_ONLY = 'This needs the desktop app, which runs SWMM on your computer.'

export type Reply = { status: number; json: unknown; binary?: { body: ArrayBuffer; headers: Record<string, string> }; text?: string }
const ok = (json: unknown): Reply => ({ status: 200, json })
const err = (status: number, detail: string): Reply => ({ status, json: { detail } })

const DEFAULT_CRS = 'EPSG:25832'

// ------------------------------------------------------------------ CRS
type CrsRow = [number, string, string, string]
let catalog: Promise<CrsRow[]> | null = null
export function crsCatalog(): Promise<CrsRow[]> {
  catalog ??= fetch(`${import.meta.env.BASE_URL}crs-epsg.json`).then((r) => {
    if (!r.ok) throw new Error('Couldn’t load the coordinate system list')
    return r.json() as Promise<CrsRow[]>
  })
  return catalog
}
export async function lookupCrs(code: string): Promise<CrsRow | null> {
  const n = Number(code.replace(/^EPSG:/i, ''))
  if (!Number.isInteger(n)) return null
  return (await crsCatalog()).find((r) => r[0] === n) ?? null
}
const PRESETS = [
  ['EPSG:4326', 'WGS 84 (longitude/latitude)'],
  ['EPSG:3857', 'Web Mercator'],
  ['EPSG:25832', 'ETRS89 / UTM zone 32N'],
  ['EPSG:25833', 'ETRS89 / UTM zone 33N'],
  ['EPSG:27700', 'OSGB 1936 / British National Grid'],
  ['EPSG:2272', 'NAD83 / Pennsylvania South (ftUS)'],
  ['EPSG:2263', 'NAD83 / New York Long Island (ftUS)'],
  ['EPSG:2229', 'NAD83 / California zone 5 (ftUS)'],
]
async function searchCrs(q: string, limit: number) {
  const rows = await crsCatalog()
  const s = q.trim().toLowerCase().replace(/^epsg:/, '')
  if (!s) return []
  const words = s.split(/\s+/)
  const score = (r: CrsRow) => {
    if (String(r[0]) === s) return 0
    if (String(r[0]).startsWith(s)) return 1
    const hay = `${r[1]} ${r[2]}`.toLowerCase()
    return words.every((w) => hay.includes(w)) ? (r[1].toLowerCase().includes(words[0]) ? 2 : 3) : -1
  }
  return rows
    .map((r) => [score(r), r] as const)
    .filter(([sc]) => sc >= 0)
    .sort((a, b) => a[0] - b[0] || a[1][0] - b[1][0])
    .slice(0, limit)
    .map(([, r]) => ({ auth_code: `EPSG:${r[0]}`, name: r[1], area_of_use: r[2] || null, proj4: r[3], source: 'local' }))
}

// ------------------------------------------------------------- results
const current = (): ResultSet | undefined => getProject()?.results[0]
function resultSet(id: string): ResultSet {
  const p = getProject()
  const r = id === 'current' ? p?.results[0] : p?.results.find((x) => x.id === id)
  if (!r) throw new NotFound(`Run not found: ${id}`)
  return r
}
function requireOut(r: ResultSet | undefined) {
  const o = outOf(r)
  if (!o) throw new NotFound('No results file (.out) loaded. Drop one in to see results on the map and in charts.')
  return o
}

function projectInfo() {
  const p = getProject()
  if (!p) return null
  const o = p.model.options()
  const r = current()
  return {
    path: 'This browser', inp_name: p.inpName, inp_path: p.activeInp ?? p.inpName,
    scenario_id: p.scenario?.id ?? 'base', scenario_name: p.scenario?.name ?? 'Base',
    storm_id: p.storm?.id ?? 'model', storm_name: p.storm?.name ?? 'Model rainfall',
    flow_units: o.FLOW_UNITS ?? null, infiltration: o.INFILTRATION ?? null,
    files: [p.inpName, ...(r?.rptName ? [r.rptName] : []), ...(r?.outName ? [r.outName] : []), ...(p.rainFiles ?? []).map((f) => f.name)],
    out_path: r?.outName ?? null, rpt_path: r?.rptName ?? null, has_out: Boolean(r?.outBuf), has_rpt: Boolean(r?.rptText),
    has_2d_mesh: Boolean(p.twod?.pkg), has_2d_results: Boolean(p.twod?.pkg), twod_path: p.twod?.name ?? null,
    crs: p.crs ?? DEFAULT_CRS, crs_proj4: p.proj4, crs_confirmed: Boolean(p.crs),
    // The browser runs EPA SWMM 5.2; results loaded from elsewhere name their own engine.
    simulation_engine: r?.rptText ? engineOf(r.rptText.slice(0, 400)) : 'pyswmm', has_flow_accum_results: false,
  }
}

/** A run's headline numbers, as the desktop's run archive keeps them. */
function summaryOf(r: ResultSet): Record<string, unknown> {
  const s = r.rptText ? parseReport(r.rptText) : null
  return s ? Object.fromEntries([...T.summary_keys, 'flood_volume_units'].map((k) => [k, (s as Record<string, unknown>)[k] ?? null])) : {}
}

// ------------------------------------------------- scenarios × storms (Runs page)
const scenOf = (r: ResultSet) => r.scenarioId ?? 'base'
const stormOf = (r: ResultSet) => r.stormId ?? 'model'
type ScenRow = { id: string; name: string; parent: string | null; inp: string; description?: string }
type StormRow = { id: string; name: string; [k: string]: unknown }

/** The project's scenarios and storms: from the editor once a project has any, else Base and the model's own rain. */
async function scenariosAndStorms(): Promise<{ scenarios: ScenRow[]; activeScenario: string; storms: StormRow[]; activeStorm: string }> {
  const p = getProject()!
  const files = Object.keys(p.projectFiles ?? {})
  let scenarios: ScenRow[] = [{ id: 'base', name: 'Base', parent: null, inp: p.inpName }]
  let activeScenario = 'base'
  let storms: StormRow[] = [{ id: 'model', name: 'Model rainfall', kind: 'model' }]
  let activeStorm = 'model'
  if (backendStarted() || files.includes('scenarios.json')) {
    const r = await callBackend('GET', '/api/scenarios', '', null)
    if (r.status < 400) {
      const j = r.json as { active: string; scenarios: ScenRow[] }
      scenarios = j.scenarios
      activeScenario = j.active
    }
  }
  if (backendStarted() || files.some((k) => k.startsWith('storms/'))) {
    const r = await callBackend('GET', '/api/storms', '', null)
    if (r.status < 400) {
      const j = r.json as { active: string; storms: StormRow[] }
      storms = j.storms
      activeStorm = j.active
    }
  }
  return { scenarios, activeScenario, storms, activeStorm }
}

/** The model text of a scenario now, to tell whether its results are out of date. */
function scenarioText(sc: ScenRow, activeScenario: string): string | null {
  const p = getProject()!
  if (sc.id === activeScenario) return p.inpText
  const f = p.projectFiles?.[sc.inp]
  return f ? new TextDecoder().decode(f) : null
}

async function runMatrix() {
  const p = getProject()!
  const { scenarios, activeScenario, storms, activeStorm } = await scenariosAndStorms()
  const cells = []
  for (const sc of scenarios) {
    const text = scenarioText(sc, activeScenario)
    const print = text ? fingerprint(text) : null
    for (const st of storms) {
      const r = p.results.find((x) => scenOf(x) === sc.id && stormOf(x) === st.id && x.outBuf)
      cells.push({
        id: r?.id ?? `${sc.id}|${st.id}`, scenario: sc.id, storm: st.id, has_results: Boolean(r),
        stale: Boolean(r && print && r.inpPrint && r.inpPrint !== print), finished: r?.added ?? null, summary: r ? summaryOf(r) : null,
      })
    }
  }
  return { active: { scenario: activeScenario, storm: activeStorm }, scenarios, storms, cells }
}

/** After switching scenario or storm, show that pair's newest results, if there are any. */
async function showResultsFor(scenario: string, storm: string) {
  const p = getProject()
  const r = p?.results.find((x) => scenOf(x) === scenario && stormOf(x) === storm && x.outBuf)
  if (r && p && p.results[0] !== r) await makeCurrent(r.id)
}

type BatchItem = { scenario: string; storm: string; state: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'; progress: number; note: string | null }
const batch: { running: boolean; items: BatchItem[]; cancelled: boolean } = { running: false, items: [], cancelled: false }
const batchStatus = () => ({ running: batch.running, items: batch.items.map((i) => ({ ...i, progress: i.state === 'running' && browserRunState().status === 'running' ? (browserRunState() as { percent: number }).percent : i.progress })) })

/** Run scenario × storm cells one after another in this page, then go back to the one that was open. */
async function startBatch(cells: { scenario: string; storm: string }[]) {
  if (batch.running || browserRunState().status === 'running') throw Object.assign(new Error('A run is already in progress'), { status: 409 })
  const start = await scenariosAndStorms()
  batch.items = cells.map((c) => ({ ...c, state: 'waiting', progress: 0, note: null }))
  batch.running = true
  batch.cancelled = false
  void (async () => {
    try {
      for (const it of batch.items) {
        if (batch.cancelled) {
          it.state = 'cancelled'
          continue
        }
        it.state = 'running'
        const a = await callBackend('PUT', '/api/scenarios/active', '', { id: it.scenario })
        const b = a.status < 400 ? await callBackend('PUT', '/api/storms/active', '', { id: it.storm }) : a
        if (b.status >= 400) {
          it.state = 'failed'
          it.note = (b.json as { detail?: string })?.detail ?? 'Couldn’t switch to this scenario and storm'
          continue
        }
        try {
          await runInBrowser()
          const st = browserRunState()
          it.state = st.status === 'completed' ? 'done' : 'failed'
          it.progress = 100
          if (st.status === 'failed') it.note = st.error
        } catch (e) {
          it.state = 'failed'
          it.note = (e as Error).message
        }
      }
    } finally {
      await callBackend('PUT', '/api/scenarios/active', '', { id: start.activeScenario })
      await callBackend('PUT', '/api/storms/active', '', { id: start.activeStorm })
      await showResultsFor(start.activeScenario, start.activeStorm)
      batch.running = false
    }
  })()
  return batchStatus()
}

function archived() {
  const p = getProject()
  return (p?.results ?? []).map((r) => {
    const s = r.rptText ? parseReport(r.rptText) : null
    return {
      id: r.id, label: r.label, pinned: true, engine: engineOf(s?.engine), scenario_id: r.scenarioId ?? 'base',
      scenario_name: r.scenarioName ?? r.rptName ?? r.outName ?? 'Results', inp_name: p!.inpName, started: r.added, finished: r.added,
      size_bytes: (r.outBuf?.byteLength ?? 0) + (r.rptText?.length ?? 0),
      summary: s
        ? Object.fromEntries([...T.summary_keys, 'flood_volume_units'].map((k) => [k, (s as Record<string, unknown>)[k] ?? null]))
        : {},
    }
  })
}
const engineOf = (line?: string | null) => (line && /OPENSWMM/i.test(line) ? 'openswmm' : 'pyswmm')

function compare(a: string, b: string, limit = 300) {
  const rep = (id: string) => {
    const r = resultSet(id)
    if (!r.rptText) throw new NotFound(`No report for run ${id}`)
    return parseReport(r.rptText)
  }
  const ra = rep(a)
  const rb = rep(b)
  const summary = T.summary_keys.map((k) => {
    const va = (ra as Record<string, unknown>)[k] as number | null
    const vb = (rb as Record<string, unknown>)[k] as number | null
    return { key: k, a: va, b: vb, delta: typeof va === 'number' && typeof vb === 'number' ? vb - va : null }
  })
  const byA = new Map(ra.tables.map((t) => [t.title, t]))
  const byB = new Map(rb.tables.map((t) => [t.title, t]))
  const tables = []
  for (const [title, [kind, cols]] of Object.entries(T.compare_tables as unknown as Record<string, [string, [string, string][]]>)) {
    const ta = byA.get(title)
    const tb = byB.get(title)
    if (!ta && !tb) continue
    const ref = (ta ?? tb)!
    const idx = new Map(ref.columns.map((c, i) => [c, i]))
    const rowsA = new Map((ta?.rows ?? []).map((r) => [String(r[0]), r]))
    const rowsB = new Map((tb?.rows ?? []).map((r) => [String(r[0]), r]))
    const flood = title === 'Node Flooding Summary'
    const rows = [...new Set([...rowsA.keys(), ...rowsB.keys()])].sort().map((oid) => {
      let score = 0
      const values = cols.map(([c]) => {
        const i = idx.get(c)
        const va = i === undefined ? null : rowsA.get(oid)?.[i]
        const vb = i === undefined ? null : rowsB.get(oid)?.[i]
        const fa = typeof va === 'number' ? va : !rowsA.has(oid) && flood ? 0 : null
        const fb = typeof vb === 'number' ? vb : !rowsB.has(oid) && flood ? 0 : null
        const d = fa !== null && fb !== null ? fb - fa : null
        if (d !== null) score = Math.max(score, Math.abs(d))
        return { a: fa, b: fb, delta: d }
      })
      return { id: oid, values, score }
    })
    rows.sort((x, y) => y.score - x.score)
    tables.push({
      title, object: kind, columns: cols.map(([, l]) => l),
      units: cols.map(([c]) => (idx.has(c) ? ref.units[idx.get(c)!] ?? '' : '')),
      rows: rows.slice(0, limit).map(({ id, values }) => ({ id, values })), total: rows.length,
    })
  }
  return { a, b, summary, flood_volume_units: rb.flood_volume_units || ra.flood_volume_units, tables }
}

// --------------------------------------------------------------- router
/** Requests the desktop app's Python code answers here, in the browser
 *  (py/backend.ts): editing, undo/redo, model tools, restore points. */
function servedByBackend(path: string) {
  if (path.startsWith('/api/projects')) return path.startsWith('/api/projects/files')
  return BACKEND_PREFIXES.some((pre) => path === pre || path.startsWith(pre + '/'))
}

export async function handle(method: string, url: URL, body: unknown): Promise<Reply> {
  const path = decodeURIComponent(url.pathname.replace(/\/+$/, ''))
  const q = url.searchParams
  const p = getProject()
  const seg = path.split('/').slice(2) // after /api
  try {
    if (method === 'GET') {
      switch (path) {
        case '/api/health':
          return ok({
            status: 'ok', app_version: VERSION, distribution: 'viewer', python_version: '',
            openswmm: { installed: false, version: null, import_ok: false, error: null },
            gis: { rasterio: false, pyogrio: false, shapely: false, pyproj: false, pillow: false, geopandas: false },
          })
        case '/api/app':
          return ok({ name: 'Saturday-SWMM', version: VERSION, distribution: 'viewer', releases_url: 'https://github.com/scott-jeffers/saturday-swmm/releases', can_quit: false, engines: [] })
        case '/api/app/examples':
          return ok([])
        case '/api/crs/presets':
          return ok({ presets: PRESETS.map(([auth_code, label]) => ({ auth_code, label, name: label })) })
        case '/api/crs/search':
          return ok({ query: q.get('q') ?? '', online: false, hits: await searchCrs(q.get('q') ?? '', Number(q.get('limit') ?? 20)), warning: null })
        // Rainfall from the web, fetched by the browser (viewer/web.ts).
        case '/api/noaa/pfds':
          return { status: 200, json: null, text: await noaaPfdsCsv(Number(q.get('lat')), Number(q.get('lon')), q.get('series') === 'ams' ? 'ams' : 'pds') }
        case '/api/openmeteo/archive':
          return ok(await openMeteoArchive(q))
        case '/api/openmeteo/forecast':
          return ok(await openMeteoForecast(q))
      }
      if (!p) return err(404, 'No project is open')
      const model = p.model
      switch (path) {
        case '/api/projects/current':
          return ok(projectInfo())
        case '/api/projects/files':
          return ok({ files: projectInfo()!.files.map((name) => ({ name, size: 0 })) })
        case '/api/model/network':
          return ok(networkPayload(model, q.get('crs') || p.crs || DEFAULT_CRS))
        case '/api/model/sections':
          return ok(listSections(p.inpText))
        case '/api/model/options':
          return ok(getOptions(p.inpText))
        case '/api/model/check':
          return ok(checkModel(model))
        case '/api/model/simulation-window':
          return ok(simulationWindow(model))
        case '/api/model/profile': {
          const period = q.get('period')
          const o = outOf(current())
          const via = (q.get('via') ?? '').split(',').filter((v) => v.trim())
          return ok(buildProfile(model, q.get('start') ?? '', q.get('end') ?? '', o ? o.profileResults(period !== null ? Number(period) : null) : undefined, via))
        }
        case '/api/inp':
          return ok({ text: p.inpText })
        case '/api/rpt': {
          // After a failed run, its report (with SWMM's errors) is the one to read.
          const br = browserRunState()
          if (br.status === 'failed' && br.rptText) return ok({ text: br.rptText, path: `${p.inpName.replace(/\.[^.]+$/, '')} (failed run).rpt` })
          const r = current()
          if (!r?.rptText) return err(404, 'No report (.rpt) loaded. Drop one in alongside the model.')
          return ok({ text: r.rptText, path: r.rptName })
        }
        case '/api/rpt/summary':
          return ok(summarize(current()?.rptText ?? null))
        case '/api/runs/current': {
          const br = browserRunState()
          if (br.status === 'running')
            return ok({ status: 'running', engine: 'pyswmm', progress: br.percent, message: 'EPA SWMM 5.2 running in this browser' })
          if (br.status === 'failed' && !current()?.outBuf)
            return ok({ status: 'failed', engine: 'pyswmm', progress: 0, message: 'Run failed', error: br.error })
          return ok(
            current()?.outBuf
              ? { status: 'completed', engine: engineOf(current()?.rptText?.slice(0, 400)), progress: 100, message: 'Results loaded', out_path: current()?.outName }
              : { status: 'idle', engine: null, progress: 0, message: '' },
          )
        }
        case '/api/runs/archive':
          return ok({ runs: archived(), keep_unpinned: 0 })
        case '/api/runs/targets': {
          const name = (r: ResultSet) => r.label || (r.rptName ?? r.outName ?? 'Results').replace(/\.[^.]+$/, '')
          const [cur, ...rest] = p.results
          return ok({
            current: { id: cur?.id ?? 'current', label: cur ? name(cur) : 'Results', scenario_id: cur?.scenarioId ?? 'base' },
            targets: rest.map((r) => ({ id: r.id, kind: 'run', label: name(r), scenario_id: r.scenarioId ?? null, finished: r.added, has_results: Boolean(r.outBuf) })),
          })
        }
        case '/api/runs/compare':
          return ok(compare(q.get('a') ?? '', q.get('b') ?? ''))
        case '/api/scenarios':
          // A model with no scenarios yet doesn't need the editor started to say so.
          if (!backendStarted() && !p.projectFiles?.['scenarios.json'])
            return ok({ active: 'base', scenarios: [{ id: 'base', name: 'Base', parent: null, inp: p.inpName, created: '', description: '', locked: false, changes: 0, flags: 0, behind: 0, results_stale: false }] })
          return await callBackend(method, path, url.search.replace(/^\?/, ''), body)
        // Lists the editor answers once it has started; before that, what an untouched project holds.
        case '/api/storms':
          if (!backendStarted() && !Object.keys(p.projectFiles ?? {}).some((k) => k.startsWith('storms/')))
            return ok({ active: 'model', storms: [{ id: 'model', name: 'Model rainfall', kind: 'model', file: null, format: null, interval: null, units: null, start: null, end: null, after_hours: null, total: null, return_period: null, duration_hr: null, note: 'The rain gages as the model sets them' }] })
          return await callBackend(method, path, url.search.replace(/^\?/, ''), body)
        case '/api/snapshots':
          if (!backendStarted() && !Object.keys(p.projectFiles ?? {}).some((k) => k.startsWith('snapshots/'))) return ok({ snapshots: [] })
          return await callBackend(method, path, url.search.replace(/^\?/, ''), body)
        case '/api/snapshots/git':
          // Git runs on the desktop; the panel is shown greyed out (as a project not yet tracked).
          return ok({ available: true, repo: false, branch: null, commits: [] })
        case '/api/2d/info':
          if (p.twod?.pkg) return ok(p.twod.pkg.info(p.twod.name))
          return ok({ has_mesh: false, vertex_count: 0, triangle_count: 0, output_file: null, report_2d: false, dry_depth: null, twod_path: null, has_results: false, mesh_file: null, boundary_edge_count: 0 })
        case '/api/gis/layers':
          return ok({ layers: p.gisLayers ?? [], project_crs: p.crs ?? DEFAULT_CRS })
        case '/api/gis/flow/info':
          return ok({ has_results: false })
        case '/api/out/metadata':
          return ok(requireOut(current()).metadata(current()!.outName ?? ''))
        case '/api/out/nodes':
          return ok({ ids: requireOut(current()).nodeIds })
        case '/api/out/links':
          return ok({ ids: requireOut(current()).linkIds })
        case '/api/out/subcatchments':
          return ok({ ids: requireOut(current()).subIds })
        case '/api/out/variables':
          return ok(requireOut(current()).variables((q.get('kind') ?? 'node') as 'node'))
        case '/api/out/periods':
          return ok(requireOut(current()).periodsResponse())
        case '/api/out/system/variables':
          return ok(requireOut(current()).systemVariables())
        case '/api/out/system/series':
          return ok(requireOut(current()).systemResponse(q.get('variable')))
        case '/api/out/snapshot':
          return ok(requireOut(current()).snapshot(Number(q.get('period') ?? 0)))
        case '/api/out/envelope':
          return ok(requireOut(current()).envelope())
      }
      // 2D mesh and results (from a .ss2d package)
      if (seg[0] === '2d') {
        const t = p.twod?.pkg
        if (!t) return err(404, 'No 2D mesh or results in this browser.')
        if (path === '/api/2d/mesh') return ok(t.mesh())
        if (path === '/api/2d/boundaries') return ok({ crs: t.header.crs, geojson: { type: 'FeatureCollection', features: [] }, count: 0, bc_types: [] })
        if (path === '/api/2d/periods') return ok(t.periods())
        if (path === '/api/2d/metadata') return ok(t.metadata(p.twod!.name))
        if (path === '/api/2d/snapshot' || path === '/api/2d/envelope') {
          const per = Number(q.get('period') ?? 0)
          const v = path === '/api/2d/envelope' ? t.envelope : t.period(per)
          let mn = Infinity, mx = -Infinity
          for (const x of v) {
            if (x < mn) mn = x
            if (x > mx) mx = x
          }
          return ok({ period: per, time: t.header.times[per] ?? null, triangle_count: v.length, values: Array.from(v), value_min: mn, value_max: mx, variable: 'depth', unit: t.header.unit })
        }
        if (path === '/api/2d/snapshot/binary' || path === '/api/2d/envelope/binary') {
          const env = path === '/api/2d/envelope/binary'
          const per = Number(q.get('period') ?? 0)
          const variable = (q.get('variable') ?? 'depth').toLowerCase()
          if ((variable === 'vx' || variable === 'vy') && !t.hasVelocity) return err(404, 'No 2D velocities in this package')
          const v = env ? new Float32Array(t.envelope) : variable === 'vx' || variable === 'vy' ? t.velocity(per, variable) : t.period(per)
          let mn = Infinity, mx = -Infinity
          for (const x of v) {
            if (x < mn) mn = x
            if (x > mx) mx = x
          }
          return {
            status: 200,
            json: null,
            binary: {
              body: v.buffer as ArrayBuffer,
              headers: {
                'X-Triangle-Count': String(v.length),
                'X-Period': String(env ? -1 : per),
                'X-Value-Min': String(mn),
                'X-Value-Max': String(mx),
                'X-Variable': variable,
                'X-Unit': variable === 'depth' ? t.header.unit : 'm/s',
                'X-Time': env ? '' : (t.header.times[per] ?? ''),
              },
            },
          }
        }
        if (seg[1] === 'faces' && seg.length >= 3) {
          const i = Number(seg[2])
          if (!Number.isInteger(i) || i < 0 || i >= t.header.triangle_count) return err(404, 'No such 2D cell')
          if (seg[3] === 'series') return ok(t.faceSeriesResponse(i))
          return ok(t.faceInfo(i))
        }
      }
      // /api/model/objects/{type}/{id}
      if (seg[0] === 'model' && seg[1] === 'objects' && seg.length === 4) return ok(getObject(model, seg[2], seg[3]))
      if (seg[0] === 'model' && seg[1] === 'sections' && seg.length === 3) return ok(getSection(p.inpText, seg[2]))
      // /api/out/{nodes|links|subcatchments}/{id}/series
      if (seg[0] === 'out' && seg.length === 4 && seg[3] === 'series') {
        const kind = ({ nodes: 'node', links: 'link', subcatchments: 'subcatchment' } as const)[seg[1] as 'nodes']
        if (kind) return ok(requireOut(current()).seriesResponse(kind, seg[2], q.get('variable')))
      }
      // /api/runs/archive/{id}/envelope|snapshot|periods: another result set, for comparing
      if (seg[0] === 'runs' && seg[1] === 'archive' && seg.length === 4) {
        const o = requireOut(resultSet(seg[2]))
        if (seg[3] === 'envelope') return ok(o.envelope())
        if (seg[3] === 'snapshot') return ok(o.snapshot(Number(q.get('period') ?? 0)))
        if (seg[3] === 'periods') return ok(o.periodsResponse())
        if (seg[3] === 'system') return ok(o.systemResponse(q.get('variable')))
      }
      // /api/runs/archive/{id}/lid-reports: the run's LID unit reports
      if (seg[0] === 'runs' && seg[1] === 'archive' && seg.length === 4 && seg[3] === 'lid-reports') {
        const r = resultSet(seg[2])
        return ok({ reports: (r.lidReports ?? []).map((x) => ({ file: x.name, text: x.text, subcatchment: null, lid: null, note: null })) })
      }
      // /api/runs/archive/{id}/series/{kind}/{oid}
      if (seg[0] === 'runs' && seg[1] === 'archive' && seg[3] === 'series' && seg.length === 6)
        return ok(requireOut(resultSet(seg[2])).seriesResponse(seg[4] as 'node', seg[5], q.get('variable')))
    }
    if (method === 'POST' && path === '/api/projects/open') {
      if (!p) return err(404, 'Your files from last time are no longer in this browser. Open them again.')
      return ok(projectInfo())
    }
    if (method === 'PUT' && path === '/api/projects/crs') {
      const code = String((body as { crs?: string })?.crs ?? '').trim()
      const row = await lookupCrs(code)
      if (!row) return err(400, `Unknown coordinate system: ${code}`)
      await setCrs(`EPSG:${row[0]}`, row[3])
      return ok(projectInfo())
    }
    if (seg[0] === 'gis' && seg[1] === 'layers') {
      if (method === 'POST' && seg[2] === 'web') {
        const b = body as { name: string; web: GisWebSource }
        return ok(await addGisWebLayer(b.name, b.web))
      }
      if (method === 'POST' && seg[2] === 'geojson') {
        const b = body as { name: string; geojson: FeatureCollection }
        return ok(await addGisVectorLayer(b.name, b.geojson))
      }
      if (method === 'PATCH' && seg.length === 3) {
        const l = await patchGisLayer(seg[2]!, body as Parameters<typeof patchGisLayer>[1])
        return l ? ok(l) : err(404, 'Layer not found')
      }
      if (method === 'DELETE' && seg.length === 3) {
        await removeGisLayer(seg[2]!)
        return ok({ layers: getProject()?.gisLayers ?? [], project_crs: getProject()?.crs ?? DEFAULT_CRS })
      }
    }
    if (method === 'PATCH' && seg[0] === 'runs' && seg[1] === 'archive' && seg.length === 3) {
      await updateResult(seg[2], body as { label?: string })
      return ok({ runs: archived(), keep_unpinned: 0 })
    }
    if (method === 'DELETE' && seg[0] === 'runs' && seg[1] === 'archive' && seg.length === 3) {
      await removeResult(seg[2])
      return ok({ runs: archived(), keep_unpinned: 0 })
    }
    // Start a run (the desktop's Run): here EPA SWMM 5.2 runs in the page; /api/runs/current follows it.
    if (p && method === 'POST' && path === '/api/runs') {
      if (browserRunState().status !== 'running') void runInBrowser()
      return ok({ status: 'running', engine: 'pyswmm', progress: 0, message: 'EPA SWMM 5.2 running in this browser' })
    }
    // Runs page: every scenario under every storm, run here one after another.
    if (p && path === '/api/runs/matrix' && method === 'GET') return ok(await runMatrix())
    if (p && path === '/api/runs/batch') {
      if (method === 'GET') return ok(batchStatus())
      if (method === 'POST') return ok(await startBatch(((body as { cells?: { scenario: string; storm: string }[] })?.cells ?? [])))
      if (method === 'DELETE') {
        batch.cancelled = true
        return ok(batchStatus())
      }
    }
    // Switching scenario or storm shows that pair's newest results (as each has its own on the desktop).
    if (p && method === 'PUT' && (path === '/api/scenarios/active' || path === '/api/storms/active')) {
      const r = await callBackend(method, path, url.search.replace(/^\?/, ''), body)
      if (r.status < 400) {
        const q2 = getProject()
        await showResultsFor(q2?.scenario?.id ?? 'base', q2?.storm?.id ?? 'model')
      }
      return r
    }
    // Pages that open the project first (the desktop needs it): here it is always open.
    if (method === 'POST' && path === '/api/projects/open' && p) return ok(projectInfo())
    // Nothing has been edited until the editor has started: don't start it just to say so.
    if (method === 'GET' && path === '/api/edits' && !backendStarted()) return ok({ undo: [], redo: [] })
    if (p && servedByBackend(path)) return await callBackend(method, path, url.search.replace(/^\?/, ''), body)
    return err(501, DESKTOP_ONLY)
  } catch (e) {
    if (e instanceof NotFound) return err(404, e.message)
    if (e instanceof WebDataError) return err(e.status, e.message)
    if (e instanceof OutError) return err(e.status, e.message)
    const st = (e as { status?: number }).status
    return err(typeof st === 'number' ? st : 500, (e as Error).message || 'Something went wrong in the viewer')
  }
}

/** Route same-origin /api requests to {@link handle} instead of the network. */
export function installViewerFetch() {
  const original = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.href)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return original(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let body: unknown = null
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = null
      }
    }
    const r = await handle(method, url, body)
    if (r.binary) return new Response(r.binary.body, { status: r.status, headers: { 'Content-Type': 'application/octet-stream', ...r.binary.headers } })
    if (r.text !== undefined) return new Response(r.text, { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }
}
