/**
 * Series & curves: the model's shared data in one place. Time series, curves,
 * time patterns, dry-weather flow and RDII unit hydrographs, each with what uses
 * it, renaming that follows every use, and importing from files or spreadsheets.
 * Edits are drafts until Save, which writes only the sections that changed.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, CalendarClock, Droplets, Save, Spline, Undo2, Waves } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { ManualLink } from '../components/ManualLink'
import { CurvesTab } from '../components/series/CurvesTab'
import { DwfTab } from '../components/series/DwfTab'
import { PatternsTab } from '../components/series/PatternsTab'
import { TimeSeriesTab } from '../components/series/TimeSeriesTab'
import { UnitHydrographsTab } from '../components/series/UnitHydrographsTab'
import { Button, PageHeader, useToast } from '../components/ui'
import { cn } from '../lib/cn'
import { MANUAL } from '../lib/manual'
import {
  REF_SECTIONS,
  allReferenced,
  parseCurveList,
  parseDwfRows,
  parseHydrographs,
  parsePatternList,
  parseRdiiRows,
  parseTimeSeries,
  renameRefs,
  serializeCurves,
  serializeDwf,
  serializeHydrographs,
  serializePatterns,
  serializeRdii,
  serializeTimeSeries,
  type Curve,
  type DwfRow,
  type RdiiRow,
  type RefKind,
  type Row,
  type Sections,
  type TimePattern,
  type TimeSeries,
  type UnitHydrograph,
} from '../lib/seriesData'

const OWN = ['TIMESERIES', 'CURVES', 'PATTERNS', 'DWF', 'HYDROGRAPHS', 'RDII'] as const
const OTHER = ['RAINGAGES', 'JUNCTIONS', 'OUTFALLS', 'STORAGE', 'DIVIDERS', 'POLLUTANTS']
const ALL = [...new Set([...OWN, ...OTHER, ...Object.values(REF_SECTIONS).flat()])]

type Draft = {
  series: TimeSeries[]
  curves: Curve[]
  patterns: TimePattern[]
  dwf: DwfRow[]
  uhs: UnitHydrograph[]
  rdii: RdiiRow[]
  /** Other sections changed by renames. */
  refs: Sections
}

type TabId = 'series' | 'curves' | 'patterns' | 'dwf' | 'rdii'
const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'series', label: 'Time series', icon: <Activity className="h-3.5 w-3.5 text-ic-rain" /> },
  { id: 'curves', label: 'Curves', icon: <Spline className="h-3.5 w-3.5 text-ic-data" /> },
  { id: 'patterns', label: 'Time patterns', icon: <CalendarClock className="h-3.5 w-3.5 text-ic-scen" /> },
  { id: 'dwf', label: 'Dry-weather flow', icon: <Droplets className="h-3.5 w-3.5 text-ic-water" /> },
  { id: 'rdii', label: 'Unit hydrographs (RDII)', icon: <Waves className="h-3.5 w-3.5 text-ic-land" /> },
]

const firstCol = (rows: Row[] | undefined) => [...new Set((rows ?? []).map((r) => (r.values[0] ?? '').replace(/^"|"$/g, '')).filter(Boolean))]

export function SeriesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'series') as TabId
  const setTab = (t: TabId) => setParams((p) => (p.set('tab', t), p), { replace: true })
  const results = useQueries({ queries: ALL.map((s) => ({ queryKey: ['section', s], queryFn: () => api.getSection(s).catch(() => null), retry: false })) })
  const loading = results.some((r) => r.isLoading)
  const base: Sections = useMemo(() => Object.fromEntries(ALL.map((s, i) => [s, (results[i]?.data?.rows as Row[] | undefined) ?? []])), [results.map((r) => r.dataUpdatedAt).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const flow = String(project.data?.flow_units ?? 'CFS').toUpperCase()
  const us = ['CFS', 'GPM', 'MGD'].includes(flow)

  const fresh = (): Draft => ({
    series: parseTimeSeries(base.TIMESERIES ?? []),
    curves: parseCurveList(base.CURVES ?? []),
    patterns: parsePatternList(base.PATTERNS ?? []),
    dwf: parseDwfRows(base.DWF ?? []),
    uhs: parseHydrographs(base.HYDROGRAPHS ?? []),
    rdii: parseRdiiRows(base.RDII ?? []),
    refs: {},
  })
  const [draft, setDraft] = useState<Draft>(fresh)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [picks, setPicks] = useState<Record<TabId, string | null>>({ series: null, curves: null, patterns: null, dwf: null, rdii: null })
  useEffect(() => {
    if (!loading && !dirty.size) setDraft(fresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, base])

  const change = <K extends keyof Draft>(key: K, section: string, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty((s) => new Set(s).add(section))
  }

  // The model as it would be after saving, for "used by" and missing names.
  const merged: Sections = useMemo(
    () => ({
      ...base,
      ...draft.refs,
      TIMESERIES: serializeTimeSeries(draft.series),
      CURVES: serializeCurves(draft.curves),
      PATTERNS: serializePatterns(draft.patterns),
      DWF: serializeDwf(draft.dwf),
      HYDROGRAPHS: serializeHydrographs(draft.uhs),
      RDII: serializeRdii(draft.rdii),
    }),
    [base, draft],
  )
  const missing = (kind: RefKind, have: string[]) => {
    const known = new Set(have.map((n) => n.toUpperCase()))
    return [...allReferenced(kind, merged).entries()].filter(([n]) => !known.has(n.toUpperCase())).map(([name, refs]) => ({ name, by: `${refs[0]!.what} ${refs[0]!.id}${refs.length > 1 ? ` and ${refs.length - 1} more` : ''}` }))
  }

  const rename = (kind: RefKind, from: string, to: string) => {
    setDraft((d) => {
      const next = { ...d }
      const touched = new Set<string>()
      const re = (n: string) => (n.toUpperCase() === from.toUpperCase() ? to : n)
      if (kind === 'timeseries') {
        next.series = d.series.map((s) => ({ ...s, name: re(s.name) }))
        touched.add('TIMESERIES')
      }
      if (kind === 'curve') {
        next.curves = d.curves.map((c) => ({ ...c, name: re(c.name) }))
        touched.add('CURVES')
      }
      if (kind === 'pattern') {
        next.patterns = d.patterns.map((p) => ({ ...p, name: re(p.name) }))
        next.dwf = d.dwf.map((r) => ({ ...r, patterns: r.patterns.map(re) }))
        touched.add('PATTERNS').add('DWF')
      }
      if (kind === 'hydrograph') {
        next.uhs = d.uhs.map((u) => ({ ...u, name: re(u.name) }))
        next.rdii = d.rdii.map((r) => ({ ...r, uh: re(r.uh) }))
        touched.add('HYDROGRAPHS').add('RDII')
      }
      // Everything else that uses the name, outside this page's own sections.
      const outside = Object.fromEntries(Object.entries({ ...base, ...d.refs }).filter(([k]) => !(OWN as readonly string[]).includes(k)))
      const ch = renameRefs(kind, from, to, outside)
      next.refs = { ...d.refs, ...ch }
      Object.keys(ch).forEach((k) => touched.add(k))
      setDirty((s) => new Set([...s, ...touched]))
      return next
    })
  }

  const save = useMutation({
    mutationFn: async () => {
      const rows: Record<string, Row[]> = {
        PATTERNS: serializePatterns(draft.patterns),
        TIMESERIES: serializeTimeSeries(draft.series),
        CURVES: serializeCurves(draft.curves),
        HYDROGRAPHS: serializeHydrographs(draft.uhs),
        DWF: serializeDwf(draft.dwf),
        RDII: serializeRdii(draft.rdii),
        ...(draft.refs as Record<string, Row[]>),
      }
      // Definitions first, then what uses them.
      const order = ['PATTERNS', 'TIMESERIES', 'CURVES', 'HYDROGRAPHS', 'DWF', 'RDII', ...Object.keys(draft.refs)]
      for (const s of order) if (dirty.has(s) && rows[s]) await api.putSection(s, { rows: rows[s]!.map((r) => ({ values: r.values, comment: r.comment ?? '' })) })
    },
    onSuccess: () => {
      setDirty(new Set())
      for (const k of ['section', 'network', 'inp', 'model-check', 'project']) void qc.invalidateQueries({ queryKey: [k] })
      toast({ title: 'Saved', description: 'Series, curves and flows are in the model. Run it to see their effect.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save', description: e.message, tone: 'danger' }),
  })

  const counts: Record<TabId, number> = {
    series: draft.series.length,
    curves: draft.curves.length,
    patterns: draft.patterns.length,
    dwf: draft.dwf.length,
    rdii: draft.uhs.length,
  }
  const pickFor = (t: TabId) => ({ pick: picks[t], setPick: (n: string | null) => setPicks((p) => ({ ...p, [t]: n })) })
  const nodes = useMemo(() => [...firstCol(base.JUNCTIONS), ...firstCol(base.OUTFALLS), ...firstCol(base.STORAGE), ...firstCol(base.DIVIDERS)], [base])

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pt-5 max-md:px-3">
      <PageHeader
        title="Series & curves"
        description="The data the model shares between elements: values over time, curves, the patterns that shape dry-weather flow, and the unit hydrographs that add rainfall-derived infiltration and inflow."
        actions={
          <>
            <ManualLink href={MANUAL.inputFormat}>Input sections in the manual</ManualLink>
            {dirty.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(fresh())
                  setDirty(new Set())
                }}
              >
                <Undo2 className="h-3.5 w-3.5" /> Discard
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={!dirty.size || save.isPending} onClick={() => save.mutate()}>
              <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : dirty.size ? 'Save' : 'Saved'}
            </Button>
          </>
        }
      />
      <div className="flex gap-1 overflow-x-auto border-b border-border scrollbar-none" role="tablist" aria-label="Kind of data">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[13px]',
              tab === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-soft hover:text-fg',
            )}
          >
            {t.icon}
            {t.label}
            <span className="text-[11px] tabular-nums text-muted">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 mt-3 flex min-h-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-border bg-elevated">
        {loading ? (
          <p className="m-auto text-[13px] text-muted">Reading the model…</p>
        ) : tab === 'series' ? (
          <TimeSeriesTab list={draft.series} setList={(l) => change('series', 'TIMESERIES', l)} secs={merged} missing={missing('timeseries', draft.series.map((s) => s.name))} onRename={(a, b) => rename('timeseries', a, b)} {...pickFor('series')} />
        ) : tab === 'curves' ? (
          <CurvesTab list={draft.curves} setList={(l) => change('curves', 'CURVES', l)} secs={merged} missing={missing('curve', draft.curves.map((c) => c.name))} onRename={(a, b) => rename('curve', a, b)} us={us} flow={flow} {...pickFor('curves')} />
        ) : tab === 'patterns' ? (
          <PatternsTab list={draft.patterns} setList={(l) => change('patterns', 'PATTERNS', l)} secs={merged} missing={missing('pattern', draft.patterns.map((p) => p.name))} onRename={(a, b) => rename('pattern', a, b)} {...pickFor('patterns')} />
        ) : tab === 'dwf' ? (
          <DwfTab rows={draft.dwf} setRows={(r) => change('dwf', 'DWF', r)} patterns={draft.patterns} nodes={nodes} pollutants={firstCol(base.POLLUTANTS)} flow={flow} us={us} onOpenPatterns={() => setTab('patterns')} />
        ) : (
          <UnitHydrographsTab
            list={draft.uhs}
            setList={(l) => change('uhs', 'HYDROGRAPHS', l)}
            rdii={draft.rdii}
            setRdii={(r) => change('rdii', 'RDII', r)}
            secs={merged}
            missing={missing('hydrograph', draft.uhs.map((u) => u.name))}
            onRename={(a, b) => rename('hydrograph', a, b)}
            gages={firstCol(base.RAINGAGES)}
            nodes={nodes}
            us={us}
            {...pickFor('rdii')}
          />
        )}
      </div>
    </div>
  )
}
