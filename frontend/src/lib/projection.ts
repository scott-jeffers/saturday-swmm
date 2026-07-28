import proj4 from 'proj4'
import type { Feature, FeatureCollection, Geometry } from 'geojson'

/** Fallback when a project has no CRS yet (Danish Bellinge / UTM32N). */
export const DEFAULT_CRS = 'EPSG:25832'

proj4.defs(
  DEFAULT_CRS,
  '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
)

/** Register a CRS definition from the backend so proj4 can transform it. */
export function ensureCrs(crs: string, proj4def?: string | null): void {
  const code = crs.trim()
  if (!code) return
  if (proj4def && proj4def.trim()) {
    proj4.defs(code, proj4def.trim())
    return
  }
  // Already known (e.g. DEFAULT_CRS) — leave alone
  try {
    // proj4.defs(code) returns the definition if registered
    if (proj4.defs(code)) return
  } catch {
    /* not registered */
  }
}

export type LngLat = [number, number]
export type XY = [number, number]

export function projectToWgs84(x: number, y: number, crs = DEFAULT_CRS): LngLat {
  const [lng, lat] = proj4(crs, 'WGS84', [x, y])
  return [lng, lat]
}

export function wgs84ToProject(lng: number, lat: number, crs = DEFAULT_CRS): XY {
  const [x, y] = proj4('WGS84', crs, [lng, lat])
  return [x, y]
}

export function reprojectGeoJson(
  geojson: FeatureCollection,
  crs = DEFAULT_CRS,
): FeatureCollection {
  const convertCoord = (c: number[]): number[] => {
    const [lng, lat] = projectToWgs84(c[0], c[1], crs)
    return [lng, lat]
  }

  const convertRing = (ring: number[][]) => ring.map(convertCoord)
  const convertGeom = (geom: Geometry): Geometry => {
    if (geom.type === 'Point') {
      return { type: 'Point', coordinates: convertCoord(geom.coordinates as number[]) }
    }
    if (geom.type === 'LineString') {
      return {
        type: 'LineString',
        coordinates: (geom.coordinates as number[][]).map(convertCoord),
      }
    }
    if (geom.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: (geom.coordinates as number[][][]).map(convertRing),
      }
    }
    if (geom.type === 'MultiLineString') {
      return {
        type: 'MultiLineString',
        coordinates: (geom.coordinates as number[][][]).map((line) =>
          line.map(convertCoord),
        ),
      }
    }
    if (geom.type === 'MultiPolygon') {
      return {
        type: 'MultiPolygon',
        coordinates: (geom.coordinates as number[][][][]).map((poly) =>
          poly.map(convertRing),
        ),
      }
    }
    return geom
  }

  return {
    type: 'FeatureCollection',
    features: geojson.features.map((f: Feature) => ({
      ...f,
      geometry: f.geometry ? convertGeom(f.geometry) : f.geometry,
    })),
  }
}

export function boundsToWgs84(
  bounds: { minx: number; miny: number; maxx: number; maxy: number },
  crs = DEFAULT_CRS,
): [[number, number], [number, number]] {
  const sw = projectToWgs84(bounds.minx, bounds.miny, crs)
  const ne = projectToWgs84(bounds.maxx, bounds.maxy, crs)
  const nw = projectToWgs84(bounds.minx, bounds.maxy, crs)
  const se = projectToWgs84(bounds.maxx, bounds.miny, crs)
  const lngs = [sw[0], ne[0], nw[0], se[0]]
  const lats = [sw[1], ne[1], nw[1], se[1]]
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ]
}

export function boundsToViewState(
  bounds: { minx: number; miny: number; maxx: number; maxy: number },
  crs = DEFAULT_CRS,
): { longitude: number; latitude: number; zoom: number } {
  const [[minLng, minLat], [maxLng, maxLat]] = boundsToWgs84(bounds, crs)
  return wgsBoundsToViewState(minLng, minLat, maxLng, maxLat)
}

/** Camera from already-WGS84 southwest / northeast corners. */
export function wgsBoundsToViewState(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): { longitude: number; latitude: number; zoom: number } {
  const longitude = (minLng + maxLng) / 2
  const latitude = (minLat + maxLat) / 2
  const lngSpan = Math.max(maxLng - minLng, 1e-6)
  const latSpan = Math.max(maxLat - minLat, 1e-6)
  const span = Math.max(lngSpan, latSpan)
  const zoom = Math.min(18, Math.max(3, Math.log2(360 / span) - 1.1))
  return { longitude, latitude, zoom }
}

/** Bounding box of a WGS84 FeatureCollection, or null if empty. */
export function geoJsonWgsBounds(
  geojson: FeatureCollection,
): [[number, number], [number, number]] | null {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const visit = (c: number[]) => {
    if (c.length < 2) return
    const lng = c[0]
    const lat = c[1]
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    minLng = Math.min(minLng, lng)
    minLat = Math.min(minLat, lat)
    maxLng = Math.max(maxLng, lng)
    maxLat = Math.max(maxLat, lat)
  }

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords) || coords.length === 0) return
    if (typeof coords[0] === 'number') {
      visit(coords as number[])
      return
    }
    for (const item of coords) walk(item)
  }

  for (const f of geojson.features) {
    if (!f.geometry || f.geometry.type === 'GeometryCollection') continue
    walk(f.geometry.coordinates)
  }

  if (!Number.isFinite(minLng)) return null
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ]
}
