import { useMemo, useRef, useState, useEffect } from 'react'
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
}

const PAD = { top: 28, right: 16, bottom: 44, left: 52 }

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
}: ProfileViewerProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)

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

  const height = embedded ? 220 : 260

  const plot = useMemo(() => {
    if (!profile || profile.nodes.length < 1) return null
    const nodes = profile.nodes
    const links = profile.links

    const elevs: number[] = []
    for (const n of nodes) {
      elevs.push(n.elevation, n.ground ?? n.elevation)
      if (n.water_surface != null) elevs.push(n.water_surface)
      if (n.hgl != null) elevs.push(n.hgl)
    }
    for (const L of links) {
      elevs.push(L.invert_us, L.invert_ds)
      if (L.crown_us != null) elevs.push(L.crown_us)
      if (L.crown_ds != null) elevs.push(L.crown_ds)
    }
    const rawMin = Math.min(...elevs)
    const rawMax = Math.max(...elevs)
    const padY = Math.max((rawMax - rawMin) * 0.12, 0.4)
    const yMin = rawMin - padY
    const yMax = rawMax + padY
    const xMin = 0
    const xMax = Math.max(profile.total_length, 1)

    const iw = Math.max(width - PAD.left - PAD.right, 40)
    const ih = Math.max(height - PAD.top - PAD.bottom, 40)
    const sx = (d: number) => PAD.left + (d / xMax) * iw
    const sy = (e: number) => PAD.top + ((yMax - e) / (yMax - yMin || 1)) * ih

    const yStep = niceStep(yMax - yMin)
    const xStep = niceStep(xMax)
    const yTicks = ticks(yMin, yMax, yStep)
    const xTicks = ticks(xMin, xMax, xStep)

    // Manhole half-width in distance units (screen-ish)
    const mhHalf = Math.min(Math.max(xMax * 0.008, 0.4), xMax * 0.03)

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
        L,
        crownUs,
        crownDs,
      }
    })

    // Water fill inside pipes (linear interpolate HGL/WS between nodes)
    const waterFills = links.map((L, i) => {
      const n0 = nodes[i]
      const n1 = nodes[i + 1]
      const w0 = n0?.water_surface ?? n0?.hgl
      const w1 = n1?.water_surface ?? n1?.hgl
      if (w0 == null || w1 == null) return null
      const crownUs = L.crown_us ?? L.invert_us + (L.diameter ?? 0.3)
      const crownDs = L.crown_ds ?? L.invert_ds + (L.diameter ?? 0.3)
      // Water elev at ends, but fill only above invert (and can surcharge above crown)
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
        invertY: yInv,
        rimY: yRim,
        cx: sx(n.distance),
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
      xMax,
      iw,
      ih,
      hasResults: nodes.some((n) => n.water_surface != null || n.hgl != null),
    }
  }, [profile, width, height])

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
    </div>
  )

  const legend = (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm border border-[#64748b]/80 bg-[#94a3b8]/35" />
        Pipe
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2 rounded-[1px] border border-[#475569] bg-[#1e293b]/80" />
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
        <span className="h-0.5 w-3 bg-[#e11d48]" />
        HGL
      </span>
    </div>
  )

  const chart = (
    <div ref={wrapRef} className="w-full">
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
        >
          <defs>
            <linearGradient id="pipeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#cbd5e1" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#64748b" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="waterFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.75" />
            </linearGradient>
            <linearGradient id="waterSurcharge" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f472b6" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.7" />
            </linearGradient>
          </defs>

          {/* Grid */}
          {plot.yTicks.map((v) => (
            <g key={`y-${v}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plot.iw}
                y1={plot.sy(v)}
                y2={plot.sy(v)}
                stroke="#334155"
                strokeDasharray="3 3"
                strokeOpacity={0.7}
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
                stroke="#334155"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
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

          {/* Pipes */}
          {plot.pipePolys.map((p) => (
            <g key={`pipe-${p.id}`}>
              <polygon
                points={p.points}
                fill="url(#pipeFill)"
                stroke="#64748b"
                strokeWidth={1}
              />
              <path d={p.invertPath} stroke="#e2e8f0" strokeWidth={1.5} fill="none" />
              <path d={p.crownPath} stroke="#94a3b8" strokeWidth={1} fill="none" />
            </g>
          ))}

          {/* Water in pipes */}
          {plot.waterFills.map(
            (w) =>
              w && (
                <polygon
                  key={`water-${w.id}`}
                  points={w.points}
                  fill={w.surcharged ? 'url(#waterSurcharge)' : 'url(#waterFill)'}
                  opacity={0.9}
                />
              ),
          )}

          {/* Junction structures */}
          {plot.manholes.map((m) => (
            <g key={`mh-${m.id}`}>
              <polygon
                points={m.structure}
                fill="#0f172a"
                stroke="#94a3b8"
                strokeWidth={1.25}
                opacity={0.92}
              />
              {m.waterFill && (
                <polygon points={m.waterFill} fill="url(#waterFill)" opacity={0.85} />
              )}
              <text
                x={m.labelX}
                y={m.labelY}
                textAnchor="middle"
                fill="#cbd5e1"
                fontSize={9}
                fontFamily="ui-monospace, monospace"
              >
                {m.id}
              </text>
            </g>
          ))}

          {/* Ground / rim */}
          <path
            d={plot.groundPath}
            fill="none"
            stroke="#a8a29e"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />

          {/* Water surface */}
          {plot.wsPath && (
            <path d={plot.wsPath} fill="none" stroke="#38bdf8" strokeWidth={2} />
          )}

          {/* HGL */}
          {plot.hglPath && (
            <path
              d={plot.hglPath}
              fill="none"
              stroke="#e11d48"
              strokeWidth={1.75}
              strokeDasharray="6 3"
            />
          )}

          {!plot.hasResults && (
            <text
              x={PAD.left + 8}
              y={PAD.top + 14}
              fill="#64748b"
              fontSize={10}
            >
              Geometry only — run simulation / scrub time for water & HGL
            </text>
          )}
        </svg>
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
