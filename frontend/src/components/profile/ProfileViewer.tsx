/**
 * Long-section (hydraulic profile) between two nodes, optionally through via
 * nodes: ground, manholes, pipes, water at the shown time, the highest water
 * level over the run, surcharge and flooding. A crosshair reads values at any
 * chainage; the table and CSV/PNG export give the numbers.
 */

import { ArrowLeftRight, Crosshair, Download, Maximize2, Minimize2, MousePointerClick, RotateCcw, Table2, Waves, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileLink, ProfileNode, ProfileResponse } from '../../api/client'
import { downloadText, safeName, toCsv } from '../../lib/exportFiles'
import { useResolvedTheme } from '../../lib/theme'
import { Button } from '../ui'

interface ProfileViewerProps {
  profile: ProfileResponse | undefined
  start: string
  end: string
  via?: string[]
  onStartChange: (id: string) => void
  onEndChange: (id: string) => void
  onViaChange?: (via: string[]) => void
  onPickMode: (mode: 'start' | 'end' | null) => void
  pickMode: 'start' | 'end' | null
  /** Node IDs for the start/end search. */
  nodeIds?: string[]
  /** Fill in the end as the outfall downstream of the start. */
  onToOutfall?: () => void
  loading?: boolean
  error?: string | null
  embedded?: boolean
  timeLabel?: string | null
  onSelect?: (sel: { object_type: 'node' | 'link'; id: string }) => void
}

const PAD = { top: 34, right: 18, bottom: 40, left: 62 }

type Palette = Record<'bg' | 'grid' | 'axis' | 'text' | 'muted' | 'soil' | 'soilLine' | 'ground' | 'pipe' | 'pipeLine' | 'mh' | 'mhLine' | 'water' | 'waterLine' | 'surcharge' | 'maxHgl' | 'flood' | 'hover' | 'select', string>

const DARK: Palette = {
  bg: '#0b1220', grid: '#1b2434', axis: '#334155', text: '#cbd5e1', muted: '#7c8aa0', soil: '#3a2c1d', soilLine: '#8a7156',
  ground: '#a1866a', pipe: '#1e293b', pipeLine: '#94a3b8', mh: '#111827', mhLine: '#94a3b8', water: '#0ea5e9', waterLine: '#7dd3fc',
  surcharge: '#ef4444', maxHgl: '#f59e0b', flood: '#f97316', hover: '#38bdf8', select: '#f472b6',
}
const LIGHT: Palette = {
  bg: '#ffffff', grid: '#e8edf3', axis: '#b8c2cf', text: '#253246', muted: '#5b6777', soil: '#e9dcc8', soilLine: '#a08463',
  ground: '#7c5f3f', pipe: '#f1f5f9', pipeLine: '#475569', mh: '#e2e8f0', mhLine: '#475569', water: '#0284c7', waterLine: '#0369a1',
  surcharge: '#dc2626', maxHgl: '#d97706', flood: '#ea580c', hover: '#0284c7', select: '#db2777',
}

function niceStep(span: number, target = 6) {
  if (!(span > 0)) return 1
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}
function ticks(min: number, max: number, step: number) {
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}
const f = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d)

/** Value of a piecewise-linear node series at chainage x. */
function interpNodes(nodes: ProfileNode[], x: number, pick: (n: ProfileNode) => number | null | undefined) {
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i]
    const b = nodes[i + 1]
    if (x >= a.distance - 1e-9 && x <= b.distance + 1e-9) {
      const va = pick(a)
      const vb = pick(b)
      if (va == null || vb == null) return null
      const t = b.distance > a.distance ? (x - a.distance) / (b.distance - a.distance) : 0
      return va + (vb - va) * t
    }
  }
  return null
}
function linkAt(links: ProfileLink[], x: number) {
  return links.find((l) => x >= l.start_distance - 1e-9 && x <= l.end_distance + 1e-9) ?? null
}

export function ProfileViewer({
  profile,
  start,
  end,
  via = [],
  onStartChange,
  onEndChange,
  onViaChange,
  onPickMode,
  pickMode,
  nodeIds = [],
  onToOutfall,
  loading,
  error,
  embedded = false,
  timeLabel,
  onSelect,
}: ProfileViewerProps) {
  const theme = useResolvedTheme()
  const C = theme === 'light' ? LIGHT : DARK
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(800)
  const [tall, setTall] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [xDomain, setXDomain] = useState<[number, number] | null>(null)
  const [drag, setDrag] = useState<[number, number] | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const dragging = useRef(false)
  const unit = profile?.length_unit ?? 'm'
  const flowUnit = profile?.flow_unit ?? ''
  const diaText = (d: number | null | undefined) =>
    d == null ? '' : unit === 'ft' ? `${Math.round(d * 12)} in` : `${Math.round(d * 1000)} mm`

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width
      if (w && w > 120) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pathKey = profile ? `${profile.path_node_ids.join(',')}` : ''
  useEffect(() => {
    setXDomain(null)
    setCursor(null)
  }, [pathKey])

  const height = tall ? 460 : embedded ? 300 : 340
  const total = Math.max(profile?.total_length ?? 1, 1e-6)
  const [x0, x1] = xDomain ?? [0, total]

  const plot = useMemo(() => {
    if (!profile || !profile.nodes.length) return null
    const { nodes, links } = profile
    const vis = (d: number) => d >= x0 - 1e-6 && d <= x1 + 1e-6
    const ys: number[] = []
    for (const n of nodes) {
      if (!vis(n.distance)) continue
      ys.push(n.elevation, n.ground ?? n.elevation)
      if (n.hgl != null) ys.push(n.hgl)
      if (n.max_hgl != null) ys.push(n.max_hgl)
    }
    for (const l of links) {
      if (l.end_distance < x0 || l.start_distance > x1) continue
      ys.push(l.invert_us, l.invert_ds, l.crown_us ?? l.invert_us, l.crown_ds ?? l.invert_ds)
    }
    if (!ys.length) nodes.forEach((n) => ys.push(n.elevation, n.ground ?? n.elevation))
    const lo = Math.min(...ys)
    const hi = Math.max(...ys)
    const pad = Math.max((hi - lo) * 0.1, unit === 'ft' ? 1 : 0.3)
    const yMin = lo - pad * 0.6
    const yMax = hi + pad
    const iw = Math.max(width - PAD.left - PAD.right, 60)
    const ih = Math.max(height - PAD.top - PAD.bottom, 60)
    const sx = (d: number) => PAD.left + ((d - x0) / Math.max(x1 - x0, 1e-9)) * iw
    const sy = (e: number) => PAD.top + ((yMax - e) / (yMax - yMin || 1)) * ih
    const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')

    const ground = path(nodes.map((n) => [sx(n.distance), sy(n.ground ?? n.elevation)]))
    const soil = `${ground} L${sx(nodes[nodes.length - 1].distance)} ${PAD.top + ih} L${sx(nodes[0].distance)} ${PAD.top + ih} Z`

    const pipes = links.map((l) => {
      const cu = l.crown_us ?? l.invert_us + (l.diameter ?? 0.3)
      const cd = l.crown_ds ?? l.invert_ds + (l.diameter ?? 0.3)
      const a = sx(l.start_distance)
      const b = sx(l.end_distance)
      const n0 = nodes.find((n) => n.distance === l.start_distance)
      const n1 = nodes.find((n) => n.distance === l.end_distance)
      // water inside the pipe: from invert up to min(HGL, crown)
      let water: string | null = null
      let surcharged = false
      if (n0?.hgl != null && n1?.hgl != null) {
        const w0 = Math.min(Math.max(n0.hgl, l.invert_us), cu)
        const w1 = Math.min(Math.max(n1.hgl, l.invert_ds), cd)
        surcharged = n0.hgl > cu + 1e-6 || n1.hgl > cd + 1e-6
        if (w0 > l.invert_us + 1e-6 || w1 > l.invert_ds + 1e-6)
          water = `M${a} ${sy(l.invert_us)} L${b} ${sy(l.invert_ds)} L${b} ${sy(w1)} L${a} ${sy(w0)} Z`
      }
      const slope = l.length > 0 ? ((l.invert_us - l.invert_ds) / l.length) * 100 : null
      return {
        l, a, b, surcharged, water, slope,
        shell: `M${a} ${sy(l.invert_us)} L${b} ${sy(l.invert_ds)} L${b} ${sy(cd)} L${a} ${sy(cu)} Z`,
        invert: `M${a} ${sy(l.invert_us)} L${b} ${sy(l.invert_ds)}`,
        crown: `M${a} ${sy(cu)} L${b} ${sy(cd)}`,
        mid: [(a + b) / 2, (sy(l.invert_us) + sy(l.invert_ds)) / 2] as [number, number],
      }
    })
    const mhW = Math.max(5, Math.min(12, iw / Math.max(nodes.length * 4, 1)))
    const manholes = nodes.map((n) => {
      const g = n.ground ?? n.elevation
      const cx = sx(n.distance)
      const flooded = (n.flooding ?? 0) > 1e-6 || (n.hgl != null && n.hgl >= g - 1e-3 && (n.max_depth ?? 0) > 0)
      const waterTop = n.hgl != null && n.hgl > n.elevation ? sy(Math.min(n.hgl, g)) : null
      return { n, cx, g, flooded, waterTop, w: mhW, x: cx - mhW / 2, yInv: sy(n.elevation), yRim: sy(g), outfall: n.node_kind === 'outfall', storage: n.node_kind === 'storage' }
    })
    const withHgl = nodes.filter((n) => n.hgl != null)
    const hgl = withHgl.length > 1 ? path(withHgl.map((n) => [sx(n.distance), sy(n.hgl!)])) : null
    const withMax = nodes.filter((n) => n.max_hgl != null)
    const maxHgl = withMax.length > 1 ? path(withMax.map((n) => [sx(n.distance), sy(n.max_hgl!)])) : null
    let minGap = Infinity
    for (let i = 1; i < manholes.length; i++) minGap = Math.min(minGap, manholes[i].cx - manholes[i - 1].cx)
    const labelEvery = minGap < 18 ? Math.ceil(18 / Math.max(minGap, 1)) : 1
    const rotate = minGap < 46
    return {
      iw, ih, sx, sy, yMin, yMax, ground, soil, pipes, manholes, hgl, maxHgl, labelEvery, rotate,
      xTicks: ticks(x0, x1, niceStep(x1 - x0, Math.max(3, Math.round(iw / 110)))),
      yTicks: ticks(yMin, yMax, niceStep(yMax - yMin, Math.max(3, Math.round(ih / 45)))),
      hasResults: withHgl.length > 0,
      hasMax: withMax.length > 0,
    }
  }, [profile, width, height, x0, x1, unit])

  const distAt = useCallback(
    (clientX: number) => {
      if (!plot || !wrapRef.current) return null
      const r = wrapRef.current.getBoundingClientRect()
      const t = (clientX - r.left - PAD.left) / plot.iw
      if (t < -0.01 || t > 1.01) return null
      return x0 + Math.min(1, Math.max(0, t)) * (x1 - x0)
    },
    [plot, x0, x1],
  )

  // wheel zoom around the pointer
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const c = distAt(e.clientX)
      if (c == null) return
      e.preventDefault()
      const span = x1 - x0
      const next = Math.min(total, Math.max(total * 0.01, span * (e.deltaY > 0 ? 1.25 : 0.8)))
      if (next >= total) return setXDomain(null)
      const r = (c - x0) / span
      let lo = c - next * r
      let hi = lo + next
      if (lo < 0) [lo, hi] = [0, next]
      if (hi > total) [lo, hi] = [total - next, total]
      setXDomain([lo, hi])
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [distAt, x0, x1, total])

  const readout = useMemo(() => {
    if (cursor == null || !profile) return null
    const { nodes, links } = profile
    const l = linkAt(links, cursor)
    const t = l && l.end_distance > l.start_distance ? (cursor - l.start_distance) / (l.end_distance - l.start_distance) : 0
    const invert = l ? l.invert_us + (l.invert_ds - l.invert_us) * t : null
    const crown = l ? (l.crown_us ?? l.invert_us) + ((l.crown_ds ?? l.invert_ds) - (l.crown_us ?? l.invert_us)) * t : null
    const ground = interpNodes(nodes, cursor, (n) => n.ground ?? n.elevation)
    const hgl = interpNodes(nodes, cursor, (n) => n.hgl)
    const maxHgl = interpNodes(nodes, cursor, (n) => n.max_hgl)
    const near = nodes.reduce((b, n) => (Math.abs(n.distance - cursor) < Math.abs(b.distance - cursor) ? n : b), nodes[0])
    return { l, invert, crown, ground, hgl, maxHgl, near }
  }, [cursor, profile])

  const exportCsv = () => {
    if (!profile) return
    const rows = [
      ...profile.nodes.map((n) => ['node', n.id, n.node_kind ?? '', n.distance, n.elevation, n.ground, n.hgl, n.max_hgl, n.hgl != null && n.ground != null ? n.ground - n.hgl : null, '', '', '', '']),
      ...profile.links.map((l) => ['link', l.id, l.link_kind ?? '', l.start_distance, l.invert_us, '', '', '', '', l.length, l.diameter, l.length > 0 ? ((l.invert_us - l.invert_ds) / l.length) * 100 : '', l.max_flow ?? '']),
    ]
    downloadText(
      `long-section_${safeName(profile.start)}_${safeName(profile.end)}.csv`,
      toCsv(
        ['Type', 'ID', 'Kind', `Chainage (${unit})`, `Invert (${unit})`, `Rim (${unit})`, `Water level (${unit})`, `Max water level (${unit})`, `Freeboard (${unit})`, `Length (${unit})`, `Diameter (${unit})`, 'Slope (%)', `Peak flow (${flowUnit})`],
        rows,
      ),
    )
  }

  const exportPng = () => {
    const svg = svgRef.current
    if (!svg || !profile) return
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
    img.onload = () => {
      const scale = 2
      const c = document.createElement('canvas')
      c.width = svg.clientWidth * scale
      c.height = svg.clientHeight * scale
      const ctx = c.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      c.toBlob((b) => {
        if (!b) return
        const a = document.createElement('a')
        a.href = URL.createObjectURL(b)
        a.download = `long-section_${safeName(profile.start)}_${safeName(profile.end)}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      })
    }
    img.src = url
  }

  const listId = 'profile-node-ids'
  const input = 'h-7 w-28 rounded-md border border-border-strong bg-surface px-2 font-mono text-xs text-fg outline-none focus:border-accent'
  const controls = (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <datalist id={listId}>
        {nodeIds.slice(0, 5000).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <label className="inline-flex items-center gap-1 text-muted">
        From
        <input value={start} list={listId} onChange={(e) => onStartChange(e.target.value.trim())} className={input} aria-label="Start node" />
      </label>
      {via.map((v, i) => (
        <span key={`${v}-${i}`} className="inline-flex items-center gap-0.5 rounded-md border border-border bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-fg-soft">
          via {v}
          <button type="button" aria-label={`Remove via ${v}`} className="text-muted hover:text-fg" onClick={() => onViaChange?.(via.filter((_, j) => j !== i))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <label className="inline-flex items-center gap-1 text-muted">
        To
        <input value={end} list={listId} onChange={(e) => onEndChange(e.target.value.trim())} className={input} aria-label="End node" />
      </label>
      <Button
        size="sm"
        variant={pickMode ? 'primary' : 'outline'}
        onClick={() => onPickMode(pickMode ? null : 'start')}
        title="Click the start node and then the end node on the map. Shift-click nodes in between to route through them."
      >
        <MousePointerClick className="h-3.5 w-3.5" /> {pickMode ? `Click the ${pickMode} node…` : 'Pick on map'}
      </Button>
      {onToOutfall && (
        <Button size="sm" variant="ghost" disabled={!start} onClick={onToOutfall} title="End at the outfall downstream of the start node">
          To outfall
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={!start || !end}
        onClick={() => {
          onStartChange(end)
          onEndChange(start)
          onViaChange?.([...via].reverse())
        }}
        title="Swap start and end"
        aria-label="Swap start and end"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </Button>
      {loading && <span className="text-[11px] text-muted">Updating…</span>}
      <span className="ml-auto inline-flex items-center gap-1">
        {xDomain && (
          <Button size="sm" variant="ghost" onClick={() => setXDomain(null)} title="Show the whole length">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant={showTable ? 'primary' : 'ghost'} disabled={!profile} onClick={() => setShowTable((s) => !s)} title="Show the values in a table">
          <Table2 className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" disabled={!profile} onClick={exportCsv} title="Download the long-section as CSV">
          <Download className="h-3.5 w-3.5" /> CSV
        </Button>
        <Button size="sm" variant="ghost" disabled={!profile} onClick={exportPng} title="Download the drawing as PNG">
          PNG
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setTall((t) => !t)} title={tall ? 'Smaller' : 'Taller'} aria-label={tall ? 'Make the drawing smaller' : 'Make the drawing taller'}>
          {tall ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </span>
    </div>
  )

  const summary = profile && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      <span className="font-mono text-fg-soft">
        {profile.nodes[0]?.id} → {profile.nodes[profile.nodes.length - 1]?.id}
      </span>
      <span>
        {profile.total_length.toFixed(unit === 'ft' ? 0 : 1)} {unit} · {profile.links.length} links · {profile.nodes.length} nodes
      </span>
      {profile.links.some((l) => l.reversed) && <span className="text-amber-300">Path runs against the flow direction on some links</span>}
      {timeLabel && plot?.hasResults && (
        <span className="inline-flex items-center gap-1 text-accent-soft">
          <Waves className="h-3 w-3" /> {timeLabel}
        </span>
      )}
    </div>
  )

  const legendItem = (color: string, label: string, kind: 'fill' | 'line' | 'dash' = 'line') => (
    <span className="inline-flex items-center gap-1">
      <svg width="16" height="8" aria-hidden>
        {kind === 'fill' ? <rect width="16" height="8" rx="1.5" fill={color} /> : <line x1="0" y1="4" x2="16" y2="4" stroke={color} strokeWidth="2" strokeDasharray={kind === 'dash' ? '4 2' : undefined} />}
      </svg>
      {label}
    </span>
  )

  const chart = (
    <div ref={wrapRef} className="relative w-full select-none">
      {error && <p className="m-0 py-2 text-sm text-danger">{error}</p>}
      {!profile && !loading && !error && (
        <div className="flex flex-col items-center gap-1 py-8 text-center text-sm text-muted">
          <Crosshair className="h-5 w-5" />
          <span>Choose a start and end node, or right-click a node on the map for “Long-section to outfall”.</span>
        </div>
      )}
      {plot && profile && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="block max-w-full"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`Long-section from ${profile.start} to ${profile.end}`}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          onMouseDown={(e) => {
            if (e.button !== 0 || (e.target as Element).closest?.('[data-el]')) return
            const d = distAt(e.clientX)
            if (d == null) return
            dragging.current = true
            setDrag([d, d])
          }}
          onMouseMove={(e) => {
            const d = distAt(e.clientX)
            setCursor(d)
            if (dragging.current && d != null) setDrag((g) => (g ? [g[0], d] : g))
          }}
          onMouseUp={() => {
            if (!dragging.current) return
            dragging.current = false
            if (drag && Math.abs(drag[1] - drag[0]) > total * 0.01) setXDomain([Math.min(...drag), Math.max(...drag)])
            setDrag(null)
          }}
          onMouseLeave={() => {
            dragging.current = false
            setDrag(null)
            setCursor(null)
          }}
          onDoubleClick={() => setXDomain(null)}
        >
          <defs>
            <clipPath id="pv-clip">
              <rect x={PAD.left} y={PAD.top} width={plot.iw} height={plot.ih} />
            </clipPath>
            <pattern id="pv-soil" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" fill={C.soil} />
              <line x1="0" y1="0" x2="0" y2="8" stroke={C.soilLine} strokeWidth="1.2" opacity="0.5" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={width} height={height} fill={C.bg} />
          {plot.yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.left} x2={PAD.left + plot.iw} y1={plot.sy(v)} y2={plot.sy(v)} stroke={C.grid} />
              <text x={PAD.left - 7} y={plot.sy(v)} textAnchor="end" dominantBaseline="middle" fill={C.muted} fontSize="10">
                {Number.isInteger(v) ? v : v.toFixed(1)}
              </text>
            </g>
          ))}
          {plot.xTicks.map((v) => (
            <g key={`x${v}`}>
              <line x1={plot.sx(v)} x2={plot.sx(v)} y1={PAD.top} y2={PAD.top + plot.ih} stroke={C.grid} />
              <text x={plot.sx(v)} y={PAD.top + plot.ih + 14} textAnchor="middle" fill={C.muted} fontSize="10">
                {v >= 100 ? v.toFixed(0) : v.toFixed(1)}
              </text>
            </g>
          ))}
          <text x={14} y={PAD.top + plot.ih / 2} transform={`rotate(-90 14 ${PAD.top + plot.ih / 2})`} textAnchor="middle" fill={C.muted} fontSize="10.5">
            Elevation ({unit})
          </text>
          <text x={PAD.left + plot.iw / 2} y={height - 6} textAnchor="middle" fill={C.muted} fontSize="10.5">
            Chainage ({unit})
          </text>

          <g clipPath="url(#pv-clip)">
            <path d={plot.soil} fill="url(#pv-soil)" opacity="0.9" />
            {plot.pipes.map((p) => (
              <g
                key={p.l.id}
                data-el="link"
                style={{ cursor: onSelect ? 'pointer' : undefined }}
                onClick={() => onSelect?.({ object_type: 'link', id: p.l.id })}
              >
                <path d={p.shell} fill={C.pipe} stroke="none" />
                {p.water && <path d={p.water} fill={p.surcharged ? C.surcharge : C.water} opacity="0.85" />}
                <path d={p.invert} stroke={C.pipeLine} strokeWidth="1.6" fill="none" />
                <path d={p.crown} stroke={C.pipeLine} strokeWidth="1" fill="none" opacity="0.8" />
              </g>
            ))}
            <path d={plot.ground} stroke={C.ground} strokeWidth="2" fill="none" strokeLinejoin="round" />
            {plot.manholes.map((m) => (
              <g key={m.n.id} data-el="node" style={{ cursor: onSelect ? 'pointer' : undefined }} onClick={() => onSelect?.({ object_type: 'node', id: m.n.id })}>
                {m.outfall ? (
                  <path d={`M${m.cx - 6} ${m.yInv} L${m.cx + 6} ${m.yInv} L${m.cx} ${m.yInv - 9} Z`} fill={C.mhLine} />
                ) : (
                  <>
                    <rect x={m.x} y={m.yRim} width={m.w} height={Math.max(m.yInv - m.yRim, 1)} fill={m.storage ? C.maxHgl : C.mh} fillOpacity={m.storage ? 0.25 : 1} stroke={C.mhLine} strokeWidth="1" />
                    {m.waterTop != null && <rect x={m.x + 1} y={m.waterTop} width={m.w - 2} height={Math.max(m.yInv - m.waterTop, 0)} fill={C.water} opacity="0.85" />}
                  </>
                )}
                {m.flooded && (
                  <g>
                    <path d={`M${m.cx} ${m.yRim - 14} c -4 6 -5 8 -5 10 a5 5 0 0 0 10 0 c0 -2 -1 -4 -5 -10 z`} fill={C.flood} />
                    <title>Flooding at {m.n.id}</title>
                  </g>
                )}
              </g>
            ))}
            {plot.maxHgl && <path d={plot.maxHgl} stroke={C.maxHgl} strokeWidth="1.6" strokeDasharray="6 3" fill="none" pointerEvents="none" />}
            {plot.hgl && <path d={plot.hgl} stroke={C.waterLine} strokeWidth="2" fill="none" pointerEvents="none" />}
            {drag && (
              <rect x={plot.sx(Math.min(...drag))} y={PAD.top} width={Math.abs(plot.sx(drag[1]) - plot.sx(drag[0]))} height={plot.ih} fill={C.hover} opacity="0.12" />
            )}
            {cursor != null && !drag && <line x1={plot.sx(cursor)} x2={plot.sx(cursor)} y1={PAD.top} y2={PAD.top + plot.ih} stroke={C.hover} strokeWidth="1" strokeDasharray="3 3" pointerEvents="none" />}
          </g>
          <rect x={PAD.left} y={PAD.top} width={plot.iw} height={plot.ih} fill="none" stroke={C.axis} />
          {/* node labels above the plot */}
          {plot.manholes.map((m, i) =>
            i % plot.labelEvery === 0 || i === plot.manholes.length - 1 ? (
              <text
                key={`l${m.n.id}`}
                x={m.cx}
                y={PAD.top - 6}
                fill={C.text}
                fontSize="9.5"
                fontFamily="ui-monospace, monospace"
                textAnchor={plot.rotate ? 'start' : 'middle'}
                transform={plot.rotate ? `rotate(-35 ${m.cx} ${PAD.top - 6})` : undefined}
                style={{ display: m.cx < PAD.left - 1 || m.cx > PAD.left + plot.iw + 1 ? 'none' : undefined }}
              >
                {m.n.id}
              </text>
            ) : null,
          )}
          {!plot.hasResults && (
            <text x={PAD.left + 8} y={PAD.top + 16} fill={C.muted} fontSize="10.5">
              Geometry only. Run the model (or pick a time) to see water levels.
            </text>
          )}
        </svg>
      )}

      {readout && plot && cursor != null && (
        <div
          className="pointer-events-none absolute z-10 w-52 rounded-lg border border-border bg-elevated/95 px-2.5 py-2 text-[11px] shadow-[var(--shadow-panel)] backdrop-blur"
          style={{ left: Math.min(plot.sx(cursor) + 12, width - 220), top: PAD.top + 6 }}
        >
          <div className="mb-1 flex justify-between font-medium text-fg">
            <span>Chainage {cursor.toFixed(unit === 'ft' ? 0 : 1)} {unit}</span>
          </div>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums text-muted">
            {readout.l && (
              <>
                <dt>Link</dt>
                <dd className="m-0 text-right font-mono text-fg-soft">{readout.l.id}</dd>
                <dt>Size</dt>
                <dd className="m-0 text-right">{diaText(readout.l.diameter)}{readout.l.shape && readout.l.shape !== 'CIRCULAR' ? ` ${readout.l.shape.toLowerCase()}` : ''}</dd>
                <dt>Slope</dt>
                <dd className="m-0 text-right">{readout.l.length > 0 ? `${(((readout.l.invert_us - readout.l.invert_ds) / readout.l.length) * 100).toFixed(2)} %` : '—'}</dd>
              </>
            )}
            <dt>Ground</dt>
            <dd className="m-0 text-right">{f(readout.ground)}</dd>
            <dt>Invert</dt>
            <dd className="m-0 text-right">{f(readout.invert)}</dd>
            {readout.ground != null && readout.crown != null && (
              <>
                <dt>Cover</dt>
                <dd className="m-0 text-right">{f(readout.ground - readout.crown)}</dd>
              </>
            )}
            {readout.hgl != null && (
              <>
                <dt className="text-sky-300">Water level</dt>
                <dd className="m-0 text-right text-fg-soft">{f(readout.hgl)}</dd>
                {readout.invert != null && (
                  <>
                    <dt>Depth</dt>
                    <dd className="m-0 text-right">{f(readout.hgl - readout.invert)}</dd>
                  </>
                )}
              </>
            )}
            {readout.maxHgl != null && (
              <>
                <dt className="text-amber-300">Max level</dt>
                <dd className="m-0 text-right">{f(readout.maxHgl)}</dd>
              </>
            )}
            {readout.l?.flow != null && (
              <>
                <dt>Flow</dt>
                <dd className="m-0 text-right">{f(readout.l.flow, 3)} {flowUnit}</dd>
              </>
            )}
            {readout.l?.max_flow != null && (
              <>
                <dt>Peak flow</dt>
                <dd className="m-0 text-right">{f(readout.l.max_flow, 3)} {flowUnit}</dd>
              </>
            )}
            <dt>Nearest node</dt>
            <dd className="m-0 text-right font-mono text-fg-soft">{readout.near.id}</dd>
          </dl>
        </div>
      )}

      {plot && profile && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
          {legendItem(C.ground, 'Ground')}
          {legendItem(C.pipeLine, 'Pipe')}
          {plot.hasResults && legendItem(C.water, 'Water', 'fill')}
          {plot.hasResults && legendItem(C.waterLine, 'Water level now')}
          {plot.hasMax && legendItem(C.maxHgl, 'Highest level in the run', 'dash')}
          {plot.hasResults && legendItem(C.surcharge, 'Surcharged', 'fill')}
          {plot.hasResults && legendItem(C.flood, 'Flooding', 'fill')}
          <span className="ml-auto">Scroll or drag to zoom · double-click to reset · click a pipe or manhole to select it</span>
        </div>
      )}

      {showTable && profile && (
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="sticky top-0 bg-elevated text-left text-muted">
              <tr>
                {['Node', 'Chainage', 'Invert', 'Rim', 'Water level', 'Max level', 'Freeboard (max)', 'Next link', 'Size', 'Slope %', 'Peak flow'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.nodes.map((n, i) => {
                const l = profile.links[i]
                const fb = n.max_hgl != null && n.ground != null ? n.ground - n.max_hgl : null
                return (
                  <tr key={n.id} className="border-t border-border/50">
                    <td className="px-2 py-1 font-mono">
                      <button type="button" className="text-accent-soft hover:underline" onClick={() => onSelect?.({ object_type: 'node', id: n.id })}>
                        {n.id}
                      </button>
                    </td>
                    <td className="px-2 py-1">{f(n.distance, 1)}</td>
                    <td className="px-2 py-1">{f(n.elevation)}</td>
                    <td className="px-2 py-1">{f(n.ground)}</td>
                    <td className="px-2 py-1">{f(n.hgl)}</td>
                    <td className="px-2 py-1">{f(n.max_hgl)}</td>
                    <td className={`px-2 py-1 ${fb != null && fb < 0.001 ? 'text-orange-400' : ''}`}>{f(fb)}</td>
                    <td className="px-2 py-1 font-mono">
                      {l && (
                        <button type="button" className="text-accent-soft hover:underline" onClick={() => onSelect?.({ object_type: 'link', id: l.id })}>
                          {l.id}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1">{l ? diaText(l.diameter) : ''}</td>
                    <td className="px-2 py-1">{l && l.length > 0 ? (((l.invert_us - l.invert_ds) / l.length) * 100).toFixed(2) : ''}</td>
                    <td className="px-2 py-1">{l?.max_flow != null ? f(l.max_flow, 3) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  return (
    <div className="rounded-xl border border-border bg-surface/40 p-2.5">
      <div className="mb-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <strong className="text-sm text-fg">Long-section</strong>
          {summary}
        </div>
        {controls}
      </div>
      {chart}
    </div>
  )
}
