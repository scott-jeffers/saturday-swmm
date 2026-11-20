import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CompactMeshWgs } from '../../lib/meshGeoJson'

/**
 * Surface-flow particles for 2D results: tracers released on wet cells drift
 * with each cell's velocity (vx east, vy north) and leave short fading trails.
 * Drawn on a canvas over the map; trails are cleared whenever the map moves.
 */

export type SurfaceField = { vx: Float32Array; vy: Float32Array; depth: Float32Array }

const MIN_DEPTH = 0.02 // m: thinner sheets don't get tracers
const MIN_SPEED = 0.005 // m/s
/** Screen speed (px/s) for a water speed: a time-lapse, compressed so slow ponds still drift. */
const screenSpeed = (mps: number) => Math.min(120, 14 + 85 * Math.sqrt(mps))
const GRID = 256

type P = { lng: number; lat: number; tri: number; age: number; life: number }

export class SurfaceFlow {
  private map: MapLibreMap
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private ro: ResizeObserver
  private raf = 0
  private last = 0
  private still: boolean

  // mesh (WGS84)
  private vx = new Float64Array(0) // vertex lng
  private vy = new Float64Array(0) // vertex lat
  private tris = new Uint32Array(0)
  private cx = new Float64Array(0) // centroids
  private cy = new Float64Array(0)
  private grid: Int32Array[] = []
  private bbox = [0, 0, 1, 1]

  // field
  private field: SurfaceField | null = null
  private active: Uint32Array = new Uint32Array(0)
  private particles: P[] = []

  private inView: Uint32Array = new Uint32Array(0)
  private onMove = () => this.clear()
  private onMoveEnd = () => this.refreshView()

  constructor(map: MapLibreMap, mesh: CompactMeshWgs, still = false) {
    this.map = map
    this.still = still
    const container = map.getContainer()
    const c = document.createElement('canvas')
    c.className = 'ss-surface-flow'
    c.setAttribute('aria-hidden', 'true')
    Object.assign(c.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' })
    container.insertBefore(c, container.querySelector('.maplibregl-control-container'))
    this.canvas = c
    this.ctx = c.getContext('2d')!
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    this.setMesh(mesh)
    map.on('move', this.onMove)
    map.on('moveend', this.onMoveEnd)
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.map.off('move', this.onMove)
    this.map.off('moveend', this.onMoveEnd)
    this.ro.disconnect()
    this.canvas.remove()
  }

  setMesh(mesh: CompactMeshWgs) {
    const nv = mesh.vertices.length
    this.vx = new Float64Array(nv)
    this.vy = new Float64Array(nv)
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    for (let i = 0; i < nv; i++) {
      const v = mesh.vertices[i]!
      this.vx[i] = v[0]!
      this.vy[i] = v[1]!
      if (v[0]! < minx) minx = v[0]!
      if (v[0]! > maxx) maxx = v[0]!
      if (v[1]! < miny) miny = v[1]!
      if (v[1]! > maxy) maxy = v[1]!
    }
    this.bbox = [minx, miny, maxx, maxy]
    const nt = mesh.triangles.length
    this.tris = new Uint32Array(nt * 3)
    this.cx = new Float64Array(nt)
    this.cy = new Float64Array(nt)
    const buckets: number[][] = Array.from({ length: GRID * GRID }, () => [])
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = mesh.triangles[t]!
      this.tris[3 * t] = a!
      this.tris[3 * t + 1] = b!
      this.tris[3 * t + 2] = c!
      const xs = [this.vx[a!]!, this.vx[b!]!, this.vx[c!]!]
      const ys = [this.vy[a!]!, this.vy[b!]!, this.vy[c!]!]
      this.cx[t] = (xs[0]! + xs[1]! + xs[2]!) / 3
      this.cy[t] = (ys[0]! + ys[1]! + ys[2]!) / 3
      const g0 = this.cell(Math.min(...xs), Math.min(...ys))
      const g1 = this.cell(Math.max(...xs), Math.max(...ys))
      for (let gy = g0[1]; gy <= g1[1]; gy++) for (let gx = g0[0]; gx <= g1[0]; gx++) buckets[gy * GRID + gx]!.push(t)
    }
    this.grid = buckets.map((b) => Int32Array.from(b))
    this.particles = []
  }

  setField(f: SurfaceField | null) {
    this.field = f
    if (!f) {
      this.active = new Uint32Array(0)
      this.particles = []
      this.clear()
      return
    }
    const act: number[] = []
    for (let t = 0; t < f.depth.length; t++) {
      if (f.depth[t]! < MIN_DEPTH) continue
      if (Math.hypot(f.vx[t]!, f.vy[t]!) < MIN_SPEED) continue
      act.push(t)
    }
    this.active = Uint32Array.from(act)
    this.refreshView()
    // Particles on cells that went dry or still go on; the step drops them.
  }

  /** Wet, moving cells inside the current view: where new tracers start. */
  private refreshView() {
    const b = this.map.getBounds()
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth()
    const out: number[] = []
    for (const t of this.active) {
      const x = this.cx[t]!, y = this.cy[t]!
      if (x >= w && x <= e && y >= s && y <= n) out.push(t)
    }
    this.inView = Uint32Array.from(out)
  }

  // ----------------------------------------------------------- internals
  private cell(x: number, y: number): [number, number] {
    const [minx, miny, maxx, maxy] = this.bbox
    const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((x - minx) / (maxx - minx || 1)) * GRID)))
    const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((y - miny) / (maxy - miny || 1)) * GRID)))
    return [gx, gy]
  }

  private inside(t: number, x: number, y: number): boolean {
    const a = this.tris[3 * t]!, b = this.tris[3 * t + 1]!, c = this.tris[3 * t + 2]!
    const ax = this.vx[a]!, ay = this.vy[a]!, bx = this.vx[b]!, by = this.vy[b]!, cx = this.vx[c]!, cy = this.vy[c]!
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
    const neg = d1 < 0 || d2 < 0 || d3 < 0
    const pos = d1 > 0 || d2 > 0 || d3 > 0
    return !(neg && pos)
  }

  private locate(x: number, y: number, hint: number): number {
    if (hint >= 0 && this.inside(hint, x, y)) return hint
    const [minx, miny, maxx, maxy] = this.bbox
    if (x < minx || x > maxx || y < miny || y > maxy) return -1
    const [gx, gy] = this.cell(x, y)
    for (const t of this.grid[gy * GRID + gx]!) if (this.inside(t, x, y)) return t
    return -1
  }

  private spawn(): P | null {
    const n = this.inView.length
    if (!n) return null
    {
      const t = this.inView[(Math.random() * n) | 0]!
      // a random point in the triangle
      let r1 = Math.random(), r2 = Math.random()
      if (r1 + r2 > 1) [r1, r2] = [1 - r1, 1 - r2]
      const a = this.tris[3 * t]!, bb = this.tris[3 * t + 1]!, c = this.tris[3 * t + 2]!
      const x = this.vx[a]! + r1 * (this.vx[bb]! - this.vx[a]!) + r2 * (this.vx[c]! - this.vx[a]!)
      const y = this.vy[a]! + r1 * (this.vy[bb]! - this.vy[a]!) + r2 * (this.vy[c]! - this.vy[a]!)
      return { lng: x, lat: y, tri: t, age: 0, life: 2 + Math.random() * 3 }
    }
  }

  private resize() {
    const el = this.map.getContainer()
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(el.clientWidth * dpr)
    this.canvas.height = Math.round(el.clientHeight * dpr)
    this.canvas.style.width = `${el.clientWidth}px`
    this.canvas.style.height = `${el.clientHeight}px`
  }

  private clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop)
    if (document.visibilityState === 'hidden') return
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016)
    this.last = now
    const f = this.field
    const { ctx, canvas } = this
    const dpr = window.devicePixelRatio || 1
    // fade the old trails
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,0.07)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalCompositeOperation = 'source-over'
    if (!f || !this.active.length || this.map.getZoom() < 12.5) {
      this.particles = []
      return
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // How many tracers: more when more of the surface is wet, capped for speed.
    // About one tracer per 1.5 wet cells on screen, capped for speed.
    const want = Math.min(4000, this.inView.length / 1.5)
    let spawned = 0
    while (this.particles.length < want && spawned++ < 120) {
      const p = this.spawn()
      if (!p) break
      this.particles.push(p)
    }
    if (this.still) return
    ctx.lineCap = 'round'
    const keep: P[] = []
    for (const p of this.particles) {
      p.age += dt
      const t = p.tri
      if (t < 0 || p.age > p.life || f.depth[t]! < MIN_DEPTH) continue
      const u = f.vx[t]!, v = f.vy[t]!
      const speed = Math.hypot(u, v)
      if (speed < MIN_SPEED * 0.5) continue
      const a = this.map.project([p.lng, p.lat])
      const px = screenSpeed(speed) * dt
      const bx = a.x + (u / speed) * px
      const by = a.y - (v / speed) * px
      const ll = this.map.unproject([bx, by])
      const nt = this.locate(ll.lng, ll.lat, t)
      if (nt < 0) continue
      // brighter for faster water; fade in and out over the tracer's life
      const life = Math.min(1, p.age / 0.4, (p.life - p.age) / 0.6)
      const s = Math.min(1, Math.sqrt(speed / 0.8))
      ctx.strokeStyle = `rgba(${Math.round(200 + 55 * s)}, ${Math.round(240 + 15 * s)}, 255, ${(0.55 + 0.45 * s) * life})`
      ctx.lineWidth = 1.3 + 1.3 * s
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(bx, by)
      ctx.stroke()
      p.lng = ll.lng
      p.lat = ll.lat
      p.tri = nt
      keep.push(p)
    }
    this.particles = keep
  }
}
