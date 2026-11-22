/**
 * Every completed run is kept (per engine and scenario). Pick two to see the
 * headline differences, the objects that changed most, and overlaid series,
 * optionally against observed data from a CSV.
 */

import { formatVolume } from '../../lib/units'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Pin, PinOff, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, ENGINE_LABELS, type ArchivedRun, type TimeSeriesResponse } from '../../api/client'
import { downloadText, safeName, seriesCsv, toCsv } from '../../lib/exportFiles'
import { focusOnMap } from '../../lib/mapFocus'
import { Button, Panel, useToast } from '../ui'
import { IS_VIEWER } from '../../lib/mode'

const SUMMARY_LABEL: Record<string, string> = {
  flooded_nodes: 'Flooded nodes',
  flood_volume: 'Flood volume',
  surcharged_nodes: 'Surcharged nodes',
  surcharged_conduits: 'Surcharged conduits',
  runoff_continuity_pct: 'Runoff continuity error (%)',
  routing_continuity_pct: 'Routing continuity error (%)',
}
const VARS: Record<'node' | 'link' | 'subcatchment', [string, string][]> = {
  node: [['depth', 'Depth'], ['head', 'Head'], ['overflow', 'Flooding'], ['total_inflow', 'Total inflow']],
  link: [['flow', 'Flow'], ['depth', 'Depth'], ['velocity', 'Velocity'], ['capacity', 'Capacity']],
  subcatchment: [['runoff', 'Runoff'], ['rainfall', 'Rainfall']],
}
const COLORS = ['#7cc4fa', '#f6ad55', '#9ae6b4']

const fmt = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)

export function runLabel(r: ArchivedRun) {
  const when = new Date(r.finished).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${r.label || r.scenario_name} · ${ENGINE_LABELS[r.engine] ?? r.engine} · ${when}`
}

function Delta({ d, worseWhenUp = true }: { d: number | null; worseWhenUp?: boolean }) {
  if (d == null || Math.abs(d) < 1e-9) return <span className="text-muted">0</span>
  const up = d > 0
  const bad = worseWhenUp ? up : !up
  return <span className={bad ? 'text-rose-300' : 'text-emerald-300'}>{`${up ? '+' : ''}${fmt(d)}`}</span>
}

function parseObserved(text: string, t0: string | undefined): { h: number; v: number }[] {
  const start = t0 ? Date.parse(t0.replace(' ', 'T')) : NaN
  const out: { h: number; v: number }[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/[,;\t]/).map((s) => s.trim())
    if (parts.length < 2) continue
    const v = Number(parts[parts.length - 1])
    if (!Number.isFinite(v)) continue
    const raw = parts.length > 2 ? `${parts[0]} ${parts[1]}` : parts[0]
    let h = Number(raw)
    if (!Number.isFinite(h)) {
      const t = Date.parse(raw.replace(' ', 'T'))
      if (!Number.isFinite(t) || !Number.isFinite(start)) continue
      h = (t - start) / 3_600_000
    }
    out.push({ h, v })
  }
  return out
}

export function CompareRuns() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const runs = useQuery({ queryKey: ['runs-archive'], queryFn: api.listRuns })
  const list = runs.data?.runs ?? []
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  useEffect(() => {
    if (list.length >= 2 && (!a || !list.some((r) => r.id === a))) setA(list[1].id)
    if (list.length >= 1 && (!b || !list.some((r) => r.id === b))) setB(list[0].id)
  }, [list, a, b])

  const cmp = useQuery({
    queryKey: ['runs-compare', a, b],
    queryFn: () => api.compareRuns(a, b),
    enabled: Boolean(a && b && a !== b),
  })

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { label?: string; pinned?: boolean } }) => api.updateRun(id, body),
    onSuccess: (d) => qc.setQueryData(['runs-archive'], d),
  })
  const del = useMutation({
    mutationFn: api.deleteRun,
    onSuccess: (d) => qc.setQueryData(['runs-archive'], d),
    onError: (e: Error) => toast({ title: 'Couldn’t delete run', description: e.message, tone: 'danger' }),
  })

  // series overlay
  const [kind, setKind] = useState<'node' | 'link' | 'subcatchment'>('node')
  const [oid, setOid] = useState('')
  const [variable, setVariable] = useState('depth')
  const [observed, setObserved] = useState<{ name: string; pts: { h: number; v: number }[] } | null>(null)
  useEffect(() => setVariable(VARS[kind][0][0]), [kind])
  const sa = useQuery({
    queryKey: ['run-series', a, kind, oid, variable],
    queryFn: () => api.runSeries(a, kind, oid, variable),
    enabled: Boolean(a && oid),
    retry: false,
  })
  const sb = useQuery({
    queryKey: ['run-series', b, kind, oid, variable],
    queryFn: () => api.runSeries(b, kind, oid, variable),
    enabled: Boolean(b && oid),
    retry: false,
  })
  const nameOf = (id: string) => {
    const r = list.find((x) => x.id === id)
    return r ? r.label || `${r.scenario_name} (${ENGINE_LABELS[r.engine] ?? r.engine})` : id
  }
  const chart = useMemo(() => {
    const rows = new Map<number, Record<string, number>>()
    const add = (key: string, s: TimeSeriesResponse | undefined) =>
      s?.values.forEach((v, i) => {
        const h = Number((s.times_sec[i] / 3600).toFixed(4))
        rows.set(h, { ...(rows.get(h) ?? { h }), [key]: v })
      })
    add('A', sa.data)
    add('B', sb.data)
    observed?.pts.forEach(({ h, v }) => rows.set(Number(h.toFixed(4)), { ...(rows.get(Number(h.toFixed(4))) ?? { h }), Observed: v }))
    return [...rows.values()].sort((x, y) => x.h - y.h)
  }, [sa.data, sb.data, observed])

  if (runs.isLoading) return <p className="text-sm text-muted">Loading runs…</p>
  if (list.length === 0)
    return (
      <Panel>
        <p className="m-0 text-sm text-muted">
          {IS_VIEWER
            ? 'Add the .rpt and .out from two runs on the start page (Add files) to compare them here.'
            : 'Every run you complete is kept here, per engine and scenario. Run the model, change something (or switch scenario or engine), run again, and compare the two.'}
        </p>
      </Panel>
    )

  const select = (value: string, set: (v: string) => void, label: string) => (
    <label className="block min-w-0 flex-1 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => set(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
      >
        <option value="current">Current results</option>
        {list.map((r) => (
          <option key={r.id} value={r.id}>
            {runLabel(r)}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="min-h-0 space-y-4 overflow-auto pb-6">
      <Panel title="Saved runs">
        <ul className="m-0 list-none space-y-1 p-0">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-fg/5">
              <input
                defaultValue={r.label}
                placeholder={r.scenario_name}
                aria-label="Run name"
                onBlur={(e) => e.target.value !== r.label && patch.mutate({ id: r.id, body: { label: e.target.value } })}
                className="h-7 w-44 rounded border border-transparent bg-transparent px-1.5 text-fg hover:border-border focus:border-accent focus:outline-none"
              />
              <span className="text-muted">{ENGINE_LABELS[r.engine] ?? r.engine}</span>
              <span className="text-muted">{new Date(r.finished).toLocaleString()}</span>
              <span className="ml-auto tabular-nums text-muted">
                {r.summary.flooded_nodes ?? 0} flooded · {formatVolume(r.summary.flood_volume as number, String(r.summary.flood_volume_units ?? ''), { nonZero: Boolean(r.summary.flooded_nodes) })}
              </span>
              {!IS_VIEWER && <button
                type="button"
                title={r.pinned ? 'Unpin (may be removed when older than the newest runs)' : 'Pin: keep this run'}
                aria-label={r.pinned ? 'Unpin run' : 'Pin run'}
                onClick={() => patch.mutate({ id: r.id, body: { pinned: !r.pinned } })}
                className={`rounded p-1 hover:bg-fg/10 ${r.pinned ? 'text-accent-soft' : 'text-muted'}`}
              >
                {r.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
              </button>}
              <button
                type="button"
                title="Delete this saved run"
                aria-label="Delete run"
                onClick={() => del.mutate(r.id)}
                className="rounded p-1 text-muted hover:bg-fg/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <p className="mb-0 mt-2 text-[11px] text-muted">
          {IS_VIEWER
            ? 'Each set of results you add on the start page is listed here. They stay in this browser until you remove them.'
            : `The newest ${runs.data?.keep_unpinned} unpinned runs are kept in the project’s runs folder. Pin a run to keep it.`}
        </p>
      </Panel>

      <Panel title="Compare">
        <div className="flex flex-wrap gap-3">
          {select(a, setA, 'Run A (before)')}
          {select(b, setB, 'Run B (after)')}
        </div>
        {a === b && <p className="mt-3 text-xs text-muted">Pick two different runs.</p>}
        {cmp.isError && <p className="mt-3 text-xs text-danger">{(cmp.error as Error).message}</p>}
        {cmp.data && (
          <>
            <table className="mt-4 w-full max-w-xl text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-medium" />
                  <th className="py-1 text-right font-medium">A</th>
                  <th className="py-1 text-right font-medium">B</th>
                  <th className="py-1 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {cmp.data.summary.map((s) => (
                  <tr key={s.key} className="border-t border-border/50">
                    <td className="py-1.5 text-fg-soft">
                      {SUMMARY_LABEL[s.key] ?? s.key}
                      {s.key === 'flood_volume' && cmp.data.flood_volume_units ? ` (${cmp.data.flood_volume_units})` : ''}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.a)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.b)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      <Delta d={s.key.includes('continuity') && s.a != null && s.b != null ? Math.abs(s.b) - Math.abs(s.a) : s.delta} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>

      {cmp.data?.tables.map((t) => (
        <Panel
          key={t.title}
          title={`${t.title}: biggest changes`}
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                downloadText(
                  `${safeName(t.title)}_compare.csv`,
                  toCsv(
                    ['ID', ...t.columns.flatMap((c, i) => [`${c} A${t.units[i] ? ` (${t.units[i]})` : ''}`, `${c} B`, `${c} change`])],
                    t.rows.map((r) => [r.id, ...r.values.flatMap((v) => [v.a, v.b, v.delta])]),
                  ),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          }
        >
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-elevated">
                <tr className="text-left text-muted">
                  <th className="py-1 pr-3 font-medium">ID</th>
                  {t.columns.map((c, i) => (
                    <th key={c} colSpan={3} className="py-1 pr-3 text-right font-medium">
                      {c}
                      {t.units[i] ? ` (${t.units[i]})` : ''} A → B
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.slice(0, 50).map((r) => (
                  <tr key={r.id} className="border-t border-border/50">
                    <td className="py-1 pr-3">
                      <button
                        type="button"
                        className="font-mono text-accent-soft hover:underline"
                        onClick={() => {
                          setKind(t.object)
                          setOid(r.id)
                        }}
                        onDoubleClick={() => {
                          focusOnMap({ object_type: t.object, id: r.id })
                          navigate('/map')
                        }}
                        title="Click to chart · double-click to show on the map"
                      >
                        {r.id}
                      </button>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} colSpan={3} className="py-1 pr-3 text-right tabular-nums">
                        {fmt(v.a)} → {fmt(v.b)} <span className="ml-1"><Delta d={v.delta} /></span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.total > 50 && <p className="mb-0 mt-2 text-[11px] text-muted">Top 50 of {t.total}. Download the CSV for all.</p>}
        </Panel>
      ))}

      <Panel title="Overlay series">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Object
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="mt-1 block h-8 rounded-lg border border-border bg-surface px-2 text-sm text-fg">
              <option value="node">Node</option>
              <option value="link">Link</option>
              <option value="subcatchment">Subcatchment</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            ID
            <input value={oid} onChange={(e) => setOid(e.target.value.trim())} placeholder="e.g. J1" className="mt-1 block h-8 w-32 rounded-lg border border-border bg-surface px-2 font-mono text-sm text-fg" />
          </label>
          <label className="text-xs text-muted">
            Variable
            <select value={variable} onChange={(e) => setVariable(e.target.value)} className="mt-1 block h-8 rounded-lg border border-border bg-surface px-2 text-sm text-fg">
              {VARS[kind].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-fg-soft hover:bg-fg/5">
            <Upload className="h-3.5 w-3.5" /> Observed CSV
            <input
              type="file"
              accept=".csv,.txt,.dat"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const pts = parseObserved(await f.text(), sa.data?.times?.[0] ?? sb.data?.times?.[0])
                if (!pts.length) toast({ title: 'No readable rows', description: 'Use two columns: time (hours or date/time) and value.', tone: 'danger' })
                else setObserved({ name: f.name, pts })
                e.target.value = ''
              }}
            />
          </label>
          {observed && (
            <Button size="sm" variant="ghost" onClick={() => setObserved(null)}>
              Remove {observed.name}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!sa.data && !sb.data}
            onClick={() =>
              downloadText(
                `${safeName(oid)}_${variable}_compare.csv`,
                seriesCsv([
                  ...(sa.data ? [{ name: `A ${nameOf(a)}`, s: sa.data }] : []),
                  ...(sb.data ? [{ name: `B ${nameOf(b)}`, s: sb.data }] : []),
                ]),
              )
            }
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
        {!oid ? (
          <p className="mt-3 text-xs text-muted">Pick an ID, or click one in the tables above.</p>
        ) : sa.isError && sb.isError ? (
          <p className="mt-3 text-xs text-danger">{(sa.error as Error).message}</p>
        ) : (
          <div className="mt-3 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                <XAxis dataKey="h" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11 }} unit=" h" />
                <YAxis tick={{ fontSize: 11 }} width={56} unit={sa.data?.unit || sb.data?.unit ? ` ${sa.data?.unit ?? sb.data?.unit}` : ''} />
                <Tooltip contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="A" name={`A: ${nameOf(a)}`} stroke={COLORS[0]} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                <Line dataKey="B" name={`B: ${nameOf(b)}`} stroke={COLORS[1]} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                {observed && <Line dataKey="Observed" name={`Observed (${observed.name})`} stroke={COLORS[2]} dot={{ r: 2 }} strokeWidth={0} connectNulls={false} isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    </div>
  )
}
