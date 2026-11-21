/**
 * The viewer's Rain gages page: every gage in the model, where its rainfall
 * comes from, and that rainfall as a hyetograph with its cumulative depth.
 * Rainfall is read from the model's [TIMESERIES], from a rain file dropped
 * with the model, or from the run's results (what the simulation used).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CloudRain, FileUp } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, PageHeader, useToast } from '../components/ui'
import { ManualLink } from '../components/ManualLink'
import { useChartZoom, useWheelZoom, ZoomControls } from '../components/results/chartZoom'
import { cn } from '../lib/cn'
import { focusOnMap } from '../lib/mapFocus'
import { MANUAL } from '../lib/manual'
import {
  baseName,
  binHyetograph,
  depthUnit,
  fromRainFile,
  fromRun,
  fromSeries,
  parseRainGages,
  parseTimeseries,
  swmmDate,
  type Hyetograph,
  type RainGage,
} from '../lib/rainGages'
import { ClimatePanel, type AdjustmentRow } from '../components/storm/ClimatePanel'
import { LocationPicker } from '../components/storm/LocationPicker'
import { applyAdjustmentsToInp } from '../lib/swmmCat'
import { ensureCrs, projectToWgs84 } from '../lib/projection'
import { addFiles, getProject, getVersion, outOf, RAIN_FILE, subscribe, ViewerFileError } from '../viewer/store'

type Source = 'input' | 'run'

const fmt = (v: number) => (v === 0 ? '0' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString())

function duration(h: number) {
  if (h <= 0) return '–'
  const m = Math.round(h * 60)
  if (m < 60) return `${m} min`
  if (h < 48) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
  if (h < 24 * 90) return `${(h / 24).toFixed(h < 24 * 10 ? 1 : 0)} days`
  return `${(h / 24 / 365.25).toFixed(1)} years`
}

/** Axis and tooltip labels: calendar time when the record has a start date. */
function timeLabel(start: Date | undefined, h: number, spanHr: number, long = false) {
  if (!start) {
    const m = Math.round(h * 60)
    const d = Math.floor(m / 1440)
    const r = m % 1440
    return `${d ? `${d}d ` : ''}${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
  }
  const t = new Date(start.getTime() + h * 3_600_000)
  const day = t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(spanHr > 24 * 300 || long ? { year: 'numeric' } : {}) })
  const clock = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (long) return `${day} ${clock}`
  return spanHr > 24 * 4 ? day : spanHr > 20 ? `${day} ${clock}` : clock
}

export default function RainGagesPage() {
  const version = useSyncExternalStore(subscribe, getVersion)
  const project = getProject()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [sourcePick, setSourcePick] = useState<Source | null>(null)
  const [view, setView] = useState<'gages' | 'climate'>('gages')
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null)

  const model = project?.model
  const flowUnits = (model?.options().FLOW_UNITS ?? 'CFS').toUpperCase()
  const startDate = swmmDate(model?.options().START_DATE, model?.options().START_TIME)
  const gages = useMemo(() => (model ? parseRainGages(model.rows('RAINGAGES')) : []), [model, version])
  const series = useMemo(() => {
    const rows = model ? model.rows('TIMESERIES').map((values) => ({ values })) : []
    return new Map(parseTimeseries(rows).map((s) => [s.name, s]))
  }, [model])
  const subsByGage = useMemo(() => {
    const m = new Map<string, { id: string; area: number }[]>()
    for (const [id, a] of model?.subcatchments ?? []) {
      const g = String(a.raingage ?? '')
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push({ id, area: Number(a.area) || 0 })
    }
    return m
  }, [model])
  const out = project ? outOf(project.results[0]) : null
  const rainFiles = project?.rainFiles

  /** The file a gage (or its FILE time series) reads, and whether it's here. */
  const fileFor = (g: RainGage) => {
    const name = g.source === 'FILE' ? g.file : g.series ? series.get(g.series)?.file : undefined
    if (!name) return null
    const have = rainFiles?.find((r) => r.name.toLowerCase() === baseName(name))
    return { name: name.split(/[\\/]/).pop()!, text: have?.text ?? null }
  }

  const input = (g: RainGage): Hyetograph | null => {
    const f = fileFor(g)
    if (f) return f.text ? fromRainFile(g, f.text) : null
    const s = g.series ? series.get(g.series) : undefined
    return s && s.values.length ? fromSeries(g, s, startDate) : null
  }

  const run = (g: RainGage): Hyetograph | null => {
    const sub = subsByGage.get(g.name)?.[0]
    if (!out || !sub) return null
    try {
      const r = out.seriesResponse('subcatchment', sub.id, 'rainfall')
      const s = new Date(out.startMs)
      // .out times have no zone: show them as the same wall-clock time here.
      const local = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds())
      return fromRun(r.values, r.report_step_sec, local)
    } catch {
      return null
    }
  }

  const all = useMemo(
    () => gages.map((g) => ({ g, input: input(g), run: run(g) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gages, series, rainFiles, out, subsByGage, version],
  )

  const addRainFile = async (files: FileList | null) => {
    if (!files?.length) return
    const list = [...files]
    const bad = list.filter((f) => !RAIN_FILE.test(f.name))
    try {
      const { added } = await addFiles(list.filter((f) => RAIN_FILE.test(f.name)))
      if (added.length) toast({ title: `Added ${added.join(', ')}`, tone: 'success' })
      if (bad.length) toast({ title: 'Skipped files', description: `${bad.map((f) => f.name).join(', ')}: rain files end in .dat, .txt, .rain, .prn or .tsf.`, tone: 'danger' })
      void qc.invalidateQueries()
    } catch (e) {
      toast({ title: 'Couldn’t read that file', description: e instanceof ViewerFileError ? e.message : (e as Error).message, tone: 'danger' })
    }
  }

  // The model's centre in lat/lon, for SWMM-CAT (needs a coordinate system).
  const modelCentre = useMemo(() => {
    if (!model || !project?.crs) return null
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of model.coordinates.values()) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1])
    }
    if (!Number.isFinite(x0)) return null
    try {
      ensureCrs(project.crs, project.proj4)
      const [lon, lat] = projectToWgs84((x0 + x1) / 2, (y0 + y1) / 2, project.crs)
      return Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) } : null
    } catch {
      return null
    }
  }, [model, project?.crs, project?.proj4])
  useEffect(() => {
    setPin(modelCentre)
  }, [modelCentre])

  const downloadAdjusted = (rows: AdjustmentRow[], summary: string) => {
    if (!project) return
    const text = applyAdjustmentsToInp(project.inpText, rows)
    const name = project.inpName.replace(/\.inp$/i, '') + '_climate.inp'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = name
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    toast({ title: `Downloaded ${name}`, description: summary, tone: 'success' })
  }

  if (!project) {
    return (
      <div className="h-full overflow-auto px-6 py-5">
        <PageHeader title="Rain gages" description="Open a model to see its rain gages." />
      </div>
    )
  }

  const current = all.find((a) => a.g.name === picked) ?? all[0]

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Rain gages"
          description="The rainfall each gage gives the model, from its time series, its rain file or the run’s results."
          actions={
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept=".dat,.txt,.rain,.prn,.tsf"
                className="hidden"
                onChange={(e) => {
                  void addRainFile(e.target.files)
                  e.target.value = ''
                }}
              />
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                <FileUp className="h-3.5 w-3.5" /> Add rain file
              </Button>
              <ManualLink href={MANUAL.inputFormat}>[RAINGAGES] in the manual</ManualLink>
            </>
          }
        />

        <div className="mb-4 inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Rain gages view">
          {(
            [
              ['gages', 'Gages'],
              ['climate', 'Climate change'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={cn('h-7 rounded-md px-3 text-[12px]', view === k ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'climate' ? (
          <ClimatePanel
            lat={pin?.lat ?? null}
            lon={pin?.lon ?? null}
            flowUnits={flowUnits}
            location={
              <>
                <LocationPicker
                  lat={pin?.lat ?? 39}
                  lon={pin?.lon ?? -98}
                  onChange={(lat, lon) => setPin({ lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) })}
                />
                {!modelCentre ? (
                  <p className="mt-2 text-[12px] text-muted">
                    {project.crs ? 'Couldn’t place this model on the map.' : 'This model has no coordinate system set, so click its location on the map.'}
                  </p>
                ) : null}
              </>
            }
            applyLabel="Download adjusted .inp"
            onApply={downloadAdjusted}
          />
        ) : !gages.length ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
            <CloudRain className="mx-auto mb-2 h-6 w-6 text-ic-rain" />
            This model has no rain gages.
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row">
            <ul className="m-0 flex list-none flex-row gap-2 overflow-x-auto p-0 lg:w-60 lg:shrink-0 lg:flex-col lg:overflow-visible" aria-label="Rain gages">
              {all.map(({ g, input: h, run: r }) => {
                const on = g === current?.g
                const shown = h ?? r
                const unit = depthUnit(g, flowUnits)
                return (
                  <li key={g.name} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(g.name)
                        setSourcePick(null)
                      }}
                      aria-current={on || undefined}
                      className={cn(
                        'w-full min-w-44 rounded-lg border px-3 py-2 text-left transition-colors',
                        on ? 'border-ic-rain/60 bg-ic-rain/10' : 'border-border hover:bg-fg/[0.04]',
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-fg">{g.name}</span>
                        {shown && (
                          <span className="shrink-0 text-[12px] tabular-nums text-fg-soft">
                            {fmt(shown.total)} {unit}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                        {g.source === 'FILE' ? `File ${fileFor(g)?.name ?? ''}` : `Series ${g.series}`} · {(subsByGage.get(g.name)?.length ?? 0)} subcatchment
                        {(subsByGage.get(g.name)?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {current && (
              <GageDetail
                key={current.g.name}
                g={current.g}
                input={current.input}
                run={current.run}
                source={sourcePick}
                onSource={setSourcePick}
                unit={depthUnit(current.g, flowUnits)}
                file={fileFor(current.g)}
                subs={subsByGage.get(current.g.name) ?? []}
                areaUnit={['CFS', 'GPM', 'MGD'].includes(flowUnits) ? 'ac' : 'ha'}
                onAddFile={() => fileInput.current?.click()}
                onShowSub={(id) => {
                  focusOnMap({ object_type: 'subcatchment', id })
                  navigate('/map')
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function GageDetail({
  g,
  input,
  run,
  source,
  onSource,
  unit,
  file,
  subs,
  areaUnit,
  onAddFile,
  onShowSub,
}: {
  g: RainGage
  input: Hyetograph | null
  run: Hyetograph | null
  source: Source | null
  onSource: (s: Source) => void
  unit: 'in' | 'mm'
  file: { name: string; text: string | null } | null
  subs: { id: string; area: number }[]
  areaUnit: string
  onAddFile: () => void
  onShowSub: (id: string) => void
}) {
  const src: Source = source ?? (input ? 'input' : 'run')
  const h = src === 'input' ? input : run
  const missingFile = file && !file.text

  return (
    <section className="min-w-0 flex-1 rounded-xl border border-border bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold text-fg">{g.name}</h2>
          <p className="m-0 mt-0.5 text-[12px] text-muted">
            {g.format.toLowerCase()} every {duration(g.intervalHr)}
            {g.source === 'FILE' ? ` · file ${file?.name}${g.station ? `, station ${g.station}` : ''}` : ` · time series ${g.series}`}
            {g.scf !== 1 ? ` · snow catch factor ${g.scf}` : ''}
          </p>
        </div>
        {input && run && (
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Rainfall source">
            {(
              [
                ['input', 'Input data'],
                ['run', 'From the run'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={src === k}
                onClick={() => onSource(k)}
                className={cn('h-7 rounded-md px-2.5 text-[12px]', src === k ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:text-fg')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {missingFile && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-fg-soft">
          <span>
            {g.name} reads <span className="font-mono">{file!.name}</span>, which isn’t in this browser.
            {run ? ' Showing the rainfall the run used instead.' : ' Add it to see the rainfall.'}
          </span>
          <Button size="sm" variant="outline" onClick={onAddFile}>
            <FileUp className="h-3.5 w-3.5" /> Add {file!.name}
          </Button>
        </div>
      )}

      {h ? (
        <>
          <dl className="m-0 mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="Total depth" value={`${fmt(h.total)} ${unit}`} />
            <Stat label="Peak intensity" value={`${fmt(h.peak)} ${unit}/h`} sub={timeLabel(h.start, h.peakHr, h.spanHr, true)} />
            <Stat label="Raining for" value={duration(h.wetSpanHr)} sub="first to last rain" />
            <Stat label="Record" value={duration(h.spanHr)} sub={`${h.records.toLocaleString()} values`} />
          </dl>
          <RainChart h={h} unit={unit} />
          {src === 'run' && <p className="m-0 mt-1 text-[11.5px] text-muted">Rainfall on subcatchment {subs[0]?.id} at each reporting step of the run.</p>}
        </>
      ) : (
        !missingFile && <p className="m-0 py-10 text-center text-[13px] text-muted">No rainfall values to draw for this gage.</p>
      )}

      <div className="mt-5">
        <h3 className="m-0 mb-1.5 text-[12px] font-medium text-fg-soft">
          Subcatchments on this gage{subs.length ? ` · ${subs.length} · ${fmt(subs.reduce((a, s) => a + s.area, 0))} ${areaUnit}` : ''}
        </h3>
        {subs.length ? (
          <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {subs.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onShowSub(s.id)}
                title={`Show ${s.id} on the map`}
                className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11.5px] text-fg-soft hover:border-ic-rain/60 hover:text-fg"
              >
                {s.id}
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[12px] text-muted">No subcatchment uses this gage.</p>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="m-0 text-[17px] font-semibold tabular-nums text-fg">{value}</dd>
      {sub && <dd className="m-0 truncate text-[11px] text-muted">{sub}</dd>}
    </div>
  )
}

function RainChart({ h, unit }: { h: Hyetograph; unit: string }) {
  const plotRef = useRef<HTMLDivElement>(null)
  const t0 = h.hours[0] ?? 0
  const full: [number, number] | null = h.records ? [t0, t0 + h.spanHr] : null
  const { view, zoomed, drag, handlers, zoomBy, reset } = useChartZoom(full, plotRef)
  useWheelZoom(plotRef, view, zoomBy, { left: 56, right: 56 })

  // Bin to the visible span so zooming in shows the real intervals again.
  const data = useMemo(() => {
    if (!view) return []
    const lo = view[0]
    const hi = view[1]
    let a = h.hours.findIndex((x) => x + h.widthHr > lo)
    if (a < 0) a = h.records
    let b = a
    while (b < h.records && h.hours[b] <= hi) b++
    const before = a > 0 ? h.cumulative[a - 1] : 0
    const part: Hyetograph = {
      ...h,
      hours: h.hours.slice(a, b),
      intensity: h.intensity.slice(a, b),
      cumulative: h.cumulative.slice(a, b).map((c) => c - before),
      records: b - a,
      spanHr: b > a ? h.hours[b - 1] + h.widthHr - h.hours[a] : 0,
    }
    const bin = binHyetograph(part, 900)
    const rows = bin.hours.map((x, i) => ({ x, i: bin.intensity[i], c: bin.cumulative[i] + before }))
    if (rows.length) rows.push({ x: rows[rows.length - 1].x + bin.widthHr, i: rows[rows.length - 1].i, c: rows[rows.length - 1].c })
    return rows
  }, [h, view])

  const span = view ? view[1] - view[0] : h.spanHr
  const tick = { fontSize: 10, fill: 'var(--color-muted)' }
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-ic-rain/70" /> Intensity ({unit}/h)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-fg-soft" /> Cumulative depth ({unit})
          </span>
        </span>
        <ZoomControls zoomed={zoomed} zoomBy={zoomBy} reset={reset} />
      </div>
      <div ref={plotRef} className="select-none" onDoubleClick={reset}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 6, right: 0, bottom: 4, left: 0 }} {...handlers}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={view ?? ['dataMin', 'dataMax']}
              allowDataOverflow
              tick={tick}
              tickFormatter={(x) => timeLabel(h.start, Number(x), span)}
              minTickGap={28}
            />
            <YAxis yAxisId="i" width={56} tick={tick} tickFormatter={fmt} />
            <YAxis yAxisId="c" orientation="right" width={56} tick={tick} tickFormatter={fmt} />
            <Tooltip
              labelFormatter={(x) => timeLabel(h.start, Number(x), span, true)}
              formatter={(v, name) => [`${fmt(Number(v))} ${name === 'i' ? `${unit}/h` : unit}`, name === 'i' ? 'Intensity' : 'Cumulative']}
              contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 11 }}
            />
            <Area
              yAxisId="i"
              dataKey="i"
              type="stepAfter"
              stroke="var(--color-ic-rain)"
              fill="var(--color-ic-rain)"
              fillOpacity={0.45}
              strokeWidth={1.2}
              isAnimationActive={false}
            />
            <Line yAxisId="c" dataKey="c" type="linear" stroke="var(--color-fg-soft)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            {drag && <ReferenceArea yAxisId="i" x1={drag.a} x2={drag.b} fill="var(--color-accent)" fillOpacity={0.12} strokeOpacity={0} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
