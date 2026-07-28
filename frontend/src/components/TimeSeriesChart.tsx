import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TimeSeriesResponse } from '../api/client'

interface TimeSeriesChartProps {
  series: TimeSeriesResponse | undefined
  yLabel: string
}

function shortLabel(raw: string): string {
  // "2024-01-01 00:05:00" or "01/01/2024 00:05:00" → keep date + HH:MM
  const cleaned = raw.replace('T', ' ').trim()
  const parts = cleaned.split(/\s+/)
  if (parts.length >= 2) {
    const date = parts[0]
    const time = parts[1].slice(0, 5)
    return `${date} ${time}`
  }
  return cleaned
}

export function TimeSeriesChart({ series, yLabel }: TimeSeriesChartProps) {
  if (!series || series.values.length === 0) {
    return (
      <p className="m-0 text-sm text-muted">No series data yet. Run a simulation first.</p>
    )
  }

  const hasDates = Boolean(series.times && series.times.length === series.values.length)

  const data = series.values.map((value, i) => {
    const timeHr = Number((series.times_sec[i] / 3600).toFixed(3))
    const label = hasDates ? shortLabel(series.times![i]) : `${timeHr} hr`
    return {
      idx: i,
      timeHr,
      label,
      value,
    }
  })

  const tickEvery = Math.max(1, Math.floor(data.length / 6))

  return (
    <div className="mt-2">
      <h3 className="mb-2 mt-0 text-sm font-medium text-fg-soft">
        {series.object_id} — {series.variable}
        {hasDates && series.times?.[0] ? (
          <span className="ml-2 font-normal text-muted">
            {shortLabel(series.times[0])}
            {series.times.length > 1
              ? ` → ${shortLabel(series.times[series.times.length - 1])}`
              : ''}
          </span>
        ) : null}
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ left: 8, right: 12, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="label"
            stroke="#94a3b8"
            interval={0}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            ticks={data.filter((_, i) => i % tickEvery === 0 || i === data.length - 1).map((d) => d.label)}
            angle={-25}
            textAnchor="end"
            height={50}
            label={{
              value: hasDates ? 'Date / time' : 'Time (hr)',
              position: 'insideBottom',
              offset: -18,
              fill: '#94a3b8',
            }}
          />
          <YAxis
            stroke="#94a3b8"
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
          />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
            }}
            labelFormatter={(v) => String(v)}
            formatter={(v) => [Number(v).toFixed(4), yLabel]}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="value"
            name={series.variable}
            stroke="#38bdf8"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
