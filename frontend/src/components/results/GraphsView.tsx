/**
 * Graphs: one place for every hydrograph and input time series.
 *
 * Left: a tree of the model (junctions, outfalls, storage, conduits, pumps…,
 * subcatchments, time series) with a search box and ticks. Right: one graph
 * per element type with everything ticked overlaid, plus one graph for the
 * ticked input time series. Several elements of a type share the variable
 * picked for that graph (flow for links, depth for nodes…).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ChevronRight, Crosshair, Download, Search, X } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type ModelNetwork } from '../../api/client'
import { parseTimeseries } from '../../lib/inputSeries'
import { cn } from '../../lib/cn'
import { ELEMENT_COLOR, type ElementColorKey } from '../../lib/elementColors'

export type GraphKind = 'node' | 'link' | 'subcatchment'
/** "node:J1", "link:C1", "subcatchment:S1", "ts:DESIGN" */
export type GraphKey = string

const MAX_PER_GRAPH = 12
const ROWS_PER_GROUP = 200
// Distinct in light and dark themes; the first is the app accent.
const COLORS = ['#2F80C8', '#D9861A', '#2E9E6B', '#C0392B', '#8E5BD6', '#13A3B5', '#B8860B', '#D6457A', '#5D7A8C', '#7BAE3B', '#E0663A', '#4B5FD6']

const GROUPS: { id: string; label: string; kind: GraphKind | 'ts'; match?: (p: Record<string, unknown>) => boolean }[] = [
  { id: 'junction', label: 'Junctions', kind: 'node', match: (p) => p.node_kind === 'junction' },
  { id: 'outfall', label: 'Outfalls', kind: 'node', match: (p) => p.node_kind === 'outfall' },
  { id: 'storage', label: 'Storage units', kind: 'node', match: (p) => p.node_kind === 'storage' },
  { id: 'divider', label: 'Dividers', kind: 'node', match: (p) => p.node_kind === 'divider' },
  { id: 'conduit', label: 'Conduits', kind: 'link', match: (p) => p.link_kind === 'conduit' },
  { id: 'pump', label: 'Pumps', kind: 'link', match: (p) => p.link_kind === 'pump' },
  { id: 'orifice', label: 'Orifices', kind: 'link', match: (p) => p.link_kind === 'orifice' },
  { id: 'weir', label: 'Weirs', kind: 'link', match: (p) => p.link_kind === 'weir' },
  { id: 'outlet', label: 'Outlets', kind: 'link', match: (p) => p.link_kind === 'outlet' },
  { id: 'subcatchment', label: 'Subcatchments', kind: 'subcatchment' },
  { id: 'ts', label: 'Time series', kind: 'ts' },
]

const DEFAULT_VAR: Record<GraphKind, string> = { node: 'depth', link: 'flow', subcatchment: 'runoff' }
const KIND_TITLE: Record<GraphKind, string> = { node: 'Nodes', link: 'Links', subcatchment: 'Subcatchments' }

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString())
const hhmm = (h: number) => {
  const m = Math.round(h * 60)
  const d = Math.floor(m / 1440)
  const r = m % 1440
  return `${d ? `${d}d ` : ''}${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}
const shortTime = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso)
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}` : iso
}

function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const text = [header, ...rows].map((r) => r.map((v) => (v == null ? '' : String(v))).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  a.download = `${name}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function GraphsView({
  network,
  checked,
  onCheckedChange,
  mapSelection,
  hasResults,
  runStamp,
  onShowOnMap,
  height,
}: {
  network: ModelNetwork
  checked: GraphKey[]
  onCheckedChange: (next: GraphKey[]) => void
  /** What is selected on the map right now, offered as "Add map selection". */
  mapSelection: { object_type: string; id: string }[]
  hasResults: boolean
  /** Changes after each run so graphs refetch. */
  runStamp?: string
  onShowOnMap: (item: { object_type: GraphKind; id: string }) => void
  height: number
}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [vars, setVars] = useState<Record<GraphKind, string>>(DEFAULT_VAR)

  const tsSection = useQuery({ queryKey: ['section', 'TIMESERIES'], queryFn: () => api.getSection('TIMESERIES'), retry: false })
  const series = useMemo(() => parseTimeseries(tsSection.data?.rows ?? []), [tsSection.data])

  const groups = useMemo(() => {
    const feats = network.geojson?.features ?? []
    return GROUPS.map((g) => {
      let ids: string[]
      if (g.kind === 'ts') ids = series.map((s) => s.name)
      else
        ids = feats
          .filter((f) => f.properties?.object_type === g.kind && (!g.match || g.match(f.properties as Record<string, unknown>)))
          .map((f) => String(f.properties?.id ?? ''))
          .filter(Boolean)
      ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return { ...g, ids }
    })
      .filter((g) => g.ids.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [network, series])

  // Open the group of anything newly ticked from outside (e.g. "Show in Graphs"
  // on the map, or seeded on first open), so ticked rows are visible in the
  // otherwise collapsed tree.
  const seen = useRef<Set<string>>(new Set())
  useEffect(() => {
    const added = checked.filter((k) => !seen.current.has(k))
    seen.current = new Set(checked)
    if (!added.length) return
    const toOpen: Record<string, boolean> = {}
    for (const k of added) {
      const i = k.indexOf(':')
      const kind = k.slice(0, i)
      const id = k.slice(i + 1)
      const g = groups.find((gr) => (gr.kind === kind || (kind === 'ts' && gr.kind === 'ts')) && gr.ids.includes(id))
      if (g) toOpen[g.id] = true
    }
    if (Object.keys(toOpen).length) setOpen((o) => ({ ...o, ...toOpen }))
    // Bring the first newly ticked row into view once its group has rendered.
    const first = added[0]!
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector(`[data-graph-key="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'center' }),
      ),
    )
  }, [checked, groups])

  const isOn = useMemo(() => new Set(checked), [checked])
  const toggle = (key: GraphKey) => onCheckedChange(isOn.has(key) ? checked.filter((k) => k !== key) : [...checked, key])
  const keyFor = (kind: GraphKind | 'ts', id: string) => `${kind}:${id}`

  const byKind = useMemo(() => {
    const out: Record<GraphKind | 'ts', string[]> = { node: [], link: [], subcatchment: [], ts: [] }
    for (const k of checked) {
      const i = k.indexOf(':')
      const kind = k.slice(0, i) as GraphKind | 'ts'
      if (kind in out) out[kind].push(k.slice(i + 1))
    }
    return out
  }, [checked])

  const addable = mapSelection
    .filter((s) => s.object_type === 'node' || s.object_type === 'link' || s.object_type === 'subcatchment')
    .map((s) => keyFor(s.object_type as GraphKind, s.id))
    .filter((k) => !isOn.has(k))

  const q = filter.trim().toLowerCase()
  const graphCount = (['node', 'link', 'subcatchment'] as const).filter((k) => byKind[k].length).length + (byKind.ts.length ? 1 : 0)
  const graphHeight = Math.max(200, Math.floor((height - 40) / Math.max(1, graphCount)) - 56)

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* ---------- tree ---------- */}
      <nav aria-label="Model elements" className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-elevated">
        <div className="border-b border-border p-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find by ID"
              aria-label="Find an element or time series by ID"
              className="field h-7 w-full pl-7 text-xs"
            />
          </label>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className="text-muted">
              {checked.length ? `${checked.length} ticked` : 'Tick items to graph them'}
            </span>
            <span className="flex-1" />
            {addable.length > 0 && (
              <button type="button" className="text-accent-soft hover:underline" onClick={() => onCheckedChange([...checked, ...addable])}>
                Add map selection ({addable.length})
              </button>
            )}
            {checked.length > 0 && (
              <button type="button" className="text-muted hover:text-fg" onClick={() => onCheckedChange([])}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1" role="tree" aria-label="Elements and time series">
          {groups.map((g) => {
            const ids = q ? g.ids.filter((id) => id.toLowerCase().includes(q)) : g.ids
            if (q && !ids.length) return null
            const expanded = q ? true : Boolean(open[g.id])
            const ticked = g.ids.filter((id) => isOn.has(keyFor(g.kind, id))).length
            return (
              <div key={g.id} role="treeitem" aria-expanded={expanded}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs font-medium text-fg hover:bg-fg/5"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted transition-transform', expanded && 'rotate-90')} />
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.id === 'ts' ? ELEMENT_COLOR.timeseries : ELEMENT_COLOR[g.id as ElementColorKey] }} aria-hidden />
                  <span className="flex-1">{g.label}</span>
                  {ticked > 0 && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent-soft">{ticked}</span>}
                  <span className="text-[10px] font-normal text-muted">{(q ? ids.length : g.ids.length).toLocaleString('en-US')}</span>
                </button>
                {expanded && (
                  <ul role="group" className="m-0 list-none p-0">
                    {[...ids.slice(0, ROWS_PER_GROUP), ...ids.slice(ROWS_PER_GROUP).filter((id) => isOn.has(keyFor(g.kind, id)))].map((id) => {
                      const key = keyFor(g.kind, id)
                      const on = isOn.has(key)
                      return (
                        <li key={id} className="group flex items-center gap-2 py-0.5 pl-7 pr-2 hover:bg-fg/5">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input type="checkbox" data-graph-key={key} checked={on} onChange={() => toggle(key)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                            <span className={cn('truncate font-mono text-[11.5px]', on ? 'text-fg' : 'text-fg-soft')}>{id}</span>
                          </label>
                          {g.kind !== 'ts' && (
                            <button
                              type="button"
                              aria-label={`Show ${id} on the map`}
                              title="Show on the map"
                              onClick={() => onShowOnMap({ object_type: g.kind as GraphKind, id })}
                              className="rounded p-0.5 text-muted opacity-0 hover:text-fg focus:opacity-100 group-hover:opacity-100"
                            >
                              <Crosshair className="h-3 w-3" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                    {ids.length > ROWS_PER_GROUP && (
                      <li className="py-1 pl-7 pr-2 text-[11px] text-muted">
                        and {(ids.length - ROWS_PER_GROUP - ids.slice(ROWS_PER_GROUP).filter((id) => isOn.has(keyFor(g.kind, id))).length).toLocaleString('en-US')} more. Type in Find to narrow the list.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      {/* ---------- graphs ---------- */}
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
        {!checked.length && (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted">
            <div>
              <p className="m-0">Tick junctions, conduits, subcatchments or time series on the left.</p>
              <p className="m-0 mt-1 text-xs">Everything ticked of one kind is drawn on one graph, so you can compare them.</p>
            </div>
          </div>
        )}
        {(['link', 'node', 'subcatchment'] as const).map((kind) =>
          byKind[kind].length ? (
            <ResultGraph
              key={kind}
              kind={kind}
              ids={byKind[kind]}
              variable={vars[kind]}
              onVariable={(v) => setVars((o) => ({ ...o, [kind]: v }))}
              onRemove={(id) => toggle(keyFor(kind, id))}
              hasResults={hasResults}
              runStamp={runStamp}
              height={graphHeight}
            />
          ) : null,
        )}
        {byKind.ts.length > 0 && (
          <InputGraph names={byKind.ts} series={series} onRemove={(n) => toggle(keyFor('ts', n))} height={graphHeight} />
        )}
      </div>
    </div>
  )
}

function GraphCard({
  title,
  controls,
  onExport,
  children,
}: {
  title: string
  controls?: React.ReactNode
  onExport?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-elevated p-3" aria-label={title}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="m-0 text-[13px] font-semibold text-fg">{title}</h3>
        {controls}
        <span className="flex-1" />
        {onExport && (
          <button type="button" onClick={onExport} title="Download as CSV" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-fg/5 hover:text-fg">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Chips({ ids, onRemove }: { ids: string[]; onRemove: (id: string) => void }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {ids.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-fg-soft">
          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
          {id}
          <button type="button" aria-label={`Remove ${id}`} onClick={() => onRemove(id)} className="text-muted hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}

const axisTick = { fontSize: 10, fill: 'var(--color-muted)' }
const tooltipStyle = { background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 11 }

function ResultGraph({
  kind,
  ids,
  variable,
  onVariable,
  onRemove,
  hasResults,
  runStamp,
  height,
}: {
  kind: GraphKind
  ids: string[]
  variable: string
  onVariable: (v: string) => void
  onRemove: (id: string) => void
  hasResults: boolean
  runStamp?: string
  height: number
}) {
  const shown = ids.slice(0, MAX_PER_GRAPH)
  const vars = useQuery({ queryKey: ['out-variables', kind, runStamp], queryFn: () => api.getOutVariables(kind), enabled: hasResults, retry: false })
  const varList = vars.data?.variables ?? []
  const v = varList.some((x) => x.id === variable) ? variable : (varList[0]?.id ?? variable)
  const results = useQueries({
    queries: shown.map((id) => ({
      queryKey: ['object-series', kind, id, v, runStamp],
      queryFn: () =>
        kind === 'node' ? api.getNodeSeries(id, v) : kind === 'link' ? api.getLinkSeries(id, v) : api.getSubcatchmentSeries(id, v),
      enabled: hasResults,
      retry: false,
      staleTime: 60_000,
    })),
  })
  const meta = varList.find((x) => x.id === v)
  const unit = meta?.unit ? ` (${meta.unit})` : ''
  const times = results.find((r) => r.data?.times?.length)?.data?.times ?? []
  // Rebuilt every render on purpose: the number of series changes as items
  // are ticked, and a memo keyed on a variable-length list goes stale.
  const data = times.map((t, i) => {
    const row: Record<string, number | string | null> = { t }
    results.forEach((r, j) => {
      row[shown[j]] = r.data?.values?.[i] ?? null
    })
    return row
  })
  const failed = results.map((r, j) => (r.isError ? shown[j] : null)).filter(Boolean) as string[]

  return (
    <GraphCard
      title={KIND_TITLE[kind]}
      controls={
        hasResults && varList.length > 0 ? (
          <select className="field h-7 w-auto min-w-[10rem] text-xs" value={v} onChange={(e) => onVariable(e.target.value)} aria-label={`${KIND_TITLE[kind]} variable`}>
            {varList.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {x.unit ? ` (${x.unit})` : ''}
              </option>
            ))}
          </select>
        ) : null
      }
      onExport={
        data.length
          ? () => downloadCsv(`${kind}_${v}`, ['time', ...shown.map((id) => `${id} ${meta?.label ?? v}${unit}`)], data.map((r) => [r.t as string, ...shown.map((id) => r[id] as number | null)]))
          : undefined
      }
    >
      <Chips ids={shown} onRemove={onRemove} />
      {ids.length > MAX_PER_GRAPH && (
        <p className="m-0 mb-2 text-[11px] text-muted">Showing the first {MAX_PER_GRAPH} of {ids.length} ticked; untick some to see the rest.</p>
      )}
      {!hasResults ? (
        <p className="m-0 py-8 text-center text-xs text-muted">Run the model to see results here.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 6, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="t" tickFormatter={shortTime} tick={axisTick} minTickGap={48} />
              <YAxis tick={axisTick} width={56} tickFormatter={fmt} label={{ value: `${meta?.label ?? v}${unit}`, angle: -90, position: 'insideLeft', offset: 8, fontSize: 10, fill: 'var(--color-muted)' }} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => shortTime(String(t))} formatter={(val) => fmt(Number(val))} />
              {shown.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {shown.map((id, i) => (
                <Line key={id} type="monotone" dataKey={id} stroke={COLORS[i % COLORS.length]} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {failed.length > 0 && <p className="m-0 mt-1 text-[11px] text-danger">No {meta?.label?.toLowerCase() ?? v} results for {failed.join(', ')}.</p>}
        </>
      )}
    </GraphCard>
  )
}

function InputGraph({
  names,
  series,
  onRemove,
  height,
}: {
  names: string[]
  series: ReturnType<typeof parseTimeseries>
  onRemove: (n: string) => void
  height: number
}) {
  const shown = names.slice(0, MAX_PER_GRAPH)
  const picked = shown.map((n) => series.find((s) => s.name === n)).filter((s): s is NonNullable<typeof s> => Boolean(s))
  const files = picked.filter((s) => s.file)
  const drawn = picked.filter((s) => !s.file)
  return (
    <GraphCard
      title="Time series (model inputs)"
      onExport={
        drawn.length
          ? () =>
              downloadCsv(
                'time_series',
                ['series', 'hours', 'value'],
                drawn.flatMap((s) => s.hours.map((h, i) => [s.name, Number(h.toFixed(4)), s.values[i]])),
              )
          : undefined
      }
    >
      <Chips ids={shown} onRemove={onRemove} />
      {drawn.length > 0 && (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart margin={{ top: 6, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={hhmm} tick={axisTick} allowDuplicatedCategory={false} />
            <YAxis tick={axisTick} width={56} tickFormatter={fmt} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(h) => hhmm(Number(h))} formatter={(val) => fmt(Number(val))} />
            {drawn.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {drawn.map((s) => (
              <Line
                key={s.name}
                name={s.name}
                data={s.hours.map((h, i) => ({ x: h, y: s.values[i] }))}
                dataKey="y"
                type="stepAfter"
                stroke={COLORS[shown.indexOf(s.name) % COLORS.length]}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      {files.map((s) => (
        <p key={s.name} className="m-0 mt-1 text-[11px] text-muted">
          {s.name} reads its values from <span className="font-mono">{s.file}</span>, which isn’t drawn here.
        </p>
      ))}
    </GraphCard>
  )
}
