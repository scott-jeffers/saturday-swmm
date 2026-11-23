/**
 * Model library (browser viewer): search a GitHub collection of SWMM models
 * and open one here. Models stay on GitHub and are fetched only when opened.
 */
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, ExternalLink, FolderGit2, Loader2, Plus, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button, useToast } from '../components/ui'
import { useViewerOpen } from '../hooks/useViewerOpen'
import { cn } from '../lib/cn'
import {
  BUILTIN_LIBRARY,
  EMPTY_FILTER,
  FEATURE_LABEL,
  folderOf,
  githubUrl,
  listRepo,
  matches,
  modelName,
  parseRepo,
  rank,
  rawUrl,
  ROUTING_LABEL,
  saveLibraries,
  savedLibraries,
  type LibraryCatalog,
  type LibraryFilter,
  type LibraryModel,
} from '../viewer/library'

const PAGE = 60
const MAX_OUT_MB = 120

async function loadBuiltin(): Promise<LibraryCatalog> {
  const r = await fetch(`${import.meta.env.BASE_URL}library/${BUILTIN_LIBRARY.id}.json`)
  if (!r.ok) throw new Error('The library catalog is not available right now.')
  return (await r.json()) as LibraryCatalog
}

export function LibraryPage({ onOpen }: { onOpen: (path: string | null) => void }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const openFiles = useViewerOpen(onOpen)
  const [source, setSource] = useState<string>(BUILTIN_LIBRARY.repo)
  const [extra, setExtra] = useState(savedLibraries)
  const [adding, setAdding] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>(EMPTY_FILTER)
  const [shown, setShown] = useState(PAGE)
  const [opening, setOpening] = useState<string | null>(null)
  const q = useDeferredValue(filter.q)

  const isBuiltin = source === BUILTIN_LIBRARY.repo
  const extraEntry = extra.find((e) => e.repo === source)
  const catalog = useQuery({
    queryKey: ['model-library', source, extraEntry?.branch ?? ''],
    queryFn: () => (isBuiltin ? loadBuiltin() : listRepo(source, extraEntry?.branch)),
    staleTime: Infinity,
    retry: false,
  })
  const models = catalog.data?.models ?? []

  const folders = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of models) c.set(folderOf(m), (c.get(folderOf(m)) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [models])
  const features = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of models) for (const t of m.g ?? []) c.set(t, (c.get(t) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [models])

  const hits = useMemo(() => {
    const f = { ...filter, q }
    return models.filter((m) => matches(m, f)).sort((a, b) => rank(a) - rank(b) || a.p.localeCompare(b.p, undefined, { numeric: true }))
  }, [models, filter, q])

  const set = (patch: Partial<LibraryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }))
    setShown(PAGE)
  }
  const toggleIn = (key: 'folders' | 'features', v: string) => set({ [key]: filter[key].includes(v) ? filter[key].filter((x) => x !== v) : [...filter[key], v] })
  const anyFilter = JSON.stringify({ ...filter, q: '' }) !== JSON.stringify({ ...EMPTY_FILTER, q: '' }) || filter.q !== ''

  const addLibrary = () => {
    const r = parseRepo(adding)
    if (!r) {
      toast({ title: 'That doesn’t look like a GitHub repository', description: 'Use owner/repo or a github.com link.', tone: 'danger' })
      return
    }
    const next = [...extra.filter((e) => e.repo.toLowerCase() !== r.repo.toLowerCase()), r]
    setExtra(next)
    saveLibraries(next)
    setSource(r.repo)
    setFilter(EMPTY_FILTER)
    setAdding('')
  }
  const removeLibrary = (repo: string) => {
    const next = extra.filter((e) => e.repo !== repo)
    setExtra(next)
    saveLibraries(next)
    if (source === repo) setSource(BUILTIN_LIBRARY.repo)
  }

  const open = async (m: LibraryModel) => {
    const cat = catalog.data
    if (!cat) return
    setOpening(m.p)
    try {
      const stem = m.p.slice(0, -4)
      const name = (p: string) => p.split('/').pop()!
      const get = async (path: string) => {
        const r = await fetch(rawUrl(cat.repo, cat.branch, path))
        if (!r.ok) throw new Error(`${name(path)}: GitHub answered ${r.status}`)
        return new File([await r.blob()], name(path))
      }
      const files: File[] = [await get(m.p)]
      if (m.rpt) files.push(await get(stem + m.rpt).catch(() => null as unknown as File))
      if (m.out) {
        const url = rawUrl(cat.repo, cat.branch, stem + m.out)
        const head = await fetch(url, { method: 'HEAD' }).catch(() => null)
        const mb = Number(head?.headers.get('content-length') ?? 0) / 1e6
        if (mb > MAX_OUT_MB) toast({ title: 'Results left on GitHub', description: `The .out is ${mb.toFixed(0)} MB, too big to load in a browser tab. Opened the model and its report.` })
        else files.push(await get(stem + m.out).catch(() => null as unknown as File))
      }
      await openFiles(files.filter(Boolean), undefined, () => {})
    } catch (e) {
      toast({ title: `Couldn’t open ${modelName(m)}`, description: (e as Error).message, tone: 'danger' })
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <header className="mb-5">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group -ml-2 mb-3 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-fg-soft hover:bg-fg/[0.06] hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" aria-hidden />
            Back to start
          </button>
          <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em] text-fg">Model library</h1>
          <p className="m-0 mt-1 max-w-3xl text-[13px] text-muted">
            Search SWMM models kept on GitHub and open one here. Nothing is downloaded until you open a model, and it is read in this browser only.
          </p>
        </header>

        {/* sources */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SourceChip active={isBuiltin} onClick={() => setSource(BUILTIN_LIBRARY.repo)} label={BUILTIN_LIBRARY.title} />
          {extra.map((e) => (
            <SourceChip key={e.repo} active={source === e.repo} onClick={() => setSource(e.repo)} label={e.repo} onRemove={() => removeLibrary(e.repo)} />
          ))}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              addLibrary()
            }}
          >
            <input
              className="field h-8 w-64 text-[12px]"
              placeholder="Add a GitHub library: owner/repo"
              aria-label="GitHub repository to add"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={!adding.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </form>
        </div>

        {isBuiltin && (
          <p className="m-0 mb-4 text-[12px] text-muted">
            {BUILTIN_LIBRARY.blurb}{' '}
            <a href={`https://github.com/${BUILTIN_LIBRARY.repo}`} target="_blank" rel="noreferrer" className="text-accent-soft hover:underline">
              On GitHub
            </a>
          </p>
        )}

        {/* search */}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            className="h-11 w-full rounded-xl border border-border bg-elevated pl-10 pr-28 text-[14px] text-fg shadow-sm outline-none placeholder:text-muted focus:border-accent"
            placeholder="Search by name, title, folder or feature: rain garden, force main, pump station…"
            aria-label="Search models"
            value={filter.q}
            onChange={(e) => set({ q: e.target.value })}
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] tabular-nums text-muted">
            {catalog.isLoading ? 'Loading…' : `${hits.length.toLocaleString('en-US')} of ${models.length.toLocaleString('en-US')}`}
          </span>
        </div>

        {/* filters */}
        {models.length > 0 && (
          <div className="mb-5 space-y-2 rounded-xl border border-border bg-fg/[0.015] p-3">
            <FilterRow label="Topic">
              {folders.slice(0, 14).map(([f, n]) => (
                <Chip key={f} on={filter.folders.includes(f)} onClick={() => toggleIn('folders', f)}>
                  {f.replace(/_/g, ' ')} <span className="text-muted">{n.toLocaleString('en-US')}</span>
                </Chip>
              ))}
              {folders.length > 14 && (
                <select
                  className="field h-7 !w-auto text-[12px]"
                  value=""
                  aria-label="More folders"
                  onChange={(e) => e.target.value && toggleIn('folders', e.target.value)}
                >
                  <option value="">More folders…</option>
                  {folders.slice(14).map(([f, n]) => (
                    <option key={f} value={f}>
                      {f} ({n})
                    </option>
                  ))}
                </select>
              )}
            </FilterRow>
            {features.length > 0 && (
              <FilterRow label="Has">
                {features.map(([t, n]) => (
                  <Chip key={t} on={filter.features.includes(t)} onClick={() => toggleIn('features', t)}>
                    {FEATURE_LABEL[t] ?? t} <span className="text-muted">{n.toLocaleString('en-US')}</span>
                  </Chip>
                ))}
              </FilterRow>
            )}
            {!catalog.data?.live && (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <FilterRow label="Units">
                  <Seg value={filter.units} onChange={(v) => set({ units: v as LibraryFilter['units'] })} options={[['', 'Any'], ['US', 'US'], ['SI', 'Metric']]} />
                </FilterRow>
                <FilterRow label="Routing">
                  <Seg value={filter.routing} onChange={(v) => set({ routing: v })} options={[['', 'Any'], ['DYNWAVE', 'Dynamic'], ['KINWAVE', 'Kinematic'], ['STEADY', 'Steady']]} />
                </FilterRow>
                <FilterRow label="Size">
                  <Seg value={filter.size} onChange={(v) => set({ size: v as LibraryFilter['size'] })} options={[['', 'Any'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} />
                </FilterRow>
                <FilterRow label="Last run">
                  <Seg value={filter.status} onChange={(v) => set({ status: v })} options={[['', 'Any'], ['ok', 'Clean'], ['warn', 'Warnings'], ['err', 'Errors'], ['none', 'Not run']]} />
                </FilterRow>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-[12px] text-fg-soft">
                <input type="checkbox" checked={filter.results} onChange={(e) => set({ results: e.target.checked })} className="accent-[var(--color-accent)]" />
                Only models with results (.out) to view
              </label>
              {anyFilter && (
                <button type="button" onClick={() => set(EMPTY_FILTER)} className="text-[12px] text-accent-soft hover:underline">
                  Clear search and filters
                </button>
              )}
            </div>
          </div>
        )}

        {catalog.isError && <p className="text-[13px] text-danger">{(catalog.error as Error).message}</p>}
        {catalog.data?.live && (
          <p className="mb-3 text-[12px] text-muted">
            Listed live from GitHub: names and paths only. Libraries with a prepared catalog can also be filtered by units, routing, size and features.
          </p>
        )}

        {/* results */}
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {hits.slice(0, shown).map((m) => (
            <ModelCard key={m.p} m={m} repo={catalog.data!.repo} branch={catalog.data!.branch} busy={opening === m.p} disabled={opening != null} onOpen={() => void open(m)} />
          ))}
        </ul>
        {!catalog.isLoading && hits.length === 0 && models.length > 0 && (
          <p className="mt-8 text-center text-[13px] text-muted">No models match. Try fewer words or clear a filter.</p>
        )}
        {hits.length > shown && (
          <div className="mt-5 flex justify-center">
            <Button variant="outline" onClick={() => setShown((n) => n + PAGE * 2)}>
              Show more ({(hits.length - shown).toLocaleString('en-US')} left)
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function SourceChip({ label, active, onClick, onRemove }: { label: string; active: boolean; onClick: () => void; onRemove?: () => void }) {
  return (
    <span className={cn('inline-flex h-8 items-center rounded-full border text-[12px]', active ? 'border-accent/60 bg-accent/10 text-fg' : 'border-border text-fg-soft hover:border-border-strong')}>
      <button type="button" onClick={onClick} className="inline-flex h-full items-center gap-1.5 pl-3 pr-3">
        <FolderGit2 className="h-3.5 w-3.5" />
        {label}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="-ml-1.5 mr-1.5 rounded-full p-0.5 text-muted hover:text-fg">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 shrink-0 text-[11px] font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors',
        on ? 'border-accent bg-accent/15 font-medium text-fg' : 'border-border text-fg-soft hover:border-border-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <span className="inline-flex rounded-lg bg-fg/[0.06] p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn('rounded-md px-2 py-0.5 text-[12px]', value === v ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {l}
        </button>
      ))}
    </span>
  )
}

const STATUS: Record<string, [string, string]> = {
  ok: ['bg-emerald-500', 'Ran clean'],
  warn: ['bg-amber-500', 'Ran with warnings'],
  err: ['bg-red-500', 'Ran with errors'],
  none: ['bg-slate-400', 'Not run yet'],
}

function ModelCard({ m, repo, branch, busy, disabled, onOpen }: { m: LibraryModel; repo: string; branch: string; busy: boolean; disabled: boolean; onOpen: () => void }) {
  const parts = m.p.split('/')
  const dir = parts.slice(0, -1).join(' › ')
  const facts = [
    m.u,
    m.r ? ROUTING_LABEL[m.r] ?? m.r : null,
    m.n != null ? `${m.n.toLocaleString('en-US')} nodes` : null,
    m.l ? `${m.l.toLocaleString('en-US')} links` : null,
    m.s ? `${m.s.toLocaleString('en-US')} subcatchments` : null,
  ].filter(Boolean)
  const st = m.st ? STATUS[m.st] : null
  return (
    <li className="flex flex-col rounded-xl border border-border bg-elevated p-3.5 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold text-fg" title={m.p}>
            {modelName(m)}
          </div>
          {dir && <div className="truncate text-[11px] text-muted">{dir.replace(/_/g, ' ')}</div>}
        </div>
        {st && <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', st[0])} title={st[1]} aria-label={st[1]} />}
      </div>
      {m.t && <p className="m-0 mt-2 line-clamp-2 text-[12px] leading-snug text-fg-soft">{m.t}</p>}
      {facts.length > 0 && <p className="m-0 mt-2 text-[11px] text-muted">{facts.join(' · ')}</p>}
      {(m.g?.length || m.out || m.rpt) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.out ? <Tag strong>Results</Tag> : m.rpt ? <Tag>Report</Tag> : null}
          {(m.g ?? []).slice(0, 5).map((t) => (
            <Tag key={t}>{FEATURE_LABEL[t] ?? t}</Tag>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center gap-1 pt-3">
        <Button size="sm" variant="primary" onClick={onOpen} disabled={disabled}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? 'Opening…' : 'Open'}
        </Button>
        {m.md && (
          <a href={githubUrl(repo, branch, m.p.slice(0, -4) + '.md')} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-fg/[0.06] hover:text-fg">
            <BookOpen className="h-3.5 w-3.5" /> Summary
          </a>
        )}
        <a href={githubUrl(repo, branch, m.p)} target="_blank" rel="noreferrer" className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted hover:bg-fg/[0.06] hover:text-fg" title="View on GitHub">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </li>
  )
}

function Tag({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10.5px]', strong ? 'bg-accent/15 font-medium text-accent-soft' : 'bg-fg/[0.06] text-fg-soft')}>
      {children}
    </span>
  )
}
