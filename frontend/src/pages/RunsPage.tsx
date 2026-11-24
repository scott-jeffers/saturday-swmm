/**
 * Runs: every scenario (a version of the model) under every storm (a
 * rainfall event), as a grid. Each cell is one simulation with its own
 * results. Click a cell to look at it; tick cells and run them in one go;
 * pick any other cell to compare against.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, CloudRain, Eye, GitBranch, Loader2, Play, Plus, Square, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type RunCell, type RunMatrix, type Storm } from '../api/client'
import { AlertDialog, Button, PageHeader, useToast } from '../components/ui'
import { cn } from '../lib/cn'
import { useCompare } from '../lib/compare'
import { invalidateProjectQueries } from '../lib/projectQueries'

type Metric = 'flooded_nodes' | 'flood_volume' | 'surcharged_nodes' | 'surcharged_conduits'
const METRICS: { k: Metric; label: string; short: string }[] = [
  { k: 'flood_volume', label: 'Flood volume', short: 'flood vol.' },
  { k: 'flooded_nodes', label: 'Flooded nodes', short: 'flooded' },
  { k: 'surcharged_nodes', label: 'Surcharged nodes', short: 'surcharged' },
  { k: 'surcharged_conduits', label: 'Surcharged conduits', short: 'surch. pipes' },
]

function tree(list: RunMatrix['scenarios']) {
  const out: { s: RunMatrix['scenarios'][number]; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const s of list.filter((x) => (x.parent ?? null) === parent)) {
      out.push({ s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const s of list) if (!out.some((o) => o.s.id === s.id)) out.push({ s, depth: 0 })
  return out
}

const key = (scenario: string, storm: string) => `${scenario}~${storm}`

function stormDetail(s: Storm) {
  if (s.kind === 'model') return s.note ?? 'as the rain gages are set'
  const parts: string[] = []
  if (s.total != null) parts.push(`${s.total.toFixed(2)} ${s.units === 'MM' ? 'mm' : 'in'}`)
  if (s.start && s.end) {
    const h = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3.6e6
    if (Number.isFinite(h)) parts.push(h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`)
  }
  return parts.join(' · ')
}

export function RunsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const compare = useCompare()
  const matrix = useQuery({ queryKey: ['run-matrix'], queryFn: api.runMatrix })
  const [metric, setMetric] = useState<Metric>('flood_volume')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirmStorm, setConfirmStorm] = useState<Storm | null>(null)
  const batch = useQuery({ queryKey: ['run-batch'], queryFn: api.batchStatus, refetchInterval: (q) => (q.state.data?.running ? 1000 : false) })
  const wasRunning = useRef(false)

  // When a batch finishes, refresh the grid and anything showing results.
  useEffect(() => {
    const running = Boolean(batch.data?.running)
    if (wasRunning.current && !running) {
      invalidateProjectQueries(qc)
      const failed = batch.data?.items.filter((i) => i.state === 'failed') ?? []
      toast(
        failed.length
          ? { title: `${failed.length} run${failed.length === 1 ? '' : 's'} failed`, description: failed[0]?.note ?? undefined, tone: 'danger' }
          : { title: 'Runs finished', tone: 'success' },
      )
    }
    if (running) void qc.invalidateQueries({ queryKey: ['run-matrix'] })
    wasRunning.current = running
  }, [batch.data, qc, toast])

  const m = matrix.data
  const rows = useMemo(() => (m ? tree(m.scenarios) : []), [m])
  const cellOf = useMemo(() => new Map((m?.cells ?? []).map((c) => [key(c.scenario, c.storm), c])), [m])
  const runningKey = batch.data?.running ? batch.data.items.find((i) => i.state === 'running') : null
  const queued = new Set((batch.data?.running ? batch.data.items.filter((i) => i.state === 'waiting') : []).map((i) => key(i.scenario, i.storm)))
  const max = Math.max(0, ...(m?.cells ?? []).map((c) => Number(c.summary?.[metric] ?? 0)))
  const rawUnits = m?.cells.find((c) => c.summary?.flood_volume_units)?.summary?.flood_volume_units ?? ''
  const units = rawUnits.replace(/^10\^6\s*gal$/i, 'Mgal').replace(/^10\^6\s*(ltr|liters?)$/i, 'ML')

  const view = useMutation({
    mutationFn: async (c: RunCell) => {
      if (!m) return
      if (c.scenario !== m.active.scenario) await api.setActiveScenario(c.scenario)
      if (c.storm !== m.active.storm) await api.setActiveStorm(c.storm)
    },
    onSuccess: () => {
      invalidateProjectQueries(qc)
      navigate('/map')
    },
    onError: (e: Error) => toast({ title: 'Couldn’t open those results', description: e.message, tone: 'danger' }),
  })
  const run = useMutation({
    mutationFn: (cells: { scenario: string; storm: string }[]) => api.startBatch(cells),
    onSuccess: (d) => {
      qc.setQueryData(['run-batch'], d)
      setPicked(new Set())
    },
    onError: (e: Error) => toast({ title: 'Couldn’t start the runs', description: e.message, tone: 'danger' }),
  })
  const stop = useMutation({ mutationFn: api.cancelBatch, onSuccess: (d) => qc.setQueryData(['run-batch'], d) })
  const removeStorm = useMutation({
    mutationFn: (id: string) => api.deleteStorm(id),
    onSuccess: () => {
      setConfirmStorm(null)
      invalidateProjectQueries(qc)
    },
    onError: (e: Error) => toast({ title: 'Couldn’t delete the storm', description: e.message, tone: 'danger' }),
  })

  if (!m) {
    return <div className="p-6 text-sm text-muted">{matrix.isError ? (matrix.error as Error).message : 'Loading…'}</div>
  }

  const all = m.cells
  const missing = all.filter((c) => !c.has_results)
  const stale = all.filter((c) => c.stale)
  const pickedCells = all.filter((c) => picked.has(key(c.scenario, c.storm)))
  const busy = Boolean(batch.data?.running) || run.isPending
  const toggle = (c: RunCell) =>
    setPicked((p) => {
      const n = new Set(p)
      const k = key(c.scenario, c.storm)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const shade = (c: RunCell) => {
    const v = Number(c.summary?.[metric] ?? 0)
    if (!c.has_results) return undefined
    if (v <= 0) return 'color-mix(in srgb, var(--color-success) 10%, transparent)'
    const t = max > 0 ? v / max : 0
    return `color-mix(in srgb, var(--color-danger) ${Math.round(6 + t * 18)}%, transparent)`
  }
  const fmt = (c: RunCell, k: Metric) => {
    const v = c.summary?.[k]
    if (v == null) return '—'
    if (k === 'flood_volume') return Number(v) === 0 ? 'No flooding' : `${Number(v).toFixed(Number(v) < 1 ? 3 : 2)}`
    return String(v)
  }

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Runs"
          description="Every scenario under every storm. Each cell is its own simulation: click one to look at it on the map, tick cells to run them, or compare any two."
          actions={
            busy ? (
              <Button variant="outline" onClick={() => stop.mutate()}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            ) : (
              <>
                {pickedCells.length ? (
                  <Button variant="primary" onClick={() => run.mutate(pickedCells)}>
                    <Play className="h-3.5 w-3.5" /> Run {pickedCells.length} selected
                  </Button>
                ) : null}
                <Button variant={pickedCells.length ? 'outline' : 'primary'} disabled={!missing.length && !stale.length} onClick={() => run.mutate([...missing, ...stale])}>
                  <Play className="h-3.5 w-3.5" /> {missing.length || stale.length ? `Run ${missing.length + stale.length} not run or out of date` : 'All up to date'}
                </Button>
              </>
            )
          }
        />

        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-muted">Show</span>
          <div className="flex gap-0.5 rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Number shown in each cell">
            {METRICS.map((x) => (
              <button
                key={x.k}
                type="button"
                role="radio"
                aria-checked={metric === x.k}
                onClick={() => setMetric(x.k)}
                className={cn('h-7 rounded-md px-2.5', metric === x.k ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:text-fg')}
              >
                {x.label}
              </button>
            ))}
          </div>
          {busy && batch.data ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-muted" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Running {batch.data.items.filter((i) => i.state === 'done' || i.state === 'failed').length + 1} of {batch.data.items.length}
            </span>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border bg-fg/[0.02]">
                <th className="w-56 px-3 py-2 text-left align-bottom font-medium text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <GitBranch className="h-3.5 w-3.5 text-ic-scen" /> Scenario
                  </span>
                  <span className="mx-1 text-border-strong">×</span>
                  <span className="inline-flex items-center gap-1.5">
                    <CloudRain className="h-3.5 w-3.5 text-ic-rain" /> Storm
                  </span>
                </th>
                {m.storms.map((s) => (
                  <th key={s.id} className="group min-w-[9.5rem] px-3 py-2 text-left align-bottom">
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-fg" title={s.note ?? undefined}>
                          {s.name}
                        </div>
                        <div className="truncate text-[11px] font-normal text-muted">{stormDetail(s)}</div>
                      </div>
                      {s.kind !== 'model' ? (
                        <button
                          type="button"
                          aria-label={`Delete ${s.name}`}
                          title={`Delete ${s.name} and its results`}
                          className="rounded p-0.5 text-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => setConfirmStorm(s)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th className="w-32 px-3 py-2 text-left align-bottom">
                  <Link to="/storm" className="inline-flex items-center gap-1 text-[12px] font-normal text-accent-soft hover:underline">
                    <Plus className="h-3.5 w-3.5" /> Add storm
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, depth }) => (
                <tr key={s.id} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left align-middle font-medium text-fg" style={{ paddingLeft: 12 + depth * 16 }}>
                    <span className="block truncate" title={s.description || undefined}>
                      {depth ? <span className="mr-1 text-border-strong">└</span> : null}
                      {s.name}
                    </span>
                  </th>
                  {m.storms.map((st) => {
                    const c = cellOf.get(key(s.id, st.id))
                    if (!c) return <td key={st.id} />
                    const k = key(s.id, st.id)
                    const isActive = m.active.scenario === s.id && m.active.storm === st.id
                    const isTarget = compare.target?.id === c.id
                    const isRunning = runningKey && runningKey.scenario === s.id && runningKey.storm === st.id
                    const isQueued = queued.has(k)
                    return (
                      <td key={st.id} className="p-1.5 align-top">
                        <div
                          className={cn(
                            'group relative rounded-lg border px-2.5 py-2 transition-colors',
                            isActive ? 'border-accent ring-1 ring-accent' : isTarget ? 'border-dashed border-accent-soft' : 'border-border',
                          )}
                          style={{ background: shade(c) }}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              aria-label={`Select ${s.name} under ${st.name}`}
                              checked={picked.has(k)}
                              disabled={busy}
                              onChange={() => toggle(c)}
                            />
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left disabled:cursor-default"
                              disabled={!c.has_results || isActive}
                              title={c.has_results ? (isActive ? 'You’re looking at these results' : 'Look at these results') : 'Not run yet'}
                              onClick={() => view.mutate(c)}
                            >
                              {isRunning ? (
                                <span className="inline-flex items-center gap-1.5 text-[12px] text-accent-soft">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {Math.round(batch.data?.items.find((i) => i.scenario === s.id && i.storm === st.id)?.progress ?? 0)}%
                                </span>
                              ) : isQueued ? (
                                <span className="text-[12px] text-muted">Queued</span>
                              ) : c.has_results ? (
                                <>
                                  <span className="block text-[18px] font-semibold leading-tight tabular-nums text-fg">
                                    {fmt(c, metric)}
                                    {metric === 'flood_volume' && units && Number(c.summary?.flood_volume) !== 0 ? <span className="ml-1 text-[11px] font-normal text-muted">{units}</span> : null}
                                  </span>
                                  <span className="block truncate text-[11px] text-muted">
                                    {METRICS.filter((x) => x.k !== metric)
                                      .slice(0, 2)
                                      .map((x) => `${fmt(c, x.k)} ${x.short}`)
                                      .join(' · ')}
                                  </span>
                                </>
                              ) : (
                                <span className="text-[12px] text-muted">Not run</span>
                              )}
                            </button>
                          </div>
                          <div className="mt-1 flex items-center gap-1 text-[10.5px]">
                            {isActive ? <span className="inline-flex items-center gap-1 font-medium text-accent-soft"><Eye className="h-3 w-3" /> Viewing</span> : null}
                            {isTarget ? <span className="inline-flex items-center gap-1 font-medium text-accent-soft"><ArrowLeftRight className="h-3 w-3" /> Comparing</span> : null}
                            {c.stale ? <span className="text-warning" title="The model or storm changed after this run">Out of date</span> : null}
                            {c.has_results && !isActive ? (
                              <button
                                type="button"
                                className={cn('ml-auto rounded px-1 text-muted hover:bg-fg/10 hover:text-fg', isTarget ? 'text-accent-soft' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100')}
                                title={isTarget ? 'Stop comparing' : 'Compare the results you’re looking at with these'}
                                onClick={() => compare.setTarget(isTarget ? null : c.id)}
                              >
                                {isTarget ? 'Stop' : 'Compare'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    )
                  })}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
          <span>
            Scenarios are versions of the model: add one from the scenario menu in the header. Storms come from the{' '}
            <Link to="/storm" className="text-accent-soft hover:underline">
              Rainfall
            </Link>{' '}
            page; running under a storm never edits the model.
          </span>
          <Link to="/scenarios" className="text-accent-soft hover:underline">
            What differs between scenarios
          </Link>
          <Link to="/results" className="text-accent-soft hover:underline">
            Side-by-side results tables
          </Link>
        </div>
      </div>

      <AlertDialog
        open={Boolean(confirmStorm)}
        onOpenChange={(o) => !o && setConfirmStorm(null)}
        title={`Delete “${confirmStorm?.name}”?`}
        description="The storm and every scenario’s results under it are deleted. The model isn’t changed."
        confirming={removeStorm.isPending}
        onConfirm={() => confirmStorm && removeStorm.mutate(confirmStorm.id)}
      />
    </div>
  )
}
