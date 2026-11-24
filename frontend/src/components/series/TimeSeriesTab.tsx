/**
 * Time series: rainfall, inflow hydrographs, outfall stages, temperature and
 * evaporation. Values typed or pasted in, imported from files, or read from an
 * external file at run time.
 */
import { Activity, FileUp, Percent } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '../../lib/cn'
import { freeName, hoursOf, seriesStats, seriesXY, trim, usedBy, type Sections, type TimeSeries } from '../../lib/seriesData'
import { Button } from '../ui'
import { ImportDialog } from './ImportDialog'
import { EmptyEditor, Grid, ItemHeader, ItemList, Stat, axisTick, fmt, hhmm, tooltipStyle, type ListItem } from './shared'

const GROUP_ORDER = ['Rainfall', 'Inflows', 'Outfall stage', 'Climate', 'Not used']

function useOf(s: TimeSeries, secs: Sections): string {
  const refs = usedBy('timeseries', s.name, secs)
  if (refs.some((r) => r.section === 'RAINGAGES')) return 'Rainfall'
  if (refs.some((r) => r.section === 'INFLOWS')) return 'Inflows'
  if (refs.some((r) => r.section === 'OUTFALLS')) return 'Outfall stage'
  if (refs.some((r) => r.section === 'EVAPORATION' || r.section === 'TEMPERATURE')) return 'Climate'
  return 'Not used'
}

export function TimeSeriesTab({
  list,
  setList,
  secs,
  missing,
  pick,
  setPick,
  onRename,
}: {
  list: TimeSeries[]
  setList: (l: TimeSeries[]) => void
  secs: Sections
  missing: { name: string; by: string }[]
  pick: string | null
  setPick: (n: string | null) => void
  onRename: (from: string, to: string) => void
}) {
  const [importing, setImporting] = useState(false)
  const [scale, setScale] = useState('')
  const current = list.find((s) => s.name === pick) ?? list[0] ?? null
  const items: ListItem[] = useMemo(
    () =>
      [...list]
        .map((s) => ({ name: s.name, group: useOf(s, secs), sub: s.file != null ? 'file' : `${s.points.length}` }))
        .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)),
    [list, secs],
  )
  const update = (patch: Partial<TimeSeries>) => current && setList(list.map((s) => (s.name === current.name ? { ...s, ...patch } : s)))
  const add = (name = freeName('TS', list.map((s) => s.name))) => {
    setList([...list, { name, points: [{ date: '', time: '0:00', value: '0' }] }])
    setPick(name)
  }
  const refs = current ? usedBy('timeseries', current.name, secs) : []
  const rain = refs.some((r) => r.section === 'RAINGAGES')

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <ItemList
        noun="time series"
        items={items}
        current={current?.name ?? null}
        onPick={setPick}
        onAdd={() => add()}
        addLabel="New time series"
        missing={missing}
        onCreateMissing={(n) => add(n)}
        extra={
          <Button variant="outline" size="sm" className="w-full" onClick={() => setImporting(true)}>
            <FileUp className="h-3.5 w-3.5" /> Import from a file or Excel
          </Button>
        }
      />
      {current ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <ItemHeader
            name={current.name}
            taken={list.map((s) => s.name)}
            usedBy={refs}
            onRename={(to) => {
              onRename(current.name, to)
              setPick(to)
            }}
            onDuplicate={() => {
              const n = freeName(`${current.name}_copy`, list.map((s) => s.name))
              setList([...list, { ...current, name: n, points: current.points.map((p) => ({ ...p })) }])
              setPick(n)
            }}
            onDelete={() => {
              setList(list.filter((s) => s.name !== current.name))
              setPick(null)
            }}
          >
            <div className="inline-flex rounded-md border border-border p-0.5 text-[12px]" role="radiogroup" aria-label="Where the values are">
              {(['inline', 'file'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={(current.file != null) === (k === 'file')}
                  onClick={() => update(k === 'file' ? { file: current.file ?? `${current.name}.dat` } : { file: undefined })}
                  className={cn('rounded px-2 py-0.5', (current.file != null) === (k === 'file') ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:text-fg')}
                >
                  {k === 'inline' ? 'In the model' : 'External file'}
                </button>
              ))}
            </div>
          </ItemHeader>
          {current.file != null ? (
            <div className="space-y-3 px-5 py-4">
              <label className="block max-w-xl">
                <span className="mb-1 block text-[12px] text-muted">File path (relative to the .inp file, or absolute)</span>
                <input value={current.file} onChange={(e) => update({ file: e.target.value })} className="field h-8 w-full font-mono text-[12.5px]" />
              </label>
              <p className="m-0 max-w-xl text-[12.5px] leading-relaxed text-fg-soft">
                SWMM reads the values from this file when the model runs. Each line holds a date, time and value (or hours and a value); lines starting with a semicolon are comments. To bring the
                values into the model instead, switch to <span className="font-medium text-fg">In the model</span> and import the file.
              </p>
            </div>
          ) : (
            <SeriesBody s={current} rain={rain} onPoints={(points) => update({ points })} scale={scale} setScale={setScale} onImport={() => setImporting(true)} />
          )}
        </div>
      ) : (
        <EmptyEditor
          icon={<Activity className="h-5 w-5 text-ic-rain" />}
          title="No time series yet"
          body="Time series give the model values that change over time: rainfall for a rain gage, an inflow hydrograph at a node, an outfall’s stage, or temperature and evaporation. Type values in, paste them from a spreadsheet, or import a file."
          actions={
            <>
              <Button variant="primary" onClick={() => add()}>
                New time series
              </Button>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUp className="h-3.5 w-3.5" /> Import
              </Button>
            </>
          }
        />
      )}
      <ImportDialog
        open={importing}
        onOpenChange={setImporting}
        taken={list.map((s) => s.name)}
        replaceName={current?.file == null ? current?.name : null}
        onImport={(series, replace) => {
          let next = list
          if (replace && current) {
            const pts = series[0]!.points
            next = next.map((x) => (x.name === current.name ? { ...x, points: pts } : x))
            series = series.slice(1)
          }
          setList([...next, ...series])
          if (series.length) setPick(series[0]!.name)
        }}
      />
    </div>
  )
}

function SeriesBody({ s, rain, onPoints, scale, setScale, onImport }: { s: TimeSeries; rain: boolean; onPoints: (p: TimeSeries['points']) => void; scale: string; setScale: (v: string) => void; onImport: () => void }) {
  const xy = useMemo(() => seriesXY(s), [s])
  const stats = useMemo(() => seriesStats(s), [s])
  const data = xy.x.map((x, i) => ({ x, y: xy.y[i] }))
  const tick = (h: number) => {
    if (xy.start == null) return hhmm(h)
    const d = new Date(xy.start + h * 3_600_000)
    const span = stats?.span ?? 0
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    return span > 72 ? date : span > 20 ? `${date} ${time}` : time
  }
  // SWMM needs times in order.
  const invalid = useMemo(() => {
    const bad = new Set<number>()
    let prev = -Infinity
    let day: string | null = null
    s.points.forEach((p, i) => {
      if (p.date) day = p.date
      const h = hoursOf(p.time)
      if (h == null || (p.value.trim() !== '' && !Number.isFinite(Number(p.value)))) {
        bad.add(i)
        return
      }
      const t = (day ? Date.parse(day) / 3_600_000 : 0) + h
      if (t < prev) bad.add(i)
      prev = t
    })
    return bad
  }, [s.points])
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3">
        <Stat label="Points" value={stats?.n.toLocaleString() ?? 0} />
        <Stat label="Covers" value={stats ? hhmm(stats.span) : '–'} />
        <Stat label="Lowest" value={stats ? fmt(stats.min) : '–'} />
        <Stat label="Highest" value={stats ? fmt(stats.max) : '–'} />
        <Stat label={rain ? 'Sum of values' : 'Area under curve (value·h)'} value={stats ? fmt(rain ? stats.total : stats.integral) : '–'} />
        {invalid.size > 0 && <Stat label="To check" value={`${invalid.size} row${invalid.size === 1 ? '' : 's'}`} tone="warn" />}
      </div>
      <div className="h-56 rounded-lg border border-border bg-elevated px-1 pt-2">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={tick} tick={axisTick} minTickGap={36} />
              <YAxis tick={axisTick} width={46} tickFormatter={fmt} />
              <Tooltip formatter={(v) => [fmt(Number(v)), s.name]} labelFormatter={(h) => tick(Number(h))} contentStyle={tooltipStyle} />
              <Line type={rain ? 'stepAfter' : 'linear'} dataKey="y" stroke="var(--color-ic-rain)" strokeWidth={1.8} dot={data.length <= 48 ? { r: 2 } : false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="m-0 pt-20 text-center text-[12px] text-muted">Add two or more points to see the graph.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onImport}>
          <FileUp className="h-3.5 w-3.5" /> Import values
        </Button>
        <div className="inline-flex items-center gap-1.5">
          <input value={scale} onChange={(e) => setScale(e.target.value)} placeholder="× 1.0" aria-label="Multiply every value by" className="field h-7 w-20 text-[12px] tabular-nums" />
          <Button
            variant="outline"
            size="sm"
            disabled={!Number.isFinite(Number(scale)) || !scale.trim()}
            onClick={() => {
              const k = Number(scale)
              onPoints(s.points.map((p) => (p.value.trim() && Number.isFinite(Number(p.value)) ? { ...p, value: trim(Number(p.value) * k, 6) } : p)))
              setScale('')
            }}
          >
            <Percent className="h-3.5 w-3.5" /> Scale values
          </Button>
        </div>
        {invalid.size > 0 && <span className="text-[12px] text-warning">Highlighted rows have a time out of order or a value that isn’t a number.</span>}
      </div>
      <Grid
        columns={[
          { key: 'date', label: 'Date (MM/DD/YYYY)', width: '9.5rem', hint: 'Optional. Leave blank to count hours from the start of the run; a date carries on to the rows below it.' },
          { key: 'time', label: 'Time', width: '7rem', placeholder: 'H:MM', hint: 'Time of day (H:MM) when a date is given, otherwise hours from the start (1.5 or 1:30).' },
          { key: 'value', label: 'Value', numeric: true },
        ]}
        rows={s.points.map((p) => [p.date, p.time, p.value])}
        onChange={(rows) => onPoints(rows.map(([date, time, value]) => ({ date: date ?? '', time: time ?? '', value: value ?? '' })))}
        invalid={invalid}
        height={420}
        addLabel="Add a point"
      />
    </div>
  )
}
