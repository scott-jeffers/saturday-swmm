/**
 * Answers the app's /api requests inside the browser, from the files in the
 * viewer store. Read-only: anything that edits the model, runs an engine or
 * needs the desktop's Python returns 501 with a pointer to the download.
 */

import { browserRunState } from './engine/run'
import { buildProfile, getObject, networkPayload, NotFound, simulationWindow } from './inp'
import { OutError } from './out'
import { parseReport, summarize } from './rpt'
import { getProject, outOf, removeResult, setCrs, updateResult, type ResultSet } from './store'
import T from './tables.json'
import { checkModel, getOptions, getSection, listSections } from './tools'

declare const __APP_VERSION__: string
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const DOWNLOAD_URL = 'https://saturday-swmm.com/#start'
export const DESKTOP_ONLY = 'This needs the desktop app, which runs SWMM on your computer.'

export type Reply = { status: number; json: unknown }
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
    path: 'This browser', inp_name: p.inpName, inp_path: p.inpName, scenario_id: 'base', scenario_name: 'Base',
    flow_units: o.FLOW_UNITS ?? null, infiltration: o.INFILTRATION ?? null,
    files: [p.inpName, ...(r?.rptName ? [r.rptName] : []), ...(r?.outName ? [r.outName] : [])],
    out_path: r?.outName ?? null, rpt_path: r?.rptName ?? null, has_out: Boolean(r?.outBuf), has_rpt: Boolean(r?.rptText),
    has_2d_mesh: false, has_2d_results: false, twod_path: null,
    crs: p.crs ?? DEFAULT_CRS, crs_proj4: p.proj4, crs_confirmed: Boolean(p.crs),
    simulation_engine: 'openswmm', has_flow_accum_results: false,
  }
}

function archived() {
  const p = getProject()
  return (p?.results ?? []).map((r) => {
    const s = r.rptText ? parseReport(r.rptText) : null
    return {
      id: r.id, label: r.label, pinned: true, engine: engineOf(s?.engine), scenario_id: 'base',
      scenario_name: r.rptName ?? r.outName ?? 'Results', inp_name: p!.inpName, started: r.added, finished: r.added,
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
        case '/api/model/raingages':
          return ok({ raingages: [] })
        case '/api/model/profile': {
          const period = q.get('period')
          const o = outOf(current())
          const via = (q.get('via') ?? '').split(',').filter((v) => v.trim())
          return ok(buildProfile(model, q.get('start') ?? '', q.get('end') ?? '', o ? o.profileResults(period !== null ? Number(period) : null) : undefined, via))
        }
        case '/api/inp':
          return ok({ text: p.inpText })
        case '/api/rpt': {
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
        case '/api/runs/compare':
          return ok(compare(q.get('a') ?? '', q.get('b') ?? ''))
        case '/api/scenarios':
          return ok({ active: 'base', scenarios: [{ id: 'base', name: 'Base', parent: null, inp: p.inpName, created: '', description: '' }] })
        case '/api/2d/info':
          return ok({ has_mesh: false, vertex_count: 0, triangle_count: 0, output_file: null, report_2d: false, dry_depth: null, twod_path: null, has_results: false, mesh_file: null, boundary_edge_count: 0 })
        case '/api/gis/layers':
          return ok({ layers: [], project_crs: p.crs ?? DEFAULT_CRS })
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
        case '/api/out/snapshot':
          return ok(requireOut(current()).snapshot(Number(q.get('period') ?? 0)))
        case '/api/out/envelope':
          return ok(requireOut(current()).envelope())
      }
      // /api/model/objects/{type}/{id}
      if (seg[0] === 'model' && seg[1] === 'objects' && seg.length === 4) return ok(getObject(model, seg[2], seg[3]))
      if (seg[0] === 'model' && seg[1] === 'sections' && seg.length === 3) return ok(getSection(p.inpText, seg[2]))
      // /api/out/{nodes|links|subcatchments}/{id}/series
      if (seg[0] === 'out' && seg.length === 4 && seg[3] === 'series') {
        const kind = ({ nodes: 'node', links: 'link', subcatchments: 'subcatchment' } as const)[seg[1] as 'nodes']
        if (kind) return ok(requireOut(current()).seriesResponse(kind, seg[2], q.get('variable')))
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
    if (method === 'PATCH' && seg[0] === 'runs' && seg[1] === 'archive' && seg.length === 3) {
      await updateResult(seg[2], body as { label?: string })
      return ok({ runs: archived(), keep_unpinned: 0 })
    }
    if (method === 'DELETE' && seg[0] === 'runs' && seg[1] === 'archive' && seg.length === 3) {
      await removeResult(seg[2])
      return ok({ runs: archived(), keep_unpinned: 0 })
    }
    return err(501, DESKTOP_ONLY)
  } catch (e) {
    if (e instanceof NotFound) return err(404, e.message)
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
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }
}
