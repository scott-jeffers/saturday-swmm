/** A static SVG plan of the network in model coordinates, with per-element colours. For reports and comparisons. */
import { useMemo, type JSX } from 'react'
import type { Feature, Position } from 'geojson'
import type { ModelNetwork } from '../api/client'

type Kind = 'node' | 'link' | 'subcatchment'

export function NetworkPlan({
  network,
  colorFor,
  width = 720,
  height = 420,
  title,
  className,
}: {
  network: ModelNetwork
  /** Colour for an element, or null for the neutral style. */
  colorFor?: (kind: Kind, id: string) => string | null
  width?: number
  height?: number
  title?: string
  className?: string
}) {
  const geo = useMemo(() => {
    const feats = network.geojson.features as Feature[]
    let minx = Infinity
    let miny = Infinity
    let maxx = -Infinity
    let maxy = -Infinity
    const visit = (c: Position) => {
      if (c[0] < minx) minx = c[0]
      if (c[0] > maxx) maxx = c[0]
      if (c[1] < miny) miny = c[1]
      if (c[1] > maxy) maxy = c[1]
    }
    for (const f of feats) {
      const g = f.geometry
      if (!g) continue
      if (g.type === 'Point') visit(g.coordinates)
      else if (g.type === 'LineString') g.coordinates.forEach(visit)
      else if (g.type === 'Polygon') g.coordinates[0]?.forEach(visit)
    }
    return { feats, minx, miny, maxx, maxy }
  }, [network])
  const pad = 12
  const sx = (width - pad * 2) / Math.max(1e-9, geo.maxx - geo.minx)
  const sy = (height - pad * 2) / Math.max(1e-9, geo.maxy - geo.miny)
  const s = Math.min(sx, sy)
  const ox = pad + (width - pad * 2 - (geo.maxx - geo.minx) * s) / 2
  const oy = pad + (height - pad * 2 - (geo.maxy - geo.miny) * s) / 2
  const X = (c: Position) => (ox + (c[0] - geo.minx) * s).toFixed(1)
  const Y = (c: Position) => (height - oy - (c[1] - geo.miny) * s).toFixed(1)
  const many = geo.feats.length > 3000
  const subs: JSX.Element[] = []
  const links: JSX.Element[] = []
  const nodes: JSX.Element[] = []
  for (const f of geo.feats) {
    const g = f.geometry
    const id = String(f.properties?.id ?? '')
    const kind = f.properties?.object_type as Kind
    if (!g || !kind) continue
    const c = colorFor?.(kind, id) ?? null
    if (g.type === 'Polygon' && kind === 'subcatchment') {
      subs.push(
        <polygon key={`s${id}`} points={(g.coordinates[0] ?? []).map((p) => `${X(p)},${Y(p)}`).join(' ')} fill={c ?? '#16a34a'} fillOpacity={c ? 0.55 : 0.12} stroke={c ?? '#16a34a'} strokeOpacity={0.5} strokeWidth={0.6} />,
      )
    } else if (g.type === 'LineString' && kind === 'link') {
      links.push(
        <polyline key={`l${id}`} points={g.coordinates.map((p) => `${X(p)},${Y(p)}`).join(' ')} fill="none" stroke={c ?? '#64748b'} strokeWidth={c ? 2.4 : 1.2} strokeLinecap="round" />,
      )
    } else if (g.type === 'Point' && kind === 'node' && (!many || c)) {
      const nk = f.properties?.node_kind
      nodes.push(
        <circle key={`n${id}`} cx={X(g.coordinates)} cy={Y(g.coordinates)} r={c ? 3.2 : nk === 'outfall' ? 3 : 1.6} fill={c ?? (nk === 'outfall' ? '#dc2626' : '#475569')} />,
      )
    }
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={title ?? 'Network plan'}>
      {title && <title>{title}</title>}
      {subs}
      {links}
      {nodes}
    </svg>
  )
}
