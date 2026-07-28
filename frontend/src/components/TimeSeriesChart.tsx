import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { RotateCcw } from 'lucide-react'
import type { OutVariableInfo, TimeSeriesResponse } from '../api/client'
import { Button } from './ui'

interface TimeSeriesChartProps {
  series: TimeSeriesResponse | undefined
  yLabel: string
  variables?: OutVariableInfo[]
  variable?: string
  onVariableChange?: (id: string) => void
}

type ChartPoint = {
  idx: number
  timeHr: number
  label: string
  value: number
}

function shortLabel(raw: string): string {
  const cleaned = raw.replace('T', ' ').trim()
  const parts = cleaned.split(/\s+/)
  if (parts.length >= 2) {
    const date = parts[0]
    const time = parts[1].slice(0, 5)
    return `${date} ${time}`
  }
  return cleaned
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toFixed(1)
  if (abs >= 10) return v.toFixed(2)
  if (abs >= 1) return v.toFixed(3)
  return v.toFixed(4)
}

export function TimeSeriesChart({
  series,
  yLabel,
  variables = [],
  variable,
  onVariableChange,
}: TimeSeriesChartProps) {
  const [xDomain, setXDomain] = useState<[number, number] | null>(null)
  const [refAreaLeft, setRefAreaLeft] = useState<number | null>(null)
  const [refAreaRight, setRefAreaRight] = useState<number | null>(null)
  const dragging = useRef(false)
  const chartWrapRef = useRef<HTMLDivElement>(null)

  const hasDates = Boolean(series?.times && series.times.length === series.values.length)

  const data: ChartPoint[] = useMemo(() => {
    if (!series || series.values.length === 0) return []
    return series.values.map((value, i) => {
      const timeHr = Number((series.times_sec[i] / 3600).toFixed(4))
      const label = hasDates ? shortLabel(series.times![i]) : `${timeHr} hr`
      return { idx: i, timeHr, label, value }
    })
  }, [series, hasDates])

  const fullX: [number, number] = useMemo(() => {
    if (data.length === 0) return [0, 1]
    return [data[0].timeHr, data[data.length - 1].timeHr]
  }, [data])

  const activeDomain: [number, number] = xDomain ?? fullX

  const visible = useMemo(() => {
    const [lo, hi] = activeDomain
    return data.filter((d) => d.timeHr >= lo && d.timeHr <= hi)
  }, [data, activeDomain])

  const stats = useMemo(() => {
    if (visible.length === 0) return null
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const d of visible) {
      min = Math.min(min, d.value)
      max = Math.max(max, d.value)
      sum += d.value
    }
    return { min, max, mean: sum / visible.length }
  }, [visible])

  const yDomain = useMemo((): [number, number] => {
    if (!stats) return [0, 1]
    const span = stats.max - stats.min
    const pad = span === 0 ? Math.max(Math.abs(stats.max) * 0.1, 0.01) : span * 0.08
    return [stats.min - pad, stats.max + pad]
  }, [stats])

  const resetZoom = useCallback(() => {
    setXDomain(null)
    setRefAreaLeft(null)
    setRefAreaRight(null)
  }, [])

  // Reset zoom when series/variable changes
  const seriesKey = `${series?.object_id ?? ''}:${series?.variable ?? ''}`
  useEffect(() => {
    setXDomain(null)
    setRefAreaLeft(null)
    setRefAreaRight(null)
  }, [seriesKey])

  const zoomAround = useCallback(
    (center: number, factor: number) => {
      const [lo, hi] = activeDomain
      const span = hi - lo
      if (span <= 0) return
      const newSpan = Math.max(span * factor, (fullX[1] - fullX[0]) * 0.002)
      if (newSpan >= fullX[1] - fullX[0]) {
        setXDomain(null)
        return
      }
      const ratio = (center - lo) / span
      let nextLo = center - newSpan * ratio
      let nextHi = center + newSpan * (1 - ratio)
      if (nextLo < fullX[0]) {
        nextLo = fullX[0]
        nextHi = nextLo + newSpan
      }
      if (nextHi > fullX[1]) {
        nextHi = fullX[1]
        nextLo = nextHi - newSpan
      }
      setXDomain([nextLo, nextHi])
    },
    [activeDomain, fullX],
  )

  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (data.length < 2) return
      e.preventDefault()
      const el = chartWrapRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const leftPad = 56
      const rightPad = 16
      const plotW = Math.max(rect.width - leftPad - rightPad, 1)
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - leftPad) / plotW))
      const [lo, hi] = activeDomain
      const center = lo + frac * (hi - lo)
      zoomAround(center, e.deltaY > 0 ? 1.25 : 0.8)
    },
    [data.length, activeDomain, zoomAround],
  )

  useEffect(() => {
    const el = chartWrapRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const onMouseDown = useCallback((e: { activeLabel?: string | number }) => {
    if (e.activeLabel == null) return
    const v = Number(e.activeLabel)
    if (!Number.isFinite(v)) return
    dragging.current = true
    setRefAreaLeft(v)
    setRefAreaRight(v)
  }, [])

  const onMouseMove = useCallback((e: { activeLabel?: string | number }) => {
    if (!dragging.current || e.activeLabel == null) return
    const v = Number(e.activeLabel)
    if (!Number.isFinite(v)) return
    setRefAreaRight(v)
  }, [])

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    if (refAreaLeft == null || refAreaRight == null) {
      setRefAreaLeft(null)
      setRefAreaRight(null)
      return
    }
    const left = Math.min(refAreaLeft, refAreaRight)
    const right = Math.max(refAreaLeft, refAreaRight)
    setRefAreaLeft(null)
    setRefAreaRight(null)
    if (right - left < (fullX[1] - fullX[0]) * 0.002) return
    setXDomain([left, right])
  }, [refAreaLeft, refAreaRight, fullX])

  if (!series || series.values.length === 0) {
    return (
      <p className="m-0 text-sm text-muted">No series data yet. Run a simulation first.</p>
    )
  }

  const unit = series.unit ?? ''
  const varLabel = series.variable_label || series.variable
  const tickEvery = Math.max(1, Math.floor(visible.length / 6))
  const zoomed = xDomain != null

  return (
    <div className="rounded-xl border border-border bg-surface/50 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 truncate text-sm font-semibold text-fg">
              {series.object_id}
            </h3>
            {variables.length > 0 && onVariableChange ? (
              <select
                id="variable-select"
                value={variable ?? series.variable}
                onChange={(e) => onVariableChange(e.target.value)}
                className="rounded-md border border-border-strong bg-elevated px-2 py-1 text-xs text-fg"
              >
                {variables.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.unit ? ` (${v.unit})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-md border border-border bg-elevated/80 px-2 py-0.5 text-xs text-muted">
                {varLabel}
                {unit ? ` · ${unit}` : ''}
              </span>
            )}
          </div>
          {hasDates && series.times?.[0] ? (
            <p className="m-0 mt-0.5 text-[11px] text-muted">
              {shortLabel(series.times[0])}
              {series.times.length > 1
                ? ` → ${shortLabel(series.times[series.times.length - 1])}`
                : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats && (
            <div className="flex gap-2 text-[11px] text-muted">
              <span>
                min <strong className="text-fg-soft">{formatNum(stats.min)}</strong>
              </span>
              <span>
                max <strong className="text-fg-soft">{formatNum(stats.max)}</strong>
              </span>
              <span>
                mean <strong className="text-fg-soft">{formatNum(stats.mean)}</strong>
              </span>
              {unit ? <span className="text-muted">{unit}</span> : null}
            </div>
          )}
          {zoomed && (
            <Button size="sm" variant="outline" onClick={resetZoom} title="Reset zoom">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      <div
        ref={chartWrapRef}
        className="select-none"
        onDoubleClick={resetZoom}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart
            data={data}
            margin={{ top: 8, left: 8, right: 12, bottom: 28 }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            <defs>
              <linearGradient id="tsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="timeHr"
              type="number"
              domain={activeDomain}
              allowDataOverflow
              stroke="#64748b"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              tickFormatter={(v: number) => {
                const pt = data.find((d) => Math.abs(d.timeHr - v) < 1e-6)
                if (pt) return hasDates ? pt.label.split(' ').pop() || pt.label : `${v}`
                return hasDates ? String(v) : `${Number(v).toFixed(2)}`
              }}
              ticks={visible
                .filter((_, i) => i % tickEvery === 0 || i === visible.length - 1)
                .map((d) => d.timeHr)}
              label={{
                value: hasDates ? 'Date / time' : 'Time (hr)',
                position: 'insideBottom',
                offset: -18,
                fill: '#64748b',
                fontSize: 11,
              }}
            />
            <YAxis
              domain={yDomain}
              allowDataOverflow
              stroke="#64748b"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              width={52}
              tickFormatter={(v: number) => formatNum(v)}
              label={{
                value: yLabel,
                angle: -90,
                position: 'insideLeft',
                fill: '#64748b',
                fontSize: 11,
                offset: 4,
              }}
            />
            <Tooltip
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                padding: '8px 12px',
              }}
              labelStyle={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}
              itemStyle={{ color: '#e2e8f0', fontSize: 12 }}
              labelFormatter={(_v, payload) => {
                const p = payload?.[0]?.payload as ChartPoint | undefined
                return p?.label ?? String(_v)
              }}
              formatter={(v) => [formatNum(Number(v)), varLabel]}
              cursor={{ stroke: '#38bdf8', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={varLabel}
              stroke="#38bdf8"
              strokeWidth={2}
              fill="url(#tsFill)"
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, fill: '#0ea5e9', stroke: '#e2e8f0', strokeWidth: 1 }}
            />
            {refAreaLeft != null && refAreaRight != null && (
              <ReferenceArea
                x1={refAreaLeft}
                x2={refAreaRight}
                strokeOpacity={0.3}
                fill="#38bdf8"
                fillOpacity={0.18}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="m-0 mt-1 text-[10px] text-muted">
        Scroll to zoom · drag horizontally to box-zoom · double-click to reset
      </p>
    </div>
  )
}
