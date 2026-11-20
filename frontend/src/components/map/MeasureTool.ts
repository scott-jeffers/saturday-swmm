import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

/**
 * Click-to-measure on the map. Distance: a polyline; area: a closed polygon.
 * Works in WGS84 on the sphere, so it is right whatever the model's CRS.
 * Click adds a point, double-click or Enter finishes, Backspace removes the
 * last point, Escape clears.
 */
export type MeasureMode = 'distance' | 'area'
export type MeasureResult = { points: number; distance_m: number; area_m2: number; done: boolean }

const R = 6371008.8
const SRC = 'measure'
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(a: [number, number], b: [number, number]): number {
  const p1 = rad(a[1])
  const p2 = rad(b[1])
  const dp = p2 - p1
  const dl = rad(b[0] - a[0])
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Spherical polygon area (m²) of a ring given as lng/lat pairs. */
export function sphericalArea(ring: [number, number][]): number {
  if (ring.length < 3) return 0
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const [l1, p1] = ring[i]!
    const [l2, p2] = ring[(i + 1) % ring.length]!
    s += rad(l2 - l1) * (2 + Math.sin(rad(p1)) + Math.sin(rad(p2)))
  }
  return Math.abs((s * R * R) / 2)
}

export class MeasureTool {
  private pts: [number, number][] = []
  private hover: [number, number] | null = null
  private done = false

  private map: MapLibreMap
  private mode: MeasureMode
  private onChange: (r: MeasureResult) => void

  constructor(map: MapLibreMap, mode: MeasureMode, onChange: (r: MeasureResult) => void) {
    this.map = map
    this.mode = mode
    this.onChange = onChange
    if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const color = '#f97316'
    if (!map.getLayer('measure-fill'))
      map.addLayer({ id: 'measure-fill', type: 'fill', source: SRC, filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': 0.15 } })
    if (!map.getLayer('measure-line'))
      map.addLayer({ id: 'measure-line', type: 'line', source: SRC, filter: ['==', '$type', 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 2.5, 'line-dasharray': [2, 1.2] } })
    if (!map.getLayer('measure-pts'))
      map.addLayer({ id: 'measure-pts', type: 'circle', source: SRC, filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': color, 'circle-stroke-width': 2 } })
    map.on('click', this.onClick)
    map.on('dblclick', this.onDbl)
    map.on('mousemove', this.onMove)
    window.addEventListener('keydown', this.onKey)
    map.doubleClickZoom.disable()
    map.getCanvas().style.cursor = 'crosshair'
    this.render()
  }

  destroy(): void {
    const m = this.map
    m.off('click', this.onClick)
    m.off('dblclick', this.onDbl)
    m.off('mousemove', this.onMove)
    window.removeEventListener('keydown', this.onKey)
    m.doubleClickZoom.enable()
    for (const id of ['measure-pts', 'measure-line', 'measure-fill']) if (m.getLayer(id)) m.removeLayer(id)
    if (m.getSource(SRC)) m.removeSource(SRC)
    m.getCanvas().style.cursor = ''
  }

  clear(): void {
    this.pts = []
    this.done = false
    this.render()
  }

  private onClick = (e: MapMouseEvent) => {
    if (this.done) this.clear()
    this.pts.push([e.lngLat.lng, e.lngLat.lat])
    this.render()
  }

  private onDbl = (e: MapMouseEvent) => {
    e.preventDefault()
    // The double-click's two clicks already added the same point twice.
    if (this.pts.length >= 2) {
      const [a, b] = [this.pts[this.pts.length - 1]!, this.pts[this.pts.length - 2]!]
      if (haversine(a, b) < 0.01) this.pts.pop()
    }
    this.done = true
    this.render()
  }

  private onMove = (e: MapMouseEvent) => {
    this.map.getCanvas().style.cursor = 'crosshair'
    if (this.done || !this.pts.length) return
    this.hover = [e.lngLat.lng, e.lngLat.lat]
    this.render()
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === 'Escape') this.clear()
    else if (e.key === 'Enter') {
      this.done = true
      this.render()
    } else if (e.key === 'Backspace' && this.pts.length) {
      this.pts.pop()
      this.done = false
      this.render()
    }
  }

  private render(): void {
    const live = this.done || !this.hover ? this.pts : [...this.pts, this.hover]
    const feats: GeoJSON.Feature[] = this.pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
    if (this.mode === 'area' && live.length >= 3) {
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...live, live[0]!]] } })
    }
    const path = this.mode === 'area' && live.length >= 3 ? [...live, live[0]!] : live
    if (path.length >= 2) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path } })
    ;(this.map.getSource(SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
    let d = 0
    for (let i = 1; i < path.length; i++) d += haversine(path[i - 1]!, path[i]!)
    this.onChange({
      points: this.pts.length,
      distance_m: d,
      area_m2: this.mode === 'area' ? sphericalArea(live) : 0,
      done: this.done,
    })
  }
}
