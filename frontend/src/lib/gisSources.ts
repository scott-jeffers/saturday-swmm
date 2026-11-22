/**
 * Background GIS layers from the web and from files read in the browser.
 *
 * Web layers: XYZ tile templates, WMS (any server that speaks EPSG:3857) and
 * ArcGIS REST services. An ArcGIS map service is drawn as images; a feature
 * service layer (…/FeatureServer/0, …/MapServer/3) is queried for its features.
 *
 * Files (browser viewer): GeoJSON, zipped shapefiles and KML/KMZ. GeoJSON with a
 * named projected CRS is reprojected; everything else is taken as lon/lat.
 */

import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { GisWebSource } from '../api/client'
import proj4 from 'proj4'
import { ensureCrs, projectToWgs84 } from './projection'

export const LABEL_FONT = ['Noto Sans Regular']
export const GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'

/** Colours offered for vector layers (readable on light and dark maps). */
export const LAYER_COLORS = ['#e4572e', '#f0a202', '#2a9d8f', '#3a86ff', '#8338ec', '#ff006e', '#6b7280', '#14b8a6']

export function defaultLayerColor(index: number) {
  return LAYER_COLORS[index % LAYER_COLORS.length]!
}

/** An ArcGIS layer that holds features (…/FeatureServer/N or …/MapServer/N). */
export function isArcgisFeatureLayer(url: string) {
  return /\/(FeatureServer|MapServer)\/\d+\/?(\?.*)?$/i.test(url.trim())
}

/** Tile URL template MapLibre can draw, for a web layer. */
export function tileTemplate(web: GisWebSource): string {
  const url = web.url.trim()
  if (web.kind === 'xyz') return url
  if (web.kind === 'wms') {
    const base = url.split('?')[0]!
    const q = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '')
    const keep = [...q.entries()].filter(([k]) => !/^(service|request|version|layers|styles|format|transparent|width|height|bbox|srs|crs)$/i.test(k))
    const params = [
      'SERVICE=WMS',
      'REQUEST=GetMap',
      'VERSION=1.1.1',
      `LAYERS=${encodeURIComponent(web.wms_layers || q.get('layers') || q.get('LAYERS') || '')}`,
      'STYLES=',
      'FORMAT=image/png',
      'TRANSPARENT=true',
      'SRS=EPSG:3857',
      'WIDTH=256',
      'HEIGHT=256',
      ...keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
    ]
    return `${base}?${params.join('&')}&BBOX={bbox-epsg-3857}`
  }
  // ArcGIS map or image service: export images in web mercator
  const base = url.replace(/\/+$/, '').replace(/\?.*$/, '')
  const op = /\/ImageServer$/i.test(base) ? 'exportImage' : 'export'
  return `${base}/${op}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`
}

/** Guess the kind of a pasted web address. */
export function guessWebKind(url: string): GisWebSource['kind'] {
  if (/\{z\}|\{x\}|\{y\}/i.test(url)) return 'xyz'
  if (/service=wms|\/wms\b/i.test(url)) return 'wms'
  if (/arcgis|\/(MapServer|ImageServer|FeatureServer)/i.test(url)) return 'arcgis'
  return 'xyz'
}

export function layerNameFromUrl(url: string) {
  const m = /services\/(.+?)\/(MapServer|FeatureServer|ImageServer)/i.exec(url)
  if (m) return m[1]!.split('/').pop()!.replace(/_/g, ' ')
  try {
    return new URL(url.replace(/\{.*?\}/g, '0')).hostname.replace(/^www\./, '')
  } catch {
    return 'Web layer'
  }
}

/**
 * Features of an ArcGIS feature layer, in lon/lat, optionally within a
 * lon/lat box. Pages through the service up to `max` features.
 */
export async function fetchArcgisFeatures(
  url: string,
  bbox?: [number, number, number, number],
  max = 10000,
): Promise<{ fc: FeatureCollection; truncated: boolean }> {
  const base = url.trim().replace(/\?.*$/, '').replace(/\/+$/, '')
  const features: Feature[] = []
  let offset = 0
  let truncated = false
  for (;;) {
    const q = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      f: 'geojson',
      resultOffset: String(offset),
      resultRecordCount: '2000',
    })
    if (bbox) {
      q.set('geometry', bbox.join(','))
      q.set('geometryType', 'esriGeometryEnvelope')
      q.set('inSR', '4326')
      q.set('spatialRel', 'esriSpatialRelIntersects')
    }
    const r = await fetch(`${base}/query?${q}`)
    if (!r.ok) throw new Error(`The service answered ${r.status}`)
    const j = (await r.json()) as FeatureCollection & { error?: { message?: string }; properties?: { exceededTransferLimit?: boolean }; exceededTransferLimit?: boolean }
    if (j.error) throw new Error(j.error.message || 'The service returned an error')
    const page = (j.features ?? []).filter((f) => f.geometry)
    features.push(...page)
    const more = j.exceededTransferLimit || j.properties?.exceededTransferLimit
    if (!more || !page.length) break
    if (features.length >= max) {
      truncated = true
      break
    }
    offset += page.length
  }
  return { fc: { type: 'FeatureCollection', features }, truncated }
}

// --------------------------------------------------------------------- files

const CRS_RE = /EPSG:{1,2}(\d+)|EPSG\/0\/(\d+)|CRS84/i

function mapCoords(g: Geometry, f: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Point':
      return { ...g, coordinates: f(g.coordinates) }
    case 'MultiPoint':
    case 'LineString':
      return { ...g, coordinates: g.coordinates.map(f) }
    case 'MultiLineString':
    case 'Polygon':
      return { ...g, coordinates: g.coordinates.map((r) => r.map(f)) }
    case 'MultiPolygon':
      return { ...g, coordinates: g.coordinates.map((p) => p.map((r) => r.map(f))) }
    case 'GeometryCollection':
      return { ...g, geometries: g.geometries.map((x) => mapCoords(x, f)) }
  }
}

function firstCoord(g: Geometry | null): Position | null {
  if (!g) return null
  if (g.type === 'GeometryCollection') return firstCoord(g.geometries[0] ?? null)
  let c: unknown = g.coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return Array.isArray(c) && typeof c[0] === 'number' ? (c as Position) : null
}

type CrsRow = [number, string, string, string]
let catalog: Promise<CrsRow[]> | null = null

/** proj4 definition of an EPSG code, from the app's coordinate system list. */
export async function proj4For(code: string): Promise<string | null> {
  const n = Number(code.replace(/^EPSG:/i, ''))
  if (!Number.isInteger(n)) return null
  catalog ??= fetch(`${import.meta.env.BASE_URL}crs-epsg.json`).then((r) => (r.ok ? (r.json() as Promise<CrsRow[]>) : []))
  return (await catalog).find((r) => r[0] === n)?.[3] ?? null
}

/**
 * GeoJSON to lon/lat: a named CRS (old-style "crs" member) is reprojected;
 * coordinates that can't be lon/lat are taken to be in `fallbackCrs`.
 */
export async function toLonLat(
  fc: FeatureCollection,
  fallbackCrs?: string | null,
  resolve: (code: string) => Promise<string | null> = proj4For,
): Promise<{ fc: FeatureCollection; note?: string }> {
  const named = (fc as { crs?: { properties?: { name?: string } } }).crs?.properties?.name ?? ''
  const m = CRS_RE.exec(named)
  let crs: string | null = m && !/CRS84/i.test(m[0]) && (m[1] ?? m[2]) !== '4326' ? `EPSG:${m[1] ?? m[2]}` : null
  let note: string | undefined
  if (!crs) {
    const c = fc.features.map((f) => firstCoord(f.geometry)).find(Boolean)
    if (c && (Math.abs(c[0]!) > 180 || Math.abs(c[1]!) > 90)) {
      if (!fallbackCrs) throw new Error('These coordinates aren’t longitude/latitude and the file names no coordinate system')
      crs = fallbackCrs
      note = `No coordinate system in the file; read as the model's (${fallbackCrs}).`
    }
  }
  if (!crs) return { fc }
  let known = false
  try {
    known = Boolean(proj4.defs(crs))
  } catch {
    known = false
  }
  if (!known) {
    const def = await resolve(crs)
    if (!def) throw new Error(`Unknown coordinate system ${crs}`)
    ensureCrs(crs, def)
  }
  const f = (p: Position): Position => {
    const [lon, lat] = projectToWgs84(p[0]!, p[1]!, crs!)
    return [lon, lat]
  }
  return {
    fc: { type: 'FeatureCollection', features: fc.features.filter((x) => x.geometry).map((x) => ({ ...x, geometry: mapCoords(x.geometry, f) })) },
    note,
  }
}

async function kmlToGeoJson(text: string): Promise<FeatureCollection> {
  const { kml } = await import('@tmcw/togeojson')
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  return kml(doc) as FeatureCollection
}

/** Read a vector file in the browser. Returns one or more named layers in lon/lat. */
export async function readVectorFile(file: File, fallbackCrs?: string | null): Promise<{ name: string; fc: FeatureCollection; note?: string }[]> {
  const stem = file.name.replace(/\.[^.]+$/, '')
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'geojson' || ext === 'json') {
    const j = JSON.parse(await file.text()) as FeatureCollection | Feature
    const fc: FeatureCollection = j.type === 'FeatureCollection' ? j : { type: 'FeatureCollection', features: [j as Feature] }
    return [{ name: stem, ...(await toLonLat(fc, fallbackCrs)) }]
  }
  if (ext === 'kml') return [{ name: stem, fc: await kmlToGeoJson(await file.text()) }]
  if (ext === 'kmz' || ext === 'zip') {
    const buf = await file.arrayBuffer()
    const { unzip } = await import('./unzip')
    const files = await unzip(buf)
    const entries = Object.fromEntries(files.map((f) => [f.name, f.data]))
    const strFromU8 = (u: Uint8Array) => new TextDecoder().decode(u)
    const names = Object.keys(entries).filter((n) => !n.startsWith('__MACOSX') && !/(^|\/)\./.test(n))
    const kmlName = names.find((n) => n.toLowerCase().endsWith('.kml'))
    if (kmlName) return [{ name: stem, fc: await kmlToGeoJson(strFromU8(entries[kmlName]!)) }]
    const gj = names.find((n) => /\.(geo)?json$/i.test(n))
    if (gj && !names.some((n) => n.toLowerCase().endsWith('.shp'))) {
      return [{ name: stem, ...(await toLonLat(JSON.parse(strFromU8(entries[gj]!)) as FeatureCollection, fallbackCrs)) }]
    }
    if (names.some((n) => n.toLowerCase().endsWith('.shp'))) {
      const shp = (await import('shpjs')).default
      const out = await shp(buf)
      const list = Array.isArray(out) ? out : [out]
      const hasPrj = names.some((n) => n.toLowerCase().endsWith('.prj'))
      return Promise.all(
        list.map(async (fc, i) => {
          const name = (fc as { fileName?: string }).fileName?.split('/').pop() || (list.length > 1 ? `${stem} ${i + 1}` : stem)
          // Without a .prj shpjs leaves coordinates as they are.
          return hasPrj ? { name, fc } : { name, ...(await toLonLat(fc, fallbackCrs)) }
        }),
      )
    }
    throw new Error('The archive has no shapefile, GeoJSON or KML in it')
  }
  if (ext === 'shp') throw new Error('Zip the shapefile with its .dbf, .shx and .prj and add the .zip')
  if (ext === 'gpkg') throw new Error('GeoPackages open in the desktop app; in the browser, use GeoJSON, a zipped shapefile or KML')
  throw new Error(`Can’t read .${ext} files here`)
}

/** Field names in first-seen order. */
export function fieldNames(fc: FeatureCollection, limit = 200) {
  const seen = new Set<string>()
  for (const f of fc.features.slice(0, limit)) for (const k of Object.keys(f.properties ?? {})) seen.add(k)
  return [...seen]
}

/** Lon/lat bounds of a collection. */
export function lonLatBounds(fc: FeatureCollection) {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const visit = (p: Position) => {
    w = Math.min(w, p[0]!)
    e = Math.max(e, p[0]!)
    s = Math.min(s, p[1]!)
    n = Math.max(n, p[1]!)
    return p
  }
  for (const f of fc.features) if (f.geometry) mapCoords(f.geometry, visit)
  return Number.isFinite(w) ? { west: w, south: s, east: e, north: n } : null
}

export function geometryTypes(fc: FeatureCollection) {
  return [...new Set(fc.features.map((f) => f.geometry?.type).filter(Boolean) as string[])].sort()
}
