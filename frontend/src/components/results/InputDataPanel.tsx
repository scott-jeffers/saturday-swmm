/**
 * The model's input data as charts: [TIMESERIES] (rainfall, inflows, tides…)
 * or [CURVES] (storage, pump, rating…). A searchable list on the left, the
 * chart on the right. Needs no run: these are what the model is given.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api/client'
import { curveAxes, parseCurves, parseTimeseries } from '../../lib/inputSeries'
import { IS_VIEWER } from '../../lib/mode'

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString())
const hhmm = (h: number) => {
  const m = Math.round(h * 60)
  const d = Math.floor(m / 1440)
  const r = m % 1440
  return `${d ? `${d}d ` : ''}${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}

export function InputDataPanel({ kind, height = 220 }: { kind: 'series' | 'curves'; height?: number }) {
  const section = kind === 'series' ? 'TIMESERIES' : 'CURVES'
  const q = useQuery({ queryKey: ['section', section], queryFn: () => api.getSection(section), retry: false })
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const flow = String(project.data?.flow_units ?? 'CFS').toUpperCase()
  const len = ['CFS', 'GPM', 'MGD'].includes(flow) ? 'ft' : 'm'

  const items = useMemo(() => {
    const rows = q.data?.rows ?? []
    return kind === 'series'
      ? parseTimeseries(rows).map((s) => ({ name: s.name, sub: s.file ? 'external file' : `${s.values.length} points`, s }))
      : parseCurves(rows).map((c) => ({ name: c.name, sub: curveAxes(c.type, len, flow).label, c }))
  }, [q.data, kind, len, flow])

  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const shown = items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
  const current = items.find((i) => i.name === picked) ?? items[0]

  if (q.isLoading) return <p className="m-0 py-6 text-center text-xs text-muted">Reading the model…</p>
  if (!items.length) {
    return (
      <p className="m-0 py-6 text-center text-xs text-muted">
        This model has no {kind === 'series' ? 'time series' : 'curves'}.
        {!IS_VIEWER && (
          <>
            {' '}
            <Link to="/data" className="text-accent-soft hover:underline">
              Add one in Model data
            </Link>
          </>
        )}
      </p>
    )
  }

  let chart: React.ReactNode = null
  let xLabel = ''
  let yLabel = ''
  let stats = ''
  if (current && 's' in current) {
    const s = current.s
    if (s.file) {
      chart = (
        <p className="m-0 py-6 text-center text-xs text-muted">
          {s.name} reads its values from <span className="font-mono text-fg-soft">{s.file}</span>, which isn’t drawn here.
        </p>
      )
    } else {
      const data = s.hours.map((h, i) => ({ x: h, y: s.values[i] }))
      xLabel = s.dated ? 'Time from first value' : 'Time'
      yLabel = 'Value'
      const max = Math.max(...s.values)
      const span = s.hours.length ? s.hours[s.hours.length - 1] - s.hours[0] : 0
      stats = `${s.values.length} points over ${hhmm(span)} · peak ${fmt(max)}`
      chart = (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={hhmm}
              tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
              label={{ value: xLabel, position: 'insideBottom', offset: -10, fontSize: 10, fill: 'var(--color-muted)' }}
            />
            <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted)' }} width={48} tickFormatter={fmt} />
            <Tooltip
              formatter={(v) => [fmt(Number(v)), s.name]}
              labelFormatter={(h) => hhmm(Number(h))}
              contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 11 }}
            />
            <Line type="stepAfter" dataKey="y" stroke="var(--color-accent)" strokeWidth={1.8} dot={data.length <= 40} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )
    }
  } else if (current && 'c' in current) {
    const c = current.c
    const ax = curveAxes(c.type, len, flow)
    xLabel = ax.x
    yLabel = ax.y
    stats = `${ax.label} curve · ${c.x.length} points`
    const data = c.x.map((x, i) => ({ x, y: c.y[i] }))
    chart = (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" />
          <XAxis
            dataKey="x"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={fmt}
            tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
            label={{ value: xLabel, position: 'insideBottom', offset: -10, fontSize: 10, fill: 'var(--color-muted)' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
            width={56}
            tickFormatter={fmt}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 8, fontSize: 10, fill: 'var(--color-muted)' }}
          />
          <Tooltip
            formatter={(v) => [fmt(Number(v)), yLabel]}
            labelFormatter={(x) => `${xLabel}: ${fmt(Number(x))}`}
            contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 11 }}
          />
          <Line type="linear" dataKey="y" stroke="var(--color-accent)" strokeWidth={1.8} dot isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <div className="flex h-full min-h-0 gap-3 max-md:flex-col">
      <div className="flex min-h-0 w-56 shrink-0 flex-col max-md:max-h-[35%] max-md:w-full">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Find ${kind === 'series' ? 'a time series' : 'a curve'}`}
          aria-label={`Find ${kind === 'series' ? 'a time series' : 'a curve'}`}
          className="field mb-1.5 h-7 text-xs"
        />
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0" role="listbox" aria-label={kind === 'series' ? 'Time series' : 'Curves'}>
          {shown.map((i) => (
            <li key={i.name}>
              <button
                type="button"
                role="option"
                aria-selected={current?.name === i.name}
                onClick={() => setPicked(i.name)}
                className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs ${
                  current?.name === i.name ? 'bg-accent/15 text-fg' : 'text-fg-soft hover:bg-fg/5'
                }`}
              >
                <span className="truncate font-mono">{i.name}</span>
                <span className="shrink-0 text-[10px] text-muted">{i.sub}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="px-2 py-1 text-xs text-muted">No match</li>}
        </ul>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2 text-xs">
          <span className="font-mono font-medium text-fg">{current?.name}</span>
          <span className="text-muted">{stats}</span>
        </div>
        {chart}
      </div>
    </div>
  )
}
