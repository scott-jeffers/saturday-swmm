/**
 * SWMM model libraries on GitHub, for the browser viewer.
 *
 * A library is a GitHub repository full of .inp files. The built-in one has a
 * catalog made at deploy time (scripts/build_model_library.py) with facts from
 * each model's Markdown summary; any other repository is listed on the fly
 * through GitHub's public API. Models are fetched from raw.githubusercontent.com
 * only when opened, so nothing ships with the site.
 */

export type LibraryModel = {
  /** Path of the .inp in the repository. */
  p: string
  /** Title from the model's [TITLE] section. */
  t?: string
  /** Flow units, routing method, infiltration method. */
  u?: string
  r?: string
  i?: string
  /** Node, link and subcatchment counts. */
  n?: number
  l?: number
  s?: number
  /** Run status of the stored report: clean, warnings, errors, not run. */
  st?: 'ok' | 'warn' | 'err' | 'none'
  /** Feature tags (lid, quality, controls, groundwater, pumps, storage, …). */
  g?: string[]
  /** Suffix of a .rpt / .out next to the .inp (e.g. ".rpt"), when there is one. */
  rpt?: string
  out?: string
  /** 1 when a Markdown summary sits next to it. */
  md?: 1
}

export type LibraryCatalog = {
  repo: string
  branch: string
  title: string
  built?: string
  count: number
  models: LibraryModel[]
  /** Listed live from the GitHub API (no summaries). */
  live?: boolean
}

export const BUILTIN_LIBRARY = {
  id: 'dickinson-1729',
  repo: 'SWMMBobSWMM6/1729-SWMM5-Models-2030',
  title: 'Bob Dickinson’s SWMM5 model library',
  blurb: '4,500 EPA SWMM5 models: training sets, hydrology, hydraulics, LID, water quality, regression tests and XPSWMM conversions. Public domain.',
}

export const FEATURE_LABEL: Record<string, string> = {
  lid: 'LID',
  quality: 'Water quality',
  controls: 'Control rules',
  groundwater: 'Groundwater',
  pumps: 'Pumps',
  storage: 'Storage',
  weirs: 'Weirs',
  orifices: 'Orifices',
  outlets: 'Outlets',
}

export const ROUTING_LABEL: Record<string, string> = { DYNWAVE: 'Dynamic wave', KINWAVE: 'Kinematic wave', STEADY: 'Steady' }

export function rawUrl(repo: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function githubUrl(repo: string, branch: string, path: string): string {
  return `https://github.com/${repo}/blob/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function modelName(m: LibraryModel): string {
  const base = m.p.split('/').pop() ?? m.p
  return base.replace(/\.inp$/i, '')
}

export function folderOf(m: LibraryModel): string {
  const i = m.p.indexOf('/')
  return i < 0 ? '(top level)' : m.p.slice(0, i)
}

/** Parse "owner/repo", a GitHub URL, or a URL with /tree/<branch>/… */
export function parseRepo(input: string): { repo: string; branch?: string } | null {
  const s = input.trim().replace(/\.git$/, '')
  const m = s.match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+))?/)
  if (!m) return null
  return { repo: `${m[1]}/${m[2]}`, branch: m[3] }
}

/** List any public repository's .inp files through the GitHub API (one call). */
export async function listRepo(repo: string, branch?: string): Promise<LibraryCatalog> {
  const api = `https://api.github.com/repos/${repo}`
  const meta = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } })
  if (meta.status === 404) throw new Error(`${repo} was not found on GitHub, or it is private.`)
  if (meta.status === 403) throw new Error('GitHub’s hourly limit for anonymous requests was reached. Try again later.')
  if (!meta.ok) throw new Error(`GitHub answered ${meta.status}.`)
  const info = (await meta.json()) as { default_branch: string; description?: string | null; full_name: string }
  const br = branch || info.default_branch
  const res = await fetch(`${api}/git/trees/${encodeURIComponent(br)}?recursive=1`, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub’s hourly limit for anonymous requests was reached. Try again later.' : `Couldn’t list ${repo} (${res.status}).`)
  const tree = (await res.json()) as { tree: { path: string; type: string }[]; truncated?: boolean }
  const files = tree.tree.filter((e) => e.type === 'blob').map((e) => e.path)
  const have = new Map(files.map((f) => [f.toLowerCase(), f]))
  const models: LibraryModel[] = []
  for (const p of files) {
    if (!/\.inp$/i.test(p)) continue
    const stem = p.slice(0, -4)
    const m: LibraryModel = { p }
    const rpt = have.get(`${stem}.rpt`.toLowerCase())
    const out = have.get(`${stem}.out`.toLowerCase())
    if (rpt) m.rpt = rpt.slice(stem.length)
    if (out) m.out = out.slice(stem.length)
    if (have.has(`${stem}.md`.toLowerCase())) m.md = 1
    models.push(m)
  }
  models.sort((a, b) => a.p.localeCompare(b.p, undefined, { numeric: true, sensitivity: 'base' }))
  return { repo: info.full_name, branch: br, title: info.full_name, count: models.length, models, live: true }
}

// ---------------------------------------------------------------- search

export type LibraryFilter = {
  q: string
  folders: string[]
  features: string[]
  units: '' | 'US' | 'SI'
  routing: string
  status: string
  size: '' | 'small' | 'medium' | 'large'
  results: boolean
}

export const EMPTY_FILTER: LibraryFilter = { q: '', folders: [], features: [], units: '', routing: '', status: '', size: '', results: false }

const US = new Set(['CFS', 'GPM', 'MGD'])

function haystack(m: LibraryModel): string {
  return [m.p, m.t ?? '', m.u ?? '', m.r ?? '', m.i ?? '', ...(m.g ?? []).map((t) => FEATURE_LABEL[t] ?? t)].join(' ').toLowerCase()
}

const hayCache = new WeakMap<LibraryModel, string>()

export function matches(m: LibraryModel, f: LibraryFilter): boolean {
  if (f.folders.length && !f.folders.includes(folderOf(m))) return false
  if (f.features.length && !f.features.every((t) => m.g?.includes(t))) return false
  if (f.units === 'US' && !(m.u && US.has(m.u))) return false
  if (f.units === 'SI' && !(m.u && !US.has(m.u))) return false
  if (f.routing && m.r !== f.routing) return false
  if (f.status && m.st !== f.status) return false
  if (f.results && !m.out) return false
  if (f.size) {
    const n = (m.n ?? 0) + (m.s ?? 0)
    if (f.size === 'small' && !(m.n != null && n < 50)) return false
    if (f.size === 'medium' && !(n >= 50 && n <= 500)) return false
    if (f.size === 'large' && !(n > 500)) return false
  }
  if (f.q.trim()) {
    let h = hayCache.get(m)
    if (!h) {
      h = haystack(m)
      hayCache.set(m, h)
    }
    for (const w of f.q.toLowerCase().split(/\s+/).filter(Boolean)) if (!h.includes(w)) return false
  }
  return true
}

/** Titled, summarised, results-bearing models first; then by name. */
export function rank(m: LibraryModel): number {
  return (m.t ? 0 : 2) + (m.md ? 0 : 1) + (m.out ? 0 : 1)
}

// ------------------------------------------------------- saved libraries

const KEY = 'saturday-swmm.libraries'

export function savedLibraries(): { repo: string; branch?: string }[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? (v as { repo: string; branch?: string }[]) : []
  } catch {
    return []
  }
}

export function saveLibraries(list: { repo: string; branch?: string }[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* private mode */
  }
}
