import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ProfileResponse } from '../../api/client'
import { Button, Panel } from '../ui'

interface ProfileViewerProps {
  profile: ProfileResponse | undefined
  start: string
  end: string
  onStartChange: (id: string) => void
  onEndChange: (id: string) => void
  onPickMode: (mode: 'start' | 'end' | null) => void
  pickMode: 'start' | 'end' | null
  loading?: boolean
  error?: string | null
  /** Compact bar for under-map layout */
  embedded?: boolean
  timeLabel?: string | null
  onSelect?: (sel: { object_type: 'node' | 'link'; id: string }) => void
}

const PAD = { top: 32, right: 18, bottom: 46, left: 56 }

type HoverInfo =
  | {
      kind: 'node'
      id: string
      x: number
      y: number
      elevation: number
      ground: number
      water: number | null
      hgl: number | null
    }
  | {
      kind: 'link'
      id: string
      x: number
      y: number
      invertUs: number
      invertDs: number
      diameter: number | null
    }

function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

function ticks(min: number, max: number, step: number): number[] {
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(v)
  return out
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(digits)
}

export function ProfileViewer({
  profile,
  start,
  end,
  onStartChange,
  onEndChange,
  onPickMode,
  pickMode,
  loading,
  error,
  embedded = false,
  timeLabel,
  onSelect,
}: ProfileViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [xDomain, setXDomain] = useState<[number, number] | null>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 80) setWidth(w)
    })
    ro.observe(el)
    setWidth(el.clientWidth || 640)
    return () => ro.disconnect()
  }, [])

  // Reset zoom when profile path changes
  const pathKey = profile
    ? `${profile.nodes[0]?.id ?? ''}->${profile.nodes[profile.nodes.length - 1]?.id ?? ''}:${profile.total_length}`
    : ''
  useEffect(() => {
    setXDomain(null)
    setDragStart(null)
    setDragEnd(null)
    setHover(null)
  }, [pathKey])

  const height = embedded ? 240 : 280

  const fullXMax = Math.max(profile?.total_length ?? 1, 1)
  const activeDomain: [number, number] = xDomain ?? [0, fullXMax]

  const plot = useMemo(() => {
    if (!profile || profile.nodes.length < 1) return null
    const [xMin, xMax] = activeDomain
    const nodes = profile.nodes
    const links = profile.links

    const elevs: number[] = []
    for (const n of nodes) {
      if (n.distance < xMin - 1e-6 || n.distance > xMax + 1e-6) continue
      elevs.push(n.elevation, n.ground ?? n.elevation)
      if (n.water_surface != null) elevs.push(n.water_surface)
      if (n.hgl != null) elevs.push(n.hgl)
    }
    for (const L of links) {
      const overlaps = L.end_distance >= xMin && L.start_distance <= xMax
      if (!overlaps) continue
      elevs.push(L.invert_us, L.invert_ds)
      if (L.crown_us != null) elevs.push(L.crown_us)
      if (L.crown_ds != null) elevs.push(L.crown_ds)
    }
    if (elevs.length === 0) {
      for (const n of nodes) {
        elevs.push(n.elevation, n.ground ?? n.elevation)
      }
    }
    const rawMin = Math.min(...elevs)
    const rawMax = Math.max(...elevs)
    const padY = Math.max((rawMax - rawMin) * 0.12, 0.4)
    const yMin = rawMin - padY
    const yMax = rawMax + padY

    const iw = Math.max(width - PAD.left - PAD.right, 40)
    const ih = Math.max(height - PAD.top - PAD.bottom, 40)
    const span = Math.max(xMax - xMin, 1e-9)
    const sx = (d: number) => PAD.left + ((d - xMin) / span) * iw
    const sy = (e: number) => PAD.top + ((yMax - e) / (yMax - yMin || 1)) * ih

    const yStep = niceStep(yMax - yMin)
    const xStep = niceStep(span)
    const yTicks = ticks(yMin, yMax, yStep)
    const xTicks = ticks(xMin, xMax, xStep)

    const mhHalf = Math.min(Math.max(span * 0.008, 0.4), span * 0.03)

    const pipePolys = links.map((L) => {
      const crownUs = L.crown_us ?? L.invert_us + (L.diameter ?? 0.3)
      const crownDs = L.crown_ds ?? L.invert_ds + (L.diameter ?? 0.3)
      const pts = [
        [sx(L.start_distance), sy(L.invert_us)],
        [sx(L.end_distance), sy(L.invert_ds)],
        [sx(L.end_distance), sy(crownDs)],
        [sx(L.start_distance), sy(crownUs)],
      ]
      return {
        id: L.id,
        points: pts.map((p) => p.join(',')).join(' '),
        invertPath: `M ${sx(L.start_distance)} ${sy(L.invert_us)} L ${sx(L.end_distance)} ${sy(L.invert_ds)}`,
        crownPath: `M ${sx(L.start_distance)} ${sy(crownUs)} L ${sx(L.end_distance)} ${sy(crownDs)}`,
        midX: sx((L.start_distance + L.end_distance) / 2),
        midY: sy((L.invert_us + L.invert_ds + crownUs + crownDs) / 4),
        L,
        crownUs,
        crownDs,
      }
    })

    const waterFills = links.map((L, i) => {
      const n0 = nodes[i]
      const n1 = nodes[i + 1]
      const w0 = n0?.water_surface ?? n0?.hgl
      const w1 = n1?.water_surface ?? n1?.hgl
      if (w0 == null || w1 == null) return null
      const crownUs = L.crown_us ?? L.invert_us + (L.diameter ?? 0.3)
      const crownDs = L.crown_ds ?? L.invert_ds + (L.diameter ?? 0.3)
      const topUs = Math.max(L.invert_us, w0)
      const topDs = Math.max(L.invert_ds, w1)
      const pts = [
        [sx(L.start_distance), sy(L.invert_us)],
        [sx(L.end_distance), sy(L.invert_ds)],
        [sx(L.end_distance), sy(topDs)],
        [sx(L.start_distance), sy(topUs)],
      ]
      const surcharged = w0 > crownUs || w1 > crownDs
      return {
        id: L.id,
        points: pts.map((p) => p.join(',')).join(' '),
        surcharged,
      }
    })

    const manholes = nodes.map((n) => {
      const ground = n.ground ?? n.elevation
      const x0 = sx(n.distance - mhHalf)
      const x1 = sx(n.distance + mhHalf)
      const yInv = sy(n.elevation)
      const yRim = sy(ground)
      const water = n.water_surface ?? n.hgl
      let waterFill: string | null = null
      if (water != null && water > n.elevation) {
        const yW = sy(Math.min(water, ground + Math.max(ground - n.elevation, 0.5)))
        waterFill = [
          [x0, yInv],
          [x1, yInv],
          [x1, yW],
          [x0, yW],
        ]
          .map((p) => p.join(','))
          .join(' ')
      }
      return {
        id: n.id,
        distance: n.distance,
        elevation: n.elevation,
        ground,
        water: n.water_surface ?? null,
        hgl: n.hgl ?? null,
        structure: [
          [x0, yInv],
          [x1, yInv],
          [x1, yRim],
          [x0, yRim],
        ]
          .map((p) => p.join(','))
          .join(' '),
        waterFill,
        labelX: sx(n.distance),
        labelY: yRim - 6,
        cx: sx(n.distance),
        cy: (yInv + yRim) / 2,
      }
    })

    const groundPath = nodes
      .map((n, i) => {
        const g = n.ground ?? n.elevation
        const cmd = i === 0 ? 'M' : 'L'
        return `${cmd} ${sx(n.distance)} ${sy(g)}`
      })
      .join(' ')

    const hglPts = nodes.filter((n) => n.hgl != null || n.water_surface != null)
    const hglPath =
      hglPts.length >= 2
        ? hglPts
            .map((n, i) => {
              const v = n.hgl ?? n.water_surface!
              return `${i === 0 ? 'M' : 'L'} ${sx(n.distance)} ${sy(v)}`
            })
            .join(' ')
        : null

    const wsPts = nodes.filter((n) => n.water_surface != null)
    const wsPath =
      wsPts.length >= 2
        ? wsPts
            .map((n, i) => `${i === 0 ? 'M' : 'L'} ${sx(n.distance)} ${sy(n.water_surface!)}`)
            .join(' ')
        : null

    return {
      pipePolys,
      waterFills,
      manholes,
      groundPath,
      hglPath,
      wsPath,
      yTicks,
      xTicks,
      sx,
      sy,
      yMin,
      yMax,
      xMin,
      xMax,
      iw,
      ih,
      hasResults: nodes.some((n) => n.water_surface != null || n.hgl != null),
    }
  }, [profile, width, height, activeDomain])

  const distFromClientX = useCallback(
    (clientX: number): number | null => {
      if (!plot || !wrapRef.current) return null
      const rect = wrapRef.current.getBoundingClientRect()
      const svgX = clientX - rect.left
      const frac = (svgX - PAD.left) / plot.iw
      const [lo, hi] = activeDomain
      return lo + Math.min(1, Math.max(0, frac)) * (hi - lo)
    },
    [plot, activeDomain],
  )

  const resetZoom = useCallback(() => {
    setXDomain(null)
    setDragStart(null)
    setDragEnd(null)
  }, [])

  const zoomAround = useCallback(
    (center: number, factor: number) => {
      const [lo, hi] = activeDomain
      const span = hi - lo
      if (span <= 0) return
      const newSpan = Math.max(span * factor, fullXMax * 0.01)
      if (newSpan >= fullXMax) {
        setXDomain(null)
        return
      }
      const ratio = (center - lo) / span
      let nextLo = center - newSpan * ratio
      let nextHi = center + newSpan * (1 - ratio)
      if (nextLo < 0) {
        nextLo = 0
        nextHi = newSpan
      }
      if (nextHi > fullXMax) {
        nextHi = fullXMax
        nextLo = nextHi - newSpan
      }
      setXDomain([nextLo, nextHi])
    },
    [activeDomain, fullXMax],
  )

  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (!plot) return
      e.preventDefault()
      const center = distFromClientX(e.clientX)
      if (center == null) return
      zoomAround(center, e.deltaY > 0 ? 1.25 : 0.8)
    },
    [plot, distFromClientX, zoomAround],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const onSvgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      // Don't start box-zoom when clicking an element (selection handled separately)
      const target = e.target as Element
      if (target.closest?.('[data-profile-el]')) return
      const d = distFromClientX(e.clientX)
      if (d == null) return
      dragging.current = true
      setDragStart(d)
      setDragEnd(d)
    },
    [distFromClientX],
  )

  const onSvgMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging.current) return
      const d = distFromClientX(e.clientX)
      if (d == null) return
      setDragEnd(d)
    },
    [distFromClientX],
  )

  const onSvgMouseUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    if (dragStart == null || dragEnd == null) {
      setDragStart(null)
      setDragEnd(null)
      return
    }
    const left = Math.min(dragStart, dragEnd)
    const right = Math.max(dragStart, dragEnd)
    setDragStart(null)
    setDragEnd(null)
    if (right - left < fullXMax * 0.01) return
    setXDomain([left, right])
  }, [dragStart, dragEnd, fullXMax])

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted">Start</span>
        <input
          value={start}
          onChange={(e) => onStartChange(e.target.value)}
          className="w-24 rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          variant={pickMode === 'start' ? 'primary' : 'outline'}
          onClick={() => onPickMode(pickMode === 'start' ? null : 'start')}
        >
          Pick
        </Button>
      </label>
      <label className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted">End</span>
        <input
          value={end}
          onChange={(e) => onEndChange(e.target.value)}
          className="w-24 rounded-md border border-border-strong bg-surface px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          variant={pickMode === 'end' ? 'primary' : 'outline'}
          onClick={() => onPickMode(pickMode === 'end' ? null : 'end')}
        >
          Pick
        </Button>
      </label>
      {profile && (
        <span className="text-[11px] text-muted">
          {profile.total_length.toFixed(1)} m · {profile.nodes.length} nodes ·{' '}
          {profile.links.length} links
          {timeLabel ? ` · ${timeLabel}` : ''}
        </span>
      )}
      {loading && <span className="text-[11px] text-muted">Updating…</span>}
      {xDomain && (
        <Button size="sm" variant="outline" onClick={resetZoom} title="Reset zoom">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      )}
    </div>
  )

  const legend = (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm border border-[#64748b]/70 bg-gradient-to-b from-[#cbd5e1]/50 to-[#64748b]/30" />
        Pipe
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2 rounded-[2px] border border-[#94a3b8] bg-[#0f172a]" />
        Junction
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-0.5 w-3 border-t border-dashed border-[#a8a29e]" />
        Ground / rim
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm bg-[#0ea5e9]/55" />
        Water
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-0.5 w-3 bg-[#fb7185]" />
        HGL
      </span>
      <span className="ml-auto text-[10px] text-muted/80">
        Scroll / drag to zoom · click element to select
      </span>
    </div>
  )

  const chart = (
    <div ref={wrapRef} className="relative w-full select-none">
      {pickMode && (
        <p className="mb-1 text-xs text-muted">
          Click a node on the map to set the {pickMode} node.
        </p>
      )}
      {error && <p className="mb-1 text-sm text-danger">{error}</p>}
      {!profile && !loading && !error && (
        <p className="py-6 text-center text-sm text-muted">
          Pick a start and end node to draw a hydraulic profile.
        </p>
      )}
      {plot && profile && (
        <svg
          width={width}
          height={height}
          className="block max-w-full"
          role="img"
          aria-label="Hydraulic profile"
          onMouseDown={onSvgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={() => {
            onSvgMouseUp()
            setHover(null)
          }}
          onDoubleClick={resetZoom}
        >
          <defs>
            <linearGradient id="pipeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#64748b" stopOpacity="0.28" />
            </linearGradient>
            <linearGradient id="pipeFillHover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.2" />
            </linearGradient>
            <linearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="waterSurcharge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f9a8d4" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.75" />
            </linearGradient>
            <clipPath id="profileClip">
              <rect x={PAD.left} y={PAD.top} width={plot.iw} height={plot.ih} />
            </clipPath>
          </defs>

          {/* Plot background */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plot.iw}
            height={plot.ih}
            fill="#0b1220"
            rx={4}
          />

          {/* Grid */}
          {plot.yTicks.map((v) => (
            <g key={`y-${v}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plot.iw}
                y1={plot.sy(v)}
                y2={plot.sy(v)}
                stroke="#1e293b"
                strokeDasharray="3 4"
              />
              <text
                x={PAD.left - 8}
                y={plot.sy(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#94a3b8"
                fontSize={10}
              >
                {Number.isInteger(v) ? v : v.toFixed(1)}
              </text>
            </g>
          ))}
          {plot.xTicks.map((v) => (
            <g key={`x-${v}`}>
              <line
                x1={plot.sx(v)}
                x2={plot.sx(v)}
                y1={PAD.top}
                y2={PAD.top + plot.ih}
                stroke="#1e293b"
                strokeDasharray="3 4"
              />
              <text
                x={plot.sx(v)}
                y={height - 14}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={10}
              >
                {v < 10 ? v.toFixed(1) : v.toFixed(0)}
              </text>
            </g>
          ))}

          <text
            x={14}
            y={PAD.top + plot.ih / 2}
            fill="#64748b"
            fontSize={10}
            transform={`rotate(-90 14 ${PAD.top + plot.ih / 2})`}
            textAnchor="middle"
          >
            Elevation
          </text>
          <text
            x={PAD.left + plot.iw / 2}
            y={height - 2}
            fill="#64748b"
            fontSize={10}
            textAnchor="middle"
          >
            Distance (m)
          </text>

          <g clipPath="url(#profileClip)">
            {/* Pipes */}
            {plot.pipePolys.map((p) => {
              const isHover = hover?.kind === 'link' && hover.id === p.id
              return (
                <g
                  key={`pipe-${p.id}`}
                  data-profile-el="link"
                  style={{ cursor: onSelect ? 'pointer' : undefined }}
                  onMouseEnter={() =>
                    setHover({
                      kind: 'link',
                      id: p.id,
                      x: p.midX,
                      y: p.midY,
                      invertUs: p.L.invert_us,
                      invertDs: p.L.invert_ds,
                      diameter: p.L.diameter ?? null,
                    })
                  }
                  onMouseLeave={() => setHover((h) => (h?.id === p.id ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect?.({ object_type: 'link', id: p.id })
                  }}
                >
                  <polygon
                    points={p.points}
                    fill={isHover ? 'url(#pipeFillHover)' : 'url(#pipeFill)'}
                    stroke={isHover ? '#38bdf8' : '#64748b'}
                    strokeWidth={isHover ? 1.75 : 1}
                  />
                  <path d={p.invertPath} stroke="#e2e8f0" strokeWidth={1.5} fill="none" />
                  <path d={p.crownPath} stroke="#94a3b8" strokeWidth={1} fill="none" />
                </g>
              )
            })}

            {/* Water in pipes */}
            {plot.waterFills.map(
              (w) =>
                w && (
                  <polygon
                    key={`water-${w.id}`}
                    points={w.points}
                    fill={w.surcharged ? 'url(#waterSurcharge)' : 'url(#waterFill)'}
                    opacity={0.9}
                    pointerEvents="none"
                  />
                ),
            )}

            {/* Junction structures */}
            {plot.manholes.map((m) => {
              const isHover = hover?.kind === 'node' && hover.id === m.id
              return (
                <g
                  key={`mh-${m.id}`}
                  data-profile-el="node"
                  style={{ cursor: onSelect ? 'pointer' : undefined }}
                  onMouseEnter={() =>
                    setHover({
                      kind: 'node',
                      id: m.id,
                      x: m.cx,
                      y: m.cy,
                      elevation: m.elevation,
                      ground: m.ground,
                      water: m.water,
                      hgl: m.hgl,
                    })
                  }
                  onMouseLeave={() => setHover((h) => (h?.id === m.id ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect?.({ object_type: 'node', id: m.id })
                  }}
                >
                  <polygon
                    points={m.structure}
                    fill={isHover ? '#1e293b' : '#0f172a'}
                    stroke={isHover ? '#38bdf8' : '#94a3b8'}
                    strokeWidth={isHover ? 1.75 : 1.25}
                    opacity={0.95}
                  />
                  {m.waterFill && (
                    <polygon points={m.waterFill} fill="url(#waterFill)" opacity={0.85} />
                  )}
                  <text
                    x={m.labelX}
                    y={m.labelY}
                    textAnchor="middle"
                    fill={isHover ? '#e2e8f0' : '#cbd5e1'}
                    fontSize={9}
                    fontFamily="ui-monospace, monospace"
                    pointerEvents="none"
                  >
                    {m.id}
                  </text>
                </g>
              )
            })}

            {/* Ground / rim */}
            <path
              d={plot.groundPath}
              fill="none"
              stroke="#a8a29e"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              pointerEvents="none"
            />

            {/* Water surface */}
            {plot.wsPath && (
              <path
                d={plot.wsPath}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2}
                pointerEvents="none"
              />
            )}

            {/* HGL */}
            {plot.hglPath && (
              <path
                d={plot.hglPath}
                fill="none"
                stroke="#fb7185"
                strokeWidth={1.75}
                strokeDasharray="6 3"
                pointerEvents="none"
              />
            )}

            {/* Box-zoom selection */}
            {dragStart != null && dragEnd != null && (
              <rect
                x={Math.min(plot.sx(dragStart), plot.sx(dragEnd))}
                y={PAD.top}
                width={Math.abs(plot.sx(dragEnd) - plot.sx(dragStart))}
                height={plot.ih}
                fill="#38bdf8"
                fillOpacity={0.15}
                stroke="#38bdf8"
                strokeOpacity={0.5}
                strokeWidth={1}
                pointerEvents="none"
              />
            )}
          </g>

          {!plot.hasResults && (
            <text x={PAD.left + 8} y={PAD.top + 14} fill="#64748b" fontSize={10}>
              Geometry only — run simulation / scrub time for water & HGL
            </text>
          )}
        </svg>
      )}

      {/* Hover tooltip */}
      {hover && plot && (
        <div
          className="pointer-events-none absolute z-10 min-w-[140px] rounded-lg border border-border bg-elevated/95 px-2.5 py-1.5 text-[11px] shadow-[var(--shadow-panel)] backdrop-blur"
          style={{
            left: Math.min(Math.max(hover.x + 10, 8), width - 160),
            top: Math.max(hover.y - 8, 4),
          }}
        >
          <div className="font-semibold text-fg">
            {hover.kind === 'node' ? 'Node' : 'Link'} {hover.id}
          </div>
          {hover.kind === 'node' ? (
            <div className="mt-0.5 space-y-0.5 text-muted">
              <div>Invert {fmt(hover.elevation)}</div>
              <div>Rim {fmt(hover.ground)}</div>
              {hover.water != null && <div>Water {fmt(hover.water)}</div>}
              {hover.hgl != null && <div>HGL {fmt(hover.hgl)}</div>}
            </div>
          ) : (
            <div className="mt-0.5 space-y-0.5 text-muted">
              <div>
                Invert {fmt(hover.invertUs)} → {fmt(hover.invertDs)}
              </div>
              {hover.diameter != null && <div>Dia {fmt(hover.diameter)}</div>}
            </div>
          )}
        </div>
      )}

      {plot && legend}
    </div>
  )

  if (embedded) {
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm">Profile</strong>
          {controls}
        </div>
        {chart}
      </div>
    )
  }

  return (
    <Panel title="Profile">
      <div className="mb-2">{controls}</div>
      {chart}
    </Panel>
  )
}
