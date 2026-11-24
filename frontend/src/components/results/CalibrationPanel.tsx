/** Compare a modelled series with measured data: overlay, NSE, peak, timing and volume errors. */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Upload } from 'lucide-react'
import { api, type ModelNetwork } from '../../api/client'
import { useObjectSeries, type SeriesKind } from '../../hooks/useObjectSeries'
import { fitStats, parseObserved, sampleAt, type Point } from '../../lib/calibration'
import { Button, Panel, useToast } from '../ui'

const isoMs = (s: string) => {
  const m = s.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?/)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) : NaN
}
const fileName = (kind: string, id: string, variable: string) => `observed_${kind}_${id}_${variable}.csv`.replace(/[^A-Za-z0-9_.-]/g, '_')

function rating(nse: number | null) {
  if (nse == null) return { text: '—', tone: 'text-muted' }
  if (nse >= 0.75) return { text: 'very good', tone: 'text-success' }
  if (nse >= 0.65) return { text: 'good', tone: 'text-success' }
  if (nse >= 0.5) return { text: 'satisfactory', tone: 'text-warning' }
  return { text: 'unsatisfactory', tone: 'text-danger' }
}

export function CalibrationPanel() {
  const { toast } = useToast()
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const [kind, setKind] = useState<SeriesKind>('link')
  const ids = useMemo(
    () => (network.data?.geojson.features ?? []).filter((f) => f.properties?.object_type === kind).map((f) => String(f.properties?.id)),
    [network.data, kind],
  )
  const [id, setId] = useState('')
  const elementId = ids.includes(id) ? id : (ids[0] ?? '')
  const s = useObjectSeries(kind, elementId || null)
  const [text, setText] = useState('')
  const modelled: Point[] = useMemo(() => {
    const d = s.series.data
    if (!d) return []
    return d.values.map((v, i) => ({ t: d.times?.[i] ? isoMs(d.times[i]) : d.times_sec[i] * 1000, v }))
  }, [s.series.data])
  const t0 = modelled[0]?.t ?? 0
  const { points: observed, skipped } = useMemo(() => parseObserved(text, t0 - (s.series.data?.report_step_sec ?? 0) * 1000), [text, t0, s.series.data])
  const fit = useMemo(() => (observed.length && modelled.length ? fitStats(observed, modelled) : null), [observed, modelled])
  const file = fileName(kind, elementId, s.variable)

  // Load measured data saved with the project for this element.
  useEffect(() => {
    if (!elementId) return
    let cancelled = false
    api
      .readProjectFile(file, { optional: true })
      .then((r) => !cancelled && setText(r.content))
      .catch(() => !cancelled && setText(''))
    return () => {
      cancelled = true
    }
  }, [file, elementId])

  const chart = useMemo(() => {
    const rows = new Map<number, { h: number; modelled?: number; observed?: number }>()
    for (const p of modelled) rows.set(p.t, { h: (p.t - t0) / 3_600_000, modelled: p.v })
    for (const p of observed) {
      const r = rows.get(p.t) ?? { h: (p.t - t0) / 3_600_000 }
      r.observed = p.v
      if (r.modelled == null) {
        const m = sampleAt(modelled, p.t)
        if (m != null) r.modelled = m
      }
      rows.set(p.t, r)
    }
    return [...rows.values()].sort((a, b) => a.h - b.h)
  }, [modelled, observed, t0])

  const unit = s.series.data?.unit ?? ''
  const r = rating(fit?.nse ?? null)
  const fmt = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Panel title="Measured data">
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[12px] font-medium text-fg-soft">
              Element type
              <select className="field mt-1" value={kind} onChange={(e) => setKind(e.target.value as SeriesKind)}>
                <option value="link">Link</option>
                <option value="node">Node</option>
                <option value="subcatchment">Subcatchment</option>
              </select>
            </label>
            <label className="block text-[12px] font-medium text-fg-soft">
              Element
              <input className="field mt-1" list="calib-ids" value={id || elementId} onChange={(e) => setId(e.target.value)} />
              <datalist id="calib-ids">
                {ids.slice(0, 2000).map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="block text-[12px] font-medium text-fg-soft">
            Variable
            <select className="field mt-1" value={s.variable} onChange={(e) => s.setVariable(e.target.value)}>
              {s.variables.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.unit ? ` (${v.unit})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-medium text-fg-soft">
            Time, value
            <textarea
              className="field mt-1 h-40 py-1.5 font-mono text-[11px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'2024-06-01 00:15, 1.2\n2024-06-01 00:30, 3.8\n… or hours from the start:\n0.25, 1.2'}
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-[12px] text-fg-soft hover:bg-fg/5">
              <Upload className="h-3.5 w-3.5" /> Load CSV
              <input
                type="file"
                accept=".csv,.txt,.dat"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void f.text().then(setText)
                  e.target.value = ''
                }}
              />
            </label>
            {(
              <Button
                size="sm"
                variant="outline"
                disabled={!text.trim()}
                onClick={() =>
                  void api
                    .writeProjectFile(file, text)
                    .then(() => toast({ title: `Saved ${file} in the project`, tone: 'success' }))
                    .catch((e: Error) => toast({ title: 'Couldn’t save', description: e.message, tone: 'danger' }))
                }
              >
                Save with project
              </Button>
            )}
          </div>
          <p className="m-0 text-[11px] text-muted">
            {observed.length} measured points{skipped ? `, ${skipped} lines skipped` : ''}. Times are read as the model’s clock; a number on its own is hours from the start.
          </p>
        </div>
      </Panel>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title={`${elementId || '—'}: modelled and measured ${s.variables.find((v) => v.id === s.variable)?.label.toLowerCase() ?? ''}`}>
          {!modelled.length ? (
            <p className="m-0 text-[13px] text-muted">No modelled series. Run the model first.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="h" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${Number(v).toFixed(1)}`} stroke="var(--color-muted)" fontSize={11} label={{ value: 'Hours from start', position: 'insideBottom', offset: -8, fill: 'var(--color-muted)', fontSize: 11 }} />
                  <YAxis stroke="var(--color-muted)" fontSize={11} width={48} label={{ value: unit, angle: -90, position: 'insideLeft', fill: 'var(--color-muted)', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 12 }} labelFormatter={(v) => `${Number(v).toFixed(2)} h`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="modelled" name="Modelled" stroke="var(--color-accent)" dot={false} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="observed" name="Measured" stroke="#f59e0b" dot={{ r: 2 }} strokeWidth={0} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel title="Goodness of fit">
          {!fit ? (
            <p className="m-0 text-[13px] text-muted">Paste or load measured values that overlap the run to see the fit.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
              {(
                [
                  ['Nash–Sutcliffe (NSE)', fmt(fit.nse, 3), r.tone, r.text],
                  ['Peak error', `${fmt(fit.peakErrPct, 1)} %`, Math.abs(fit.peakErrPct ?? 0) > 25 ? 'text-warning' : '', `${fmt(fit.peakMod)} vs ${fmt(fit.peakObs)} ${unit}`],
                  ['Peak timing', `${fit.peakShiftMin > 0 ? '+' : ''}${Math.round(fit.peakShiftMin)} min`, Math.abs(fit.peakShiftMin) > 30 ? 'text-warning' : '', fit.peakShiftMin > 0 ? 'model peaks later' : fit.peakShiftMin < 0 ? 'model peaks earlier' : 'same time'],
                  ['Volume error', `${fmt(fit.volErrPct, 1)} %`, Math.abs(fit.volErrPct ?? 0) > 20 ? 'text-warning' : '', 'over the measured period'],
                  ['RMSE', `${fmt(fit.rmse, 3)} ${unit}`, '', ''],
                  ['Mean bias', `${fmt(fit.bias, 3)} ${unit}`, '', fit.bias > 0 ? 'model high' : 'model low'],
                  ['Points compared', String(fit.n), '', ''],
                ] as [string, string, string, string][]
              ).map(([k, v, tone, note]) => (
                <div key={k}>
                  <div className="text-[11px] text-muted">{k}</div>
                  <div className={`font-semibold tabular-nums ${tone || 'text-fg'}`}>{v}</div>
                  {note && <div className="text-[11px] text-muted">{note}</div>}
                </div>
              ))}
            </div>
          )}
          <p className="mb-0 mt-3 text-[11px] text-muted">NSE: 1 is a perfect match, above 0.65 is commonly called good, below 0.5 unsatisfactory (Moriasi et al., 2007).</p>
        </Panel>
      </div>
    </div>
  )
}
