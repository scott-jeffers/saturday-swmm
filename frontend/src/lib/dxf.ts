/**
 * A small reader for ASCII DXF drawings (AutoCAD, Civil 3D, MicroStation
 * exports) as GeoJSON in drawing coordinates. It reads what a background
 * layer needs: LINE, LWPOLYLINE, POLYLINE, POINT, CIRCLE, ARC, TEXT and
 * MTEXT, each with its CAD layer name. Blocks (INSERT) and hatches are
 * skipped and counted, so the import can say what it left out.
 */
import type { Feature, FeatureCollection, Position } from 'geojson'

type Pair = [number, string]

function pairs(text: string): Pair[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim())
    if (!Number.isFinite(code)) break
    out.push([code, lines[i + 1]!.trim()])
  }
  return out
}

const arcPoints = (cx: number, cy: number, r: number, a0: number, a1: number, steps: number): Position[] => {
  let end = a1
  while (end <= a0) end += 360
  const n = Math.max(4, Math.ceil(((end - a0) / 360) * steps))
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((end - a0) * i) / n) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

export function parseDxf(text: string): { fc: FeatureCollection; skipped: Record<string, number> } {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('This is a binary DXF. Save it as an ASCII DXF in your CAD program and try again.')
  const ps = pairs(text)
  const start = ps.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && ps[i - 1]?.[1] === 'SECTION')
  if (start < 0) throw new Error('No drawing entities found. Is this a DXF file?')
  const features: Feature[] = []
  const skipped: Record<string, number> = {}
  let i = start + 1
  // Group the entity stream: each entity starts with a 0 code.
  const entities: { type: string; data: Pair[] }[] = []
  while (i < ps.length) {
    const [c, v] = ps[i]!
    if (c === 0 && v === 'ENDSEC') break
    if (c === 0) {
      const data: Pair[] = []
      i++
      while (i < ps.length && ps[i]![0] !== 0) data.push(ps[i++]!)
      entities.push({ type: v, data })
    } else i++
  }
  const num = (d: Pair[], code: number, dflt = 0) => {
    const p = d.find((x) => x[0] === code)
    return p ? Number(p[1]) : dflt
  }
  const str = (d: Pair[], code: number) => d.find((x) => x[0] === code)?.[1] ?? ''
  const add = (geometry: Feature['geometry'], type: string, d: Pair[], extra: Record<string, unknown> = {}) =>
    features.push({ type: 'Feature', geometry, properties: { layer: str(d, 8) || '0', entity: type, ...extra } })

  for (let k = 0; k < entities.length; k++) {
    const { type, data: d } = entities[k]!
    switch (type) {
      case 'LINE':
        add({ type: 'LineString', coordinates: [[num(d, 10), num(d, 20)], [num(d, 11), num(d, 21)]] }, type, d)
        break
      case 'LWPOLYLINE': {
        const xs = d.filter((x) => x[0] === 10).map((x) => Number(x[1]))
        const ys = d.filter((x) => x[0] === 20).map((x) => Number(x[1]))
        const pts: Position[] = xs.map((x, j) => [x, ys[j] ?? 0])
        if ((num(d, 70) & 1) === 1 && pts.length > 2) pts.push(pts[0]!)
        if (pts.length >= 2) add({ type: 'LineString', coordinates: pts }, type, d)
        break
      }
      case 'POLYLINE': {
        const closed = (num(d, 70) & 1) === 1
        const pts: Position[] = []
        while (entities[k + 1]?.type === 'VERTEX') {
          const vd = entities[++k]!.data
          pts.push([num(vd, 10), num(vd, 20)])
        }
        if (entities[k + 1]?.type === 'SEQEND') k++
        if (closed && pts.length > 2) pts.push(pts[0]!)
        if (pts.length >= 2) add({ type: 'LineString', coordinates: pts }, type, d)
        break
      }
      case 'POINT':
        add({ type: 'Point', coordinates: [num(d, 10), num(d, 20)] }, type, d)
        break
      case 'CIRCLE':
        add({ type: 'LineString', coordinates: arcPoints(num(d, 10), num(d, 20), num(d, 40), 0, 360, 48) }, type, d)
        break
      case 'ARC':
        add({ type: 'LineString', coordinates: arcPoints(num(d, 10), num(d, 20), num(d, 40), num(d, 50), num(d, 51), 48) }, type, d)
        break
      case 'TEXT':
      case 'MTEXT': {
        const t = d.filter((x) => x[0] === 1 || x[0] === 3).map((x) => x[1]).join('').replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').trim()
        if (t) add({ type: 'Point', coordinates: [num(d, 10), num(d, 20)] }, type, d, { text: t })
        break
      }
      case 'VERTEX':
      case 'SEQEND':
        break
      default:
        skipped[type] = (skipped[type] ?? 0) + 1
    }
  }
  return { fc: { type: 'FeatureCollection', features }, skipped }
}
