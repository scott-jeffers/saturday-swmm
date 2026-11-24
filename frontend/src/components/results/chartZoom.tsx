/**
 * Zoom for the Graphs tab: drag across a chart to zoom to that span,
 * Ctrl/⌘ + wheel to zoom around the cursor, buttons to step in and out,
 * double-click or Reset to go back. Works on a numeric x axis.
 */
import { Minus, Plus, RotateCcw, Sigma } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { setPref, usePref } from '../../lib/prefs'

export type XRange = [number, number]

const INSET = { left: 60, right: 16 }

export function useChartZoom(full: XRange | null, plotRef: React.RefObject<HTMLDivElement | null>) {
  const [range, setRange] = useState<XRange | null>(null)
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const fullKey = full ? `${full[0]}:${full[1]}` : ''
  // A different data span (new variable, new run) starts unzoomed.
  useEffect(() => setRange(null), [fullKey])
  const view: XRange | null = range ?? full
  const zoomed = range != null

  const clamp = useCallback(
    (lo: number, hi: number): XRange | null => {
      if (!full) return null
      const span = full[1] - full[0]
      const minSpan = span / 500
      if (hi - lo < minSpan) {
        const c = (lo + hi) / 2
        lo = c - minSpan / 2
        hi = c + minSpan / 2
      }
      if (lo < full[0]) [lo, hi] = [full[0], full[0] + (hi - lo)]
      if (hi > full[1]) [lo, hi] = [full[1] - (hi - lo), full[1]]
      lo = Math.max(full[0], lo)
      hi = Math.min(full[1], hi)
      return hi - lo >= span * 0.999 ? null : [lo, hi]
    },
    [full],
  )

  /** Zoom by `factor` (<1 in, >1 out) around x = `at` (defaults to the middle). */
  const zoomBy = useCallback(
    (factor: number, at?: number) => {
      if (!view) return
      const [lo, hi] = view
      const c = at ?? (lo + hi) / 2
      setRange(clamp(c - (c - lo) * factor, c + (hi - c) * factor))
    },
    [view, clamp],
  )

  /** Pixel x inside the chart → data x, using the current view. */
  const toX = (clientX: number | undefined) => {
    const el = plotRef.current
    if (!el || !view || clientX == null) return NaN
    const chartX = clientX - el.getBoundingClientRect().left
    const w = el.clientWidth - INSET.left - INSET.right
    const f = Math.min(1, Math.max(0, (chartX - INSET.left) / Math.max(w, 1)))
    return view[0] + f * (view[1] - view[0])
  }
  type Ev = { clientX?: number } | undefined
  const handlers = {
    onMouseDown: (_s: unknown, e: Ev) => {
      const x = toX(e?.clientX)
      if (Number.isFinite(x)) setDrag({ a: x, b: x })
    },
    onMouseMove: (_s: unknown, e: Ev) => {
      const x = toX(e?.clientX)
      if (drag && Number.isFinite(x)) setDrag({ ...drag, b: x })
    },
    onMouseUp: () => {
      if (drag && full) {
        const lo = Math.min(drag.a, drag.b)
        const hi = Math.max(drag.a, drag.b)
        if (hi - lo > (full[1] - full[0]) / 1000) setRange(clamp(lo, hi))
      }
      setDrag(null)
    },
  }

  return { view, zoomed, drag, handlers, zoomBy, reset: () => setRange(null) }
}

/** Ctrl/⌘ + wheel on the chart area zooms around the pointer. */
export function useWheelZoom(el: React.RefObject<HTMLDivElement | null>, view: XRange | null, zoomBy: (f: number, at?: number) => void, plotInset = INSET) {
  useEffect(() => {
    const node = el.current
    if (!node || !view) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = node.getBoundingClientRect()
      const w = r.width - plotInset.left - plotInset.right
      const f = Math.min(1, Math.max(0, (e.clientX - r.left - plotInset.left) / Math.max(w, 1)))
      zoomBy(e.deltaY < 0 ? 0.8 : 1.25, view[0] + f * (view[1] - view[0]))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [el, view, zoomBy, plotInset.left, plotInset.right])
}

const btn = 'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40'

export function ZoomControls({ zoomed, zoomBy, reset }: { zoomed: boolean; zoomBy: (f: number) => void; reset: () => void }) {
  return (
    <span className="inline-flex items-center" role="group" aria-label="Zoom">
      <button type="button" className={btn} onClick={() => zoomBy(0.6)} title="Zoom in (or drag across the graph)" aria-label="Zoom in">
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btn} onClick={() => zoomBy(1 / 0.6)} disabled={!zoomed} title="Zoom out" aria-label="Zoom out">
        <Minus className="h-3.5 w-3.5" />
      </button>
      {zoomed && (
        <button type="button" className={btn} onClick={reset} title="Show everything (or double-click the graph)">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      )}
    </span>
  )
}

/** The one Values switch for every graph (off unless turned on). */
export function useShowStats() {
  const on = usePref('graph-stats', '0') === '1'
  return [on, (v: boolean) => setPref('graph-stats', v ? '1' : '0')] as const
}

export function StatsToggle() {
  const [on, set] = useShowStats()
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => set(!on)}
      title="Peak, minimum, mean and volume for what is shown"
      className={cn(btn, on && 'bg-accent/15 text-fg')}
    >
      <Sigma className="h-3.5 w-3.5" /> Values
    </button>
  )
}

// ------------------------------------------------------------------ stats

export type SeriesStats = { peak: number; peakX: number; min: number; mean: number; volume: number | null }

/**
 * Stats of y(x) over [lo, hi]. `xSeconds` converts an x step to seconds, for
 * the volume (trapezoid integral) of flow series.
 */
/**
 * `step`: false = straight lines between points; true = each value holds until
 * the next (time series input); 'before' = each value covers the step that ends
 * at it (SWMM's reported rainfall).
 */
export function seriesStats(xs: number[], ys: (number | null)[], lo: number, hi: number, xSeconds: number | null, step: boolean | 'before' = false): SeriesStats | null {
  let peak = -Infinity, peakX = NaN, min = Infinity, sum = 0, n = 0, vol = 0
  let prevX: number | null = null
  let prevY: number | null = null
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!
    const y = ys[i]
    if (y == null || !Number.isFinite(y)) {
      prevX = null
      prevY = null
      continue
    }
    if (x >= lo && x <= hi) {
      if (y > peak) {
        peak = y
        peakX = x
      }
      if (y < min) min = y
      sum += y
      n++
    }
    if (xSeconds != null && prevX != null && prevY != null) {
      const a = Math.max(prevX, lo)
      const b = Math.min(x, hi)
      if (b > a) {
        // Value at the clipped ends by linear interpolation (or the held value for step series).
        const at = (t: number) => (step === 'before' ? y : step ? prevY! : prevY! + ((y - prevY!) * (t - prevX!)) / (x - prevX!))
        vol += ((at(a) + at(b)) / 2) * (b - a) * xSeconds
      }
    }
    prevX = x
    prevY = y
  }
  if (!n) return null
  return { peak, peakX, min, mean: sum / n, volume: xSeconds != null ? vol : null }
}

/** Flow units → the volume unit and seconds per flow-unit time. */
/** Rainfall intensity (in/hr, mm/hr) summed over time gives a depth (in, mm). */
export function rainDepthUnit(unit: string | null | undefined): { unit: string; perSecond: number } | null {
  const m = /^(in|mm)\s*\/\s*(hr|h)$/i.exec((unit ?? '').trim())
  return m ? { unit: m[1]!.toLowerCase(), perSecond: 1 / 3600 } : null
}

export function flowVolumeUnit(flowUnits: string | null | undefined): { unit: string; perSecond: number } | null {
  switch ((flowUnits ?? '').toUpperCase()) {
    case 'CMS':
      return { unit: 'm³', perSecond: 1 }
    case 'CFS':
      return { unit: 'ft³', perSecond: 1 }
    case 'LPS':
      return { unit: 'm³', perSecond: 0.001 }
    case 'GPM':
      return { unit: 'gal', perSecond: 1 / 60 }
    case 'MGD':
      return { unit: 'Mgal', perSecond: 1 / 86400 }
    case 'MLD':
      return { unit: 'ML', perSecond: 1 / 86400 }
    default:
      return null
  }
}

/** A y domain that fits the visible part of the series (with a little headroom). */
export function fitY(series: { xs: number[]; ys: (number | null)[] }[], view: XRange | null): [number, number] | undefined {
  if (!view) return undefined
  let lo = Infinity, hi = -Infinity
  for (const { xs, ys } of series)
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i]!, y = ys[i]
      if (y == null || !Number.isFinite(y) || x < view[0] || x > view[1]) continue
      if (y < lo) lo = y
      if (y > hi) hi = y
    }
  if (!Number.isFinite(lo)) return undefined
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.06
  return [lo >= 0 && lo - pad < 0 ? 0 : lo - pad, hi + pad]
}
