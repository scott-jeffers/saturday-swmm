import type { Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Position } from 'geojson'

/**
 * Element labels (IDs, or a property such as pipe size) drawn on a canvas over the map. Redrawn only when the map
 * renders (pan, zoom, data change), and only once zoomed in far enough that
 * labels can be read; overlapping labels are dropped.
 */
type Item = { text: string; at: Position; kind: 'node' | 'link' | 'sub' }
type TextOf = (p: Record<string, unknown>) => string

const NODE_MIN_ZOOM = 16
const LINK_MIN_ZOOM = 17
const SUB_MIN_ZOOM = 15
const MAX_LABELS = 600

export class MapLabels {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private items: Item[] = []
  private light = true
  private ro: ResizeObserver
  private onRender = () => this.draw()

  private map: MapLibreMap

  constructor(map: MapLibreMap) {
    this.map = map
    const container = map.getContainer()
    const c = document.createElement('canvas')
    c.className = 'ss-map-labels'
    c.setAttribute('aria-hidden', 'true')
    Object.assign(c.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' })
    container.insertBefore(c, container.querySelector('.maplibregl-control-container'))
    this.canvas = c
    this.ctx = c.getContext('2d')!
    this.ro = new ResizeObserver(() => {
      this.resize()
      this.draw()
    })
    this.ro.observe(container)
    this.resize()
    map.on('render', this.onRender)
  }

  /** `text` picks what each label says (default: the element's ID; '' = no label). */
  setData(nodes: FeatureCollection, links: FeatureCollection, text?: { node?: TextOf; link?: TextOf; sub?: TextOf }, subs?: FeatureCollection): void {
    const items: Item[] = []
    for (const f of nodes.features) {
      if (f.geometry?.type !== 'Point') continue
      const t = text?.node ? text.node(f.properties ?? {}) : String(f.properties?.id ?? '')
      if (t) items.push({ text: t, at: f.geometry.coordinates, kind: 'node' })
    }
    for (const f of links.features) {
      if (f.geometry?.type !== 'LineString') continue
      const cs = f.geometry.coordinates
      if (cs.length < 2) continue
      const mid = cs[Math.floor((cs.length - 1) / 2)]!
      const nxt = cs[Math.floor((cs.length - 1) / 2) + 1] ?? mid
      const t = text?.link ? text.link(f.properties ?? {}) : String(f.properties?.id ?? '')
      if (!t) continue
      items.push({
        text: t,
        at: [(mid[0]! + nxt[0]!) / 2, (mid[1]! + nxt[1]!) / 2],
        kind: 'link',
      })
    }
    // Subcatchments last, so pipes and manholes win when labels overlap.
    for (const f of subs?.features ?? []) {
      const g = f.geometry
      const ring = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : undefined
      if (!ring || ring.length < 3) continue
      const t = text?.sub ? text.sub(f.properties ?? {}) : String(f.properties?.id ?? '')
      if (!t) continue
      items.push({ text: t, at: centroid(ring), kind: 'sub' })
    }
    this.items = items
    this.draw()
  }

  setLight(light: boolean): void {
    this.light = light
    this.draw()
  }

  destroy(): void {
    this.map.off('render', this.onRender)
    this.ro.disconnect()
    this.canvas.remove()
  }

  private resize(): void {
    const el = this.map.getContainer()
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(el.clientWidth * dpr)
    this.canvas.height = Math.round(el.clientHeight * dpr)
    this.canvas.style.width = `${el.clientWidth}px`
    this.canvas.style.height = `${el.clientHeight}px`
  }

  private draw(): void {
    const { ctx, canvas, map } = this
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const zoom = map.getZoom()
    if (zoom < SUB_MIN_ZOOM || !this.items.length) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.font = '500 11px Inter, ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const taken: [number, number, number, number][] = []
    const hits = (x0: number, y0: number, x1: number, y1: number) =>
      taken.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b)
    let n = 0
    for (const it of this.items) {
      if (it.kind === 'link' && zoom < LINK_MIN_ZOOM) continue
      if (it.kind === 'node' && zoom < NODE_MIN_ZOOM) continue
      if (!it.text) continue
      const p = map.project([it.at[0]!, it.at[1]!])
      if (p.x < -40 || p.y < -20 || p.x > w + 40 || p.y > h + 20) continue
      const tw = ctx.measureText(it.text).width
      // Nodes: to the upper right of the symbol. Links: centred on the pipe.
      const x = it.kind === 'node' ? p.x + 9 : p.x - tw / 2
      const y = it.kind === 'node' ? p.y - 9 : p.y
      const box: [number, number, number, number] = [x - 3, y - 8, x + tw + 3, y + 8]
      if (hits(...box)) continue
      taken.push(box)
      ctx.lineWidth = 3
      ctx.strokeStyle = this.light ? 'rgba(255,255,255,0.92)' : 'rgba(2,6,23,0.85)'
      ctx.strokeText(it.text, x, y)
      ctx.fillStyle =
        it.kind === 'sub' ? (this.light ? '#14532d' : '#bbf7d0') : this.light ? (it.kind === 'node' ? '#0f172a' : '#1e3a8a') : it.kind === 'node' ? '#f8fafc' : '#bfdbfe'
      ctx.fillText(it.text, x, y)
      if (++n >= MAX_LABELS) break
    }
  }
}

/** Area centroid of a ring (falls back to the vertex mean for degenerate rings). */
function centroid(ring: Position[]): Position {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j] as [number, number]
    const [x1, y1] = ring[i] as [number, number]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length
    return [ring.reduce((s, p) => s + p[0]!, 0) / n, ring.reduce((s, p) => s + p[1]!, 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}
