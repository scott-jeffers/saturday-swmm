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
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fitY, flowVolumeUnit, rainDepthUnit, seriesStats, StatsToggle, useChartZoom, useShowStats, useWheelZoom, ZoomControls, type XRange } from './chartZoom'
import { useElementMenu } from '../ElementMenu'
import { useCompare } from '../../lib/compare'
import { lidSeriesAtPeriods, lidUnit, parseLidReports, usedColumns, type LidReport } from '../../lib/lidReport'
import { api, type ModelNetwork } from '../../api/client'
import { parseTimeseries } from '../../lib/inputSeries'
import type { InputSeries } from '../../lib/inputSeries'
import { dwfProfile, inflowSeries, parseDwf, parseInflows, parsePatterns, patternSeries } from '../../lib/inflows'
import { cn } from '../../lib/cn'
import { ELEMENT_COLOR, type ElementColorKey } from '../../lib/elementColors'

export type GraphKind = 'node' | 'link' | 'subcatchment'
/** Results without a place on the map: system-wide values and LID units. */
type ExtraKind = 'system' | 'lid'
type ChartKind = GraphKind | ExtraKind
const isMapKind = (k: string): k is GraphKind => k === 'node' || k === 'link' || k === 'subcatchment'
/** "node:J1", "link:C1", "subcatchment:S1", "ts:DESIGN" */
export type GraphKey = string

const MAX_PER_GRAPH = 12
const ROWS_PER_GROUP = 200
// Distinct in light and dark themes; the first is the app accent.
const COLORS = ['#2F80C8', '#D9861A', '#2E9E6B', '#C0392B', '#8E5BD6', '#13A3B5', '#B8860B', '#D6457A', '#5D7A8C', '#7BAE3B', '#E0663A', '#4B5FD6']

type InputKind = 'ts' | 'dwf' | 'inflow' | 'pat'
const INPUT_KINDS: InputKind[] = ['ts', 'dwf', 'inflow', 'pat']
const isInput = (k: string): k is InputKind => (INPUT_KINDS as string[]).includes(k)
const INPUT_TITLE: Record<InputKind, string> = {
  ts: 'Time series (model inputs)',
  dwf: 'Dry-weather inflow · typical weekday',
  inflow: 'External inflows',
  pat: 'Time patterns (multipliers)',
}

const GROUPS: { id: string; label: string; kind: GraphKind | InputKind | ExtraKind; match?: (p: Record<string, unknown>) => boolean }[] = [
  { id: 'system', label: 'System', kind: 'system' },
  { id: 'lid', label: 'LID units', kind: 'lid' },
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
  { id: 'dwf', label: 'Dry-weather inflow', kind: 'dwf' },
  { id: 'inflow', label: 'External inflows', kind: 'inflow' },
  { id: 'pat', label: 'Patterns', kind: 'pat' },
]

const DEFAULT_VAR: Record<GraphKind, string> = { node: 'depth', link: 'flow', subcatchment: 'runoff' }
const KIND_TITLE: Record<ChartKind, string> = { node: 'Nodes', link: 'Links', subcatchment: 'Subcatchments', system: 'System', lid: 'LID units' }

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
  stacked = false,
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
  /** A narrow space (a split-view pane): the element list sits above the graphs. */
  stacked?: boolean
}) {
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const elementMenu = useElementMenu({ onZoom: (t) => onShowOnMap({ object_type: t.object_type as GraphKind, id: t.id }) })
  const [vars, setVars] = useState<Record<GraphKind, string> & { lid?: string }>(DEFAULT_VAR)

  const tsSection = useQuery({ queryKey: ['section', 'TIMESERIES'], queryFn: () => api.getSection('TIMESERIES'), retry: false })
  const series = useMemo(() => parseTimeseries(tsSection.data?.rows ?? []), [tsSection.data])
  const secQ = (n: string) => ({ queryKey: ['section', n], queryFn: () => api.getSection(n), retry: false, staleTime: 30_000 })
  const dwfQ = useQuery(secQ('DWF'))
  const infQ = useQuery(secQ('INFLOWS'))
  const patQ = useQuery(secQ('PATTERNS'))
  const gageQ = useQuery(secQ('RAINGAGES'))
  // Time series that rain gages read, with the gage's format (INTENSITY, VOLUME, CUMULATIVE).
  const rainSeries = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of gageQ.data?.rows ?? []) {
      const v = r.values.map((x) => x.replace(/^"|"$/g, ''))
      if ((v[4] ?? '').toUpperCase() === 'TIMESERIES' && v[5]) m.set(v[5], (v[1] ?? 'INTENSITY').toUpperCase())
    }
    return m
  }, [gageQ.data])
  const inputs = useMemo(() => {
    const patterns = parsePatterns(patQ.data?.rows ?? [])
    const dwf = parseDwf(dwfQ.data?.rows ?? []).filter((d) => d.constituent.toUpperCase() === 'FLOW').map((d) => dwfProfile(d, patterns))
    const tsBy = new Map(series.map((x) => [x.name.toUpperCase(), x]))
    const inflow = parseInflows(infQ.data?.rows ?? [])
      .filter((f) => f.constituent.toUpperCase() === 'FLOW')
      .map((f) => inflowSeries(f, f.series ? tsBy.get(f.series.toUpperCase()) : undefined))
    const pat = [...patterns.values()].map(patternSeries)
    return { ts: series, dwf, inflow, pat } as Record<InputKind, InputSeries[]>
  }, [series, dwfQ.data, infQ.data, patQ.data])

  // System-wide results and each LID unit's own report (when the run has them).
  const sysVarsQ = useQuery({ queryKey: ['system-variables', runStamp], queryFn: api.getSystemVariables, enabled: hasResults, retry: false, staleTime: 60_000 })
  const sysVars = sysVarsQ.data?.variables ?? []
  const lidQ = useQuery({ queryKey: ['lid-reports', 'current', runStamp], queryFn: () => api.lidReports('current'), enabled: hasResults, retry: false, staleTime: 60_000 })
  const lidReports = useMemo(() => parseLidReports((lidQ.data?.reports ?? []).map((r) => r.text)), [lidQ.data])
  const cmp = useCompare(runStamp)
  const otherLidQ = useQuery({
    queryKey: ['lid-reports', cmp.target?.id, runStamp],
    queryFn: () => api.lidReports(cmp.target!.id),
    enabled: hasResults && Boolean(cmp.target),
    retry: false,
    staleTime: 60_000,
  })
  const otherLid = useMemo(() => (cmp.target ? parseLidReports((otherLidQ.data?.reports ?? []).map((r) => r.text)) : null), [cmp.target, otherLidQ.data])
  const periodsQ = useQuery({ queryKey: ['out-periods-graphs', runStamp], queryFn: api.getOutPeriods, enabled: hasResults && lidReports.length > 0, retry: false, staleTime: 60_000 })
  const labelOf = useMemo(() => new Map(sysVars.map((v) => [v.id, v.label])), [sysVars])

  const groups = useMemo(() => {
    const feats = network.geojson?.features ?? []
    return GROUPS.map((g) => {
      let ids: string[]
      if (g.kind === 'system') return { ...g, ids: sysVars.map((v) => v.id) }
      if (g.kind === 'lid') return { ...g, ids: lidReports.map((r) => r.key) }
      if (isInput(g.kind)) ids = inputs[g.kind].map((s) => s.name)
      else
        ids = feats
          .filter((f) => f.properties?.object_type === g.kind && (!g.match || g.match(f.properties as Record<string, unknown>)))
          .map((f) => String(f.properties?.id ?? ''))
          .filter(Boolean)
      ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return { ...g, ids }
    })
      .filter((g) => g.ids.length > 0)
      // System first (the whole model), LID units next, then elements A–Z.
      .sort((a, b) => (a.kind === 'system' ? -1 : b.kind === 'system' ? 1 : a.kind === 'lid' ? -1 : b.kind === 'lid' ? 1 : a.label.localeCompare(b.label)))
  }, [network, inputs, sysVars, lidReports])

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
      const g = groups.find((gr) => gr.kind === kind && gr.ids.includes(id))
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
  const keyFor = (kind: GraphKind | InputKind | ExtraKind, id: string) => `${kind}:${id}`

  const byKind = useMemo(() => {
    const out: Record<GraphKind | InputKind | ExtraKind, string[]> = { node: [], link: [], subcatchment: [], ts: [], dwf: [], inflow: [], pat: [], system: [], lid: [] }
    for (const k of checked) {
      const i = k.indexOf(':')
      const kind = k.slice(0, i) as GraphKind | InputKind | ExtraKind
      if (kind in out) out[kind].push(k.slice(i + 1))
    }
    return out
  }, [checked])

  const addable = mapSelection
    .filter((s) => s.object_type === 'node' || s.object_type === 'link' || s.object_type === 'subcatchment')
    .map((s) => keyFor(s.object_type as GraphKind, s.id))
    .filter((k) => !isOn.has(k))

  const q = filter.trim().toLowerCase()
  // System values sharing a unit go on one graph (runoff, outflow and flooding together).
  const sysGroups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const id of byKind.system) {
      const u = sysVars.find((v) => v.id === id)?.unit ?? ''
      m.set(u, [...(m.get(u) ?? []), id])
    }
    return [...m]
  }, [byKind.system, sysVars])
  const graphCount =
    (['node', 'link', 'subcatchment', 'lid'] as const).filter((k) => byKind[k].length).length + sysGroups.length + INPUT_KINDS.filter((k) => byKind[k].length).length
  const graphHeight = Math.max(200, Math.floor((height - 40) / Math.max(1, graphCount)) - 56)

  return (
    <div className={stacked ? 'flex h-full min-h-0 flex-col gap-3' : 'flex h-full min-h-0 gap-4 max-md:flex-col max-md:gap-3'}>
      {/* ---------- tree (on phones: a short list above the graphs) ---------- */}
      <nav
        aria-label="Model elements"
        className={
          stacked
            ? 'flex max-h-[34%] w-full shrink-0 flex-col rounded-lg border border-border bg-elevated'
            : 'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-elevated max-md:max-h-[38%] max-md:w-full'
        }
      >
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
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.kind === 'system' ? 'var(--color-accent)' : g.kind === 'lid' ? ELEMENT_COLOR.subcatchment : isInput(g.kind) ? ELEMENT_COLOR.timeseries : ELEMENT_COLOR[g.id as ElementColorKey] }} aria-hidden />
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
                        <li
                          key={id}
                          className="group flex items-center gap-2 py-0.5 pl-7 pr-2 hover:bg-fg/5"
                          onContextMenu={
                            !isMapKind(g.kind)
                              ? undefined
                              : (e) => elementMenu.open(e, { object_type: g.kind as GraphKind, id, label: `${g.id.charAt(0).toUpperCase()}${g.id.slice(1)} ${id}` })
                          }
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input type="checkbox" data-graph-key={key} checked={on} onChange={() => toggle(key)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                            <span className={cn('truncate text-[11.5px]', g.kind === 'system' ? '' : 'font-mono', on ? 'text-fg' : 'text-fg-soft')}>{g.kind === 'system' ? (labelOf.get(id) ?? id) : id}</span>
                          </label>
                          {isMapKind(g.kind) && (
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
        {elementMenu.element}
      </nav>

      {/* ---------- graphs ---------- */}
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
        {!checked.length && (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted">
            <div>
              <p className="m-0">Tick System values, LID units, junctions, conduits, subcatchments or time series on the left.</p>
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
        {sysGroups.map(([unit, ids]) => (
          <ResultGraph
            key={`system-${unit}`}
            kind="system"
            ids={ids}
            variable=""
            onVariable={() => {}}
            onRemove={(id) => toggle(keyFor('system', id))}
            hasResults={hasResults}
            runStamp={runStamp}
            height={graphHeight}
            systemUnit={unit}
            labelOf={(id) => labelOf.get(id) ?? id}
          />
        ))}
        {byKind.lid.length > 0 && (
          <ResultGraph
            kind="lid"
            ids={byKind.lid}
            variable={vars.lid ?? 'inflow'}
            onVariable={(v) => setVars((o) => ({ ...o, lid: v }))}
            onRemove={(id) => toggle(keyFor('lid', id))}
            hasResults={hasResults}
            runStamp={runStamp}
            height={graphHeight}
            lid={{ reports: lidReports, other: otherLid, stepSec: periodsQ.data?.report_step_sec ?? 0, times: periodsQ.data?.times ?? [] }}
          />
        )}
        {byKind.ts.length > 0 && (
          <InputGraph title={INPUT_TITLE.ts} names={byKind.ts} series={series} onRemove={(n) => toggle(keyFor('ts', n))} height={graphHeight} rain={rainSeries} />
        )}
        {(['dwf', 'inflow', 'pat'] as const).map((k) =>
          byKind[k].length > 0 ? (
            <InputGraph key={k} title={INPUT_TITLE[k]} names={byKind[k]} series={inputs[k]} onRemove={(n) => toggle(keyFor(k, n))} height={graphHeight} flow={k !== 'pat'} />
          ) : null,
        )}
      </div>
    </div>
  )
}

function GraphCard({
  title,
  controls,
  tools,
  onExport,
  children,
}: {
  title: string
  controls?: React.ReactNode
  /** Zoom and Values buttons, next to the export button. */
  tools?: React.ReactNode
  onExport?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-elevated p-3" aria-label={title}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="m-0 text-[13px] font-semibold text-fg">{title}</h3>
        {controls}
        <span className="flex-1" />
        {tools}
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

function Chips({ ids, onRemove, labelOf }: { ids: string[]; onRemove: (id: string) => void; labelOf?: (id: string) => string }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {ids.map((id, i) => (
        <span key={id} className={cn('inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-soft', !labelOf && 'font-mono')}>
          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
          {labelOf ? labelOf(id) : id}
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

type SeriesLike = { data?: { values?: (number | null)[]; times?: string[] }; isError?: boolean }

function ResultGraph({
  kind,
  ids,
  variable,
  onVariable,
  onRemove,
  hasResults,
  runStamp,
  height,
  systemUnit,
  labelOf,
  lid,
}: {
  kind: ChartKind
  ids: string[]
  variable: string
  onVariable: (v: string) => void
  onRemove: (id: string) => void
  hasResults: boolean
  runStamp?: string
  height: number
  /** System graphs: the unit every value on this graph shares. */
  systemUnit?: string
  labelOf?: (id: string) => string
  /** LID graphs: each unit's parsed report, and the compared run's. */
  lid?: { reports: LidReport[]; other: LidReport[] | null; stepSec: number; times: string[] }
}) {
  const shown = ids.slice(0, MAX_PER_GRAPH)
  const mapKind = isMapKind(kind)
  const vars = useQuery({
    queryKey: ['out-variables', kind, runStamp],
    queryFn: () => api.getOutVariables(kind as GraphKind),
    enabled: hasResults && mapKind,
    retry: false,
  })
  const lidUsed = useMemo(() => (lid ? usedColumns(lid.reports) : []), [lid])
  const lidUs = lid?.reports[0]?.us ?? true
  const varList: { id: string; label: string; unit?: string }[] =
    kind === 'lid' ? lidUsed.map((c) => ({ id: c.id, label: c.label, unit: lidUnit(c, lidUs) })) : mapKind ? (vars.data?.variables ?? []) : []
  const v = kind === 'system' ? '' : varList.some((x) => x.id === variable) ? variable : (varList[0]?.id ?? variable)
  const fetched = useQueries({
    queries: shown.map((id) => ({
      queryKey: ['object-series', kind, id, v, runStamp],
      queryFn: () =>
        kind === 'system'
          ? api.getSystemSeries(id)
          : kind === 'node'
            ? api.getNodeSeries(id, v)
            : kind === 'link'
              ? api.getLinkSeries(id, v)
              : api.getSubcatchmentSeries(id, v),
      enabled: hasResults && kind !== 'lid',
      retry: false,
      staleTime: 60_000,
    })),
  })
  // Comparing with another scenario / result set: the same series from it, dashed.
  const cmp = useCompare(runStamp)
  const cmpTarget = cmp.target
  // No dashed lines for LID units the compared run doesn't have.
  const other = cmpTarget && !(kind === 'lid' && !lid?.other?.length) ? cmpTarget : null
  const otherFetched = useQueries({
    queries: shown.map((id) => ({
      queryKey: ['compare-series', other?.id, kind, id, v],
      queryFn: () => (kind === 'system' ? api.runSystemSeries(other!.id, id) : api.runSeries(other!.id, kind as GraphKind, id, v)),
      enabled: hasResults && Boolean(other) && kind !== 'lid',
      retry: false,
      staleTime: 60_000,
    })),
  })
  // LID units come from their report files, lined up with the run's report steps.
  const fromLid = (reports: LidReport[] | null | undefined): SeriesLike[] =>
    shown.map((id) => {
      const r = reports?.find((x) => x.key === id)
      if (!r || !lid?.stepSec || !lid.times.length) return { isError: Boolean(reports) && !r }
      return { data: { values: lidSeriesAtPeriods(r, v, lid.stepSec, lid.times.length), times: lid.times } }
    })
  const results: SeriesLike[] = kind === 'lid' ? fromLid(lid?.reports) : fetched
  const otherResults: SeriesLike[] = kind === 'lid' ? (other ? fromLid(lid?.other) : []) : otherFetched
  const cmpKey = (id: string) => `${id}\u0000cmp`
  const label = (id: string) => labelOf?.(id) ?? id
  const nameA = (id: string) => (other ? `${label(id)} · ${cmp.current?.label ?? 'current'}` : label(id))
  const nameB = (id: string) => `${label(id)} · ${other?.label ?? ''}`
  const meta: { label: string; unit?: string } | undefined =
    kind === 'system' ? { label: shown.length === 1 ? label(shown[0]!) : 'System', unit: systemUnit } : varList.find((x) => x.id === v)
  const unit = meta?.unit ? ` (${meta.unit})` : ''
  const times = results.find((r) => r.data?.times?.length)?.data?.times ?? []
  // Rebuilt every render on purpose: the number of series changes as items
  // are ticked, and a memo keyed on a variable-length list goes stale.
  const data = times.map((t, i) => {
    const row: Record<string, number | string | null> = { t, i }
    results.forEach((r, j) => {
      row[shown[j]] = r.data?.values?.[i] ?? null
    })
    if (other) otherResults.forEach((r, j) => {
      row[cmpKey(shown[j])] = r.data?.values?.[i] ?? null
    })
    return row
  })
  const failed = results.map((r, j) => (r.isError ? shown[j] : null)).filter(Boolean) as string[]
  const full: XRange | null = times.length > 1 ? [0, times.length - 1] : null
  const plotRef = useRef<HTMLDivElement>(null)
  const zoom = useChartZoom(full, plotRef)
  useWheelZoom(plotRef, zoom.view, zoom.zoomBy)
  const [showStats] = useShowStats()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  // Rainfall reads as a hyetograph (bars), and its Values give the depth that fell.
  const rainVu = kind === 'lid' ? null : rainDepthUnit(meta?.unit)
  const isRain = Boolean(rainVu) || (kind !== 'system' && /^rain/i.test(v))
  const vu = kind === 'lid' ? null : rainVu ?? flowVolumeUnit(meta?.unit) ?? (/flow|inflow|runoff/i.test(v) ? flowVolumeUnit(project.data?.flow_units) : null)
  const stepSec = times.length > 1 ? (Date.parse(times[1]!) - Date.parse(times[0]!)) / 1000 : NaN
  const timeAt = (x: number) => times[Math.max(0, Math.min(times.length - 1, Math.round(x)))] ?? ''

  return (
    <GraphCard
      title={kind === 'system' ? `System${systemUnit ? ` · ${systemUnit}` : ''}` : KIND_TITLE[kind]}
      tools={hasResults && full ? <><ZoomControls zoomed={zoom.zoomed} zoomBy={zoom.zoomBy} reset={zoom.reset} /><StatsToggle /></> : null}
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
          ? () => {
              const cols = other ? shown.flatMap((id) => [id, cmpKey(id)]) : shown
              const head = (c: string) => (c.endsWith('\u0000cmp') ? nameB(c.slice(0, -4)) : nameA(c))
              downloadCsv(`${kind}_${v}`, ['time', ...cols.map((c) => `${head(c)} ${meta?.label ?? v}${unit}`)], data.map((r) => [r.t as string, ...cols.map((c) => r[c] as number | null)]))
            }
          : undefined
      }
    >
      <Chips ids={shown} onRemove={onRemove} labelOf={labelOf} />
      {ids.length > MAX_PER_GRAPH && (
        <p className="m-0 mb-2 text-[11px] text-muted">Showing the first {MAX_PER_GRAPH} of {ids.length} ticked; untick some to see the rest.</p>
      )}
      {kind === 'lid' && cmpTarget && lid?.other && !lid.other.length && (
        <p className="m-0 mb-2 text-[11px] text-muted">{cmpTarget.label} has no LID units to compare.</p>
      )}
      {!hasResults ? (
        <p className="m-0 py-8 text-center text-xs text-muted">Run the model to see results here.</p>
      ) : (
        <>
          <div ref={plotRef} onDoubleClick={zoom.reset} className="graph-plot select-none">
          <ResponsiveContainer width="100%" height={showStats ? Math.max(180, height - 40 - 26 * shown.length) : height}>
            <ComposedChart data={data} margin={{ top: 6, right: 16, bottom: 4, left: 4 }} {...zoom.handlers}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="i" type="number" domain={zoom.view ?? ['dataMin', 'dataMax']} allowDataOverflow tickFormatter={(x) => shortTime(timeAt(Number(x)))} tick={axisTick} minTickGap={48} />
              <YAxis
                tick={axisTick}
                width={56}
                tickFormatter={fmt}
                allowDataOverflow
                domain={zoom.zoomed ? (fitY([...results, ...(other ? otherResults : [])].map((r) => ({ xs: (r.data?.values ?? []).map((_, k) => k), ys: r.data?.values ?? [] })), zoom.view) ?? ['auto', 'auto']) : ['auto', 'auto']}
                label={{ value: `${meta?.label ?? v}${unit}`, angle: -90, position: 'insideLeft', offset: 8, fontSize: 10, fill: 'var(--color-muted)' }} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(x) => shortTime(timeAt(Number(x)))} formatter={(val) => fmt(Number(val))} />
              {(shown.length > 1 || other) && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {shown.map((id, i) =>
                isRain ? (
                  // Each reported value is the rain over the step that ends at it.
                  <Area key={id} name={nameA(id)} type="stepBefore" dataKey={id} stroke={COLORS[i % COLORS.length]} strokeWidth={1.2} fill={COLORS[i % COLORS.length]} fillOpacity={other ? 0.35 : 0.55} dot={false} isAnimationActive={false} connectNulls />
                ) : (
                  <Line key={id} name={nameA(id)} type="monotone" dataKey={id} stroke={COLORS[i % COLORS.length]} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
                ),
              )}
              {other &&
                shown.map((id, i) => (
                  <Line
                    key={cmpKey(id)}
                    name={nameB(id)}
                    type={isRain ? 'stepBefore' : 'monotone'}
                    dataKey={cmpKey(id)}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={1.6}
                    strokeDasharray="5 4"
                    strokeOpacity={0.85}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              {zoom.drag && <ReferenceArea x1={zoom.drag.a} x2={zoom.drag.b} fill="var(--color-accent)" fillOpacity={0.12} strokeOpacity={0} />}
            </ComposedChart>
          </ResponsiveContainer>
          </div>
          {showStats && zoom.view && (
            <StatsTable
              unit={meta?.unit ?? ''}
              volumeUnit={vu?.unit ?? null}
              volumeLabel={rainVu ? 'Depth' : undefined}
              window={`${shortTime(timeAt(zoom.view[0]))} – ${shortTime(timeAt(zoom.view[1]))}`}
              rows={shown.flatMap((id, j) => {
                const row = (ys: (number | null)[], label: string) => {
                  const st = seriesStats(ys.map((_, k) => k), ys, zoom.view![0], zoom.view![1], vu && Number.isFinite(stepSec) ? stepSec * vu.perSecond : null, rainVu ? 'before' : false)
                  return { id: label, color: COLORS[j % COLORS.length], st, at: st ? shortTime(timeAt(st.peakX)) : '' }
                }
                const a = row(results[j]?.data?.values ?? [], nameA(id))
                return other ? [a, row(otherResults[j]?.data?.values ?? [], nameB(id))] : [a]
              })}
            />
          )}
          {failed.length > 0 && <p className="m-0 mt-1 text-[11px] text-danger">No {meta?.label?.toLowerCase() ?? v} results for {failed.join(', ')}.</p>}
        </>
      )}
    </GraphCard>
  )
}

function InputGraph({
  title,
  names,
  series,
  onRemove,
  height,
  flow = false,
  rain,
}: {
  /** Series rain gages read, with their format: drawn as bars, summed to a depth. */
  rain?: Map<string, string>
  title: string
  /** Values are flows (volume makes sense). */
  flow?: boolean
  names: string[]
  series: ReturnType<typeof parseTimeseries>
  onRemove: (n: string) => void
  height: number
}) {
  const shown = names.slice(0, MAX_PER_GRAPH)
  const picked = shown.map((n) => series.find((s) => s.name === n)).filter((s): s is NonNullable<typeof s> => Boolean(s))
  const files = picked.filter((s) => s.file)
  const drawn = picked.filter((s) => !s.file)
  let lo = Infinity, hi = -Infinity
  for (const sr of drawn) for (const h of sr.hours) {
    if (h < lo) lo = h
    if (h > hi) hi = h
  }
  const full: XRange | null = hi > lo ? [lo, hi] : null
  const plotRef = useRef<HTMLDivElement>(null)
  const zoom = useChartZoom(full, plotRef)
  useWheelZoom(plotRef, zoom.view, zoom.zoomBy)
  const [showStats] = useShowStats()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const rainOf = (name: string) => rain?.get(name) ?? [...(rain ?? [])].find(([k]) => k.toUpperCase() === name.toUpperCase())?.[1]
  // Intensity series sum to a depth over time; volume series are depths already.
  const allRain = drawn.length > 0 && drawn.every((d) => rainOf(d.name))
  const vu = flow ? flowVolumeUnit(project.data?.flow_units) : allRain ? { unit: us ? 'in' : 'mm', perSecond: 1 / 3600 } : null
  return (
    <GraphCard
      title={title}
      tools={full ? <><ZoomControls zoomed={zoom.zoomed} zoomBy={zoom.zoomBy} reset={zoom.reset} /><StatsToggle /></> : null}
      onExport={
        drawn.length
          ? () =>
              downloadCsv(
                title.replace(/[^A-Za-z]+/g, '_').toLowerCase(),
                ['series', 'hours', 'value'],
                drawn.flatMap((s) => s.hours.map((h, i) => [s.name, Number(h.toFixed(4)), s.values[i]])),
              )
          : undefined
      }
    >
      <Chips ids={shown} onRemove={onRemove} />
      {drawn.length > 0 && (
        <div ref={plotRef} onDoubleClick={zoom.reset} className="graph-plot select-none">
        <ResponsiveContainer width="100%" height={showStats ? Math.max(180, height - 40 - 26 * drawn.length) : height}>
          <ComposedChart margin={{ top: 6, right: 16, bottom: 4, left: 4 }} {...zoom.handlers}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="x" type="number" domain={zoom.view ?? ['dataMin', 'dataMax']} allowDataOverflow tickFormatter={hhmm} tick={axisTick} allowDuplicatedCategory={false} />
            <YAxis tick={axisTick} width={56} tickFormatter={fmt} allowDataOverflow domain={zoom.zoomed ? (fitY(drawn.map((sr) => ({ xs: sr.hours, ys: sr.values })), zoom.view) ?? ['auto', 'auto']) : ['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(h) => hhmm(Number(h))} formatter={(val) => fmt(Number(val))} />
            {drawn.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {drawn.map((s) =>
              rainOf(s.name) ? (
                <Area
                  key={s.name}
                  name={s.name}
                  data={s.hours.map((h, i) => ({ x: h, y: s.values[i] }))}
                  dataKey="y"
                  type="stepAfter"
                  stroke={COLORS[shown.indexOf(s.name) % COLORS.length]}
                  fill={COLORS[shown.indexOf(s.name) % COLORS.length]}
                  fillOpacity={0.5}
                  strokeWidth={1.2}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
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
              ),
            )}
            {zoom.drag && <ReferenceArea x1={zoom.drag.a} x2={zoom.drag.b} fill="var(--color-accent)" fillOpacity={0.12} strokeOpacity={0} />}
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      )}
      {showStats && zoom.view && drawn.length > 0 && (
        <StatsTable
          unit={flow ? (project.data?.flow_units ?? '') : ''}
          volumeUnit={vu?.unit ?? null}
          volumeLabel={allRain ? 'Depth' : undefined}
          window={`${hhmm(zoom.view[0])} – ${hhmm(zoom.view[1])}`}
          rows={drawn.map((sr) => {
            const fmtRain = rainOf(sr.name)
            // Volume-format rain is a depth per interval already: the depth is their sum, not intensity × time.
            const st = seriesStats(sr.hours, sr.values, zoom.view![0], zoom.view![1], vu && (!allRain || fmtRain === 'INTENSITY') ? 3600 * vu.perSecond : null, true)
            if (st && allRain && fmtRain === 'VOLUME') st.volume = sr.values.filter((_, i) => sr.hours[i]! >= zoom.view![0] && sr.hours[i]! <= zoom.view![1]).reduce((a, b) => a + b, 0)
            if (st && allRain && fmtRain === 'CUMULATIVE') st.volume = null
            return { id: sr.name, color: COLORS[shown.indexOf(sr.name) % COLORS.length], st, at: st ? hhmm(st.peakX) : '' }
          })}
        />
      )}
      {files.map((s) => (
        <p key={s.name} className="m-0 mt-1 text-[11px] text-muted">
          {s.name} reads its values from <span className="font-mono">{s.file}</span>, which isn’t drawn here.
        </p>
      ))}
    </GraphCard>
  )
}

function StatsTable({
  rows,
  unit,
  volumeUnit,
  volumeLabel = 'Volume',
  window,
}: {
  rows: { id: string; color: string; st: ReturnType<typeof seriesStats>; at: string }[]
  unit: string
  volumeUnit: string | null
  /** "Depth" for rainfall (intensity × time). */
  volumeLabel?: string
  window: string
}) {
  const u = unit ? ` ${unit}` : ''
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[11.5px] tabular-nums">
        <thead>
          <tr className="border-b border-border bg-fg/[0.02] text-left text-[11px] text-muted">
            <th className="px-2 py-1.5 font-medium">
              Shown <span className="font-normal">· {window}</span>
            </th>
            <th className="px-2 py-1.5 text-right font-medium">Peak</th>
            <th className="px-2 py-1.5 text-right font-medium">At</th>
            <th className="px-2 py-1.5 text-right font-medium">Min</th>
            <th className="px-2 py-1.5 text-right font-medium">Mean</th>
            {volumeUnit && <th className="px-2 py-1.5 text-right font-medium" title={volumeLabel === 'Depth' ? 'Total rain that fell in the window shown: intensity × time' : undefined}>{volumeLabel === 'Depth' ? 'Total depth' : volumeLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ id, color, st, at }) => (
            <tr key={id} className="border-b border-border last:border-0">
              <td className="px-2 py-1">
                <span className="inline-flex items-center gap-1.5 font-mono text-fg">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {id}
                </span>
              </td>
              {st ? (
                <>
                  <td className="px-2 py-1 text-right text-fg">{fmt(st.peak)}{u}</td>
                  <td className="px-2 py-1 text-right text-fg-soft">{at}</td>
                  <td className="px-2 py-1 text-right text-fg-soft">{fmt(st.min)}</td>
                  <td className="px-2 py-1 text-right text-fg-soft">{fmt(st.mean)}</td>
                  {volumeUnit && <td className="px-2 py-1 text-right text-fg">{st.volume == null ? '—' : `${fmt(st.volume)} ${volumeUnit}`}</td>}
                </>
              ) : (
                <td colSpan={volumeUnit ? 5 : 4} className="px-2 py-1 text-right text-muted">
                  No values in this window
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
