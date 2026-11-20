import type { Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Position } from 'geojson'

/**
 * Flow droplets drawn on a 2D canvas laid over the map.
 *
 * The earlier version animated MapLibre's line-dasharray, which rebuilds the
 * dash texture on every change and flickered. Here the style never changes
 * per frame: we project each pipe to screen space and draw small droplets that
 * slide along it, each pipe at its own speed.
 */

export type FlowParticleOptions = {
  /** Droplet colours depend on the basemap. */
  light: boolean
  /** Hold the droplets still (prefers-reduced-motion). */
  still: boolean
}

type Pipe = { coords: Position[]; ratio: number; kind: string }

const SPACING_PX = 22
const MIN_SPEED = 18 // px/s at the lowest flow
const EXTRA_SPEED = 95 // added px/s at the run's peak flow

export class FlowParticles {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private pipes: Pipe[] = []
  private kinds: Set<string> | null = null
  private raf = 0
  private t0 = performance.now()
  private opts: FlowParticleOptions = { light: true, still: false }
  private ro: ResizeObserver
  private map: MapLibreMap

  constructor(map: MapLibreMap) {
    this.map = map
    const container = map.getContainer()
    const c = document.createElement('canvas')
    c.className = 'ss-flow-particles'
    c.setAttribute('aria-hidden', 'true')
    Object.assign(c.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' })
    container.insertBefore(c, container.querySelector('.maplibregl-control-container'))
    this.canvas = c
    this.ctx = c.getContext('2d')!
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  setData(fc: FeatureCollection): void {
    this.pipes = []
    for (const f of fc.features) {
      if (f.geometry?.type !== 'LineString') continue
      const p = f.properties ?? {}
      this.pipes.push({
        coords: f.geometry.coordinates as Position[],
        ratio: typeof p.flow_ratio === 'number' ? p.flow_ratio : 0.4,
        kind: String(p.link_kind ?? 'conduit'),
      })
    }
  }

  /** null = every kind visible. */
  setKinds(kinds: string[] | null): void {
    this.kinds = kinds ? new Set(kinds) : null
  }

  setOptions(o: Partial<FlowParticleOptions>): void {
    this.opts = { ...this.opts, ...o }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
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

  private loop(now: number): void {
    this.raf = requestAnimationFrame(this.loop)
    if (document.visibilityState === 'hidden') return
    this.draw(this.opts.still ? 0 : (now - this.t0) / 1000)
  }

  private draw(t: number): void {
    const { ctx, canvas, map } = this
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!this.pipes.length) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const w = canvas.width / dpr
    const h = canvas.height / dpr
    const zoom = map.getZoom()
    // Droplets grow a little as you zoom in, and fade out on very wide views.
    const zf = Math.min(1, Math.max(0, (zoom - 10) / 6))
    const alpha = Math.min(1, Math.max(0, (zoom - 9.5) / 1.5))
    if (alpha <= 0) return
    const halo = this.opts.light ? '3, 105, 161' : '103, 232, 249'

    for (const pipe of this.pipes) {
      if (this.kinds && !this.kinds.has(pipe.kind)) continue
      // project and cull
      const pts: [number, number][] = []
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of pipe.coords) {
        const p = map.project([c[0]!, c[1]!])
        pts.push([p.x, p.y])
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      if (maxX < -20 || maxY < -20 || minX > w + 20 || minY > h + 20) continue

      const segs: number[] = []
      let total = 0
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
        segs.push(d)
        total += d
      }
      if (total < 6) continue

      const r = pipe.ratio
      const speed = MIN_SPEED + EXTRA_SPEED * r
      const core = (1.3 + 1.4 * r) * (0.8 + 0.5 * zf)
      const offset = (t * speed) % SPACING_PX
      const a = alpha * (0.75 + 0.25 * r)

      let seg = 0
      let segStart = 0
      for (let s = offset; s < total; s += SPACING_PX) {
        while (seg < segs.length - 1 && s > segStart + segs[seg]!) {
          segStart += segs[seg]!
          seg++
        }
        const f = segs[seg]! > 0 ? (s - segStart) / segs[seg]! : 0
        const p0 = pts[seg]!
        const p1 = pts[seg + 1]!
        const x = p0[0] + (p1[0] - p0[0]) * f
        const y = p0[1] + (p1[1] - p0[1]) * f
        ctx.fillStyle = `rgba(${halo}, ${0.28 * a})`
        ctx.beginPath()
        ctx.arc(x, y, core * 2.1, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(255, 255, 255, ${a})`
        ctx.beginPath()
        ctx.arc(x, y, core, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
