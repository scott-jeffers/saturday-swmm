/**
 * Sync DEM HAND floodplain onto a MapLibre map.
 * Prefers GeoJSON polygons (FEMA-style fill + outline); falls back to PNG.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'

export interface FlowAccumOverlay {
  available: boolean
  pngUrl?: string | null
  geojsonUrl?: string | null
  /** Changes when a new run finishes so MapLibre reloads sources. */
  revision?: string | number | null
  bounds?: {
    west: number
    south: number
    east: number
    north: number
  } | null
}

const RASTER_SRC = 'flow-accum-src'
const RASTER_LAYER = 'flow-accum-raster'
const POLY_SRC = 'flow-accum-poly-src'
const POLY_FILL = 'flow-accum-poly-fill'
const POLY_LINE = 'flow-accum-poly-line'

/** Floodpath cartography: warm pink fill (matches valley corridor maps). */
const FILL_COLOR = '#E891B0'
const LINE_COLOR = '#C2185B'

function insertBeforeId(map: MapLibreMap): string | undefined {
  for (const id of [
    'mesh-2d-fill',
    'mesh-2d-custom',
    'mesh-preview-fill',
    'mesh-aoi-fill',
    'mesh-boundaries',
    'subs-fill',
    'links-hit',
    'nodes-hit',
    'nodes',
  ]) {
    if (map.getLayer(id)) return id
  }
  return undefined
}

function cacheBust(url: string, rev: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(rev)}`
}

function clearRaster(map: MapLibreMap): void {
  if (map.getLayer(RASTER_LAYER)) map.removeLayer(RASTER_LAYER)
  if (map.getSource(RASTER_SRC)) map.removeSource(RASTER_SRC)
}

function clearPolygons(map: MapLibreMap): void {
  if (map.getLayer(POLY_LINE)) map.removeLayer(POLY_LINE)
  if (map.getLayer(POLY_FILL)) map.removeLayer(POLY_FILL)
  if (map.getSource(POLY_SRC)) map.removeSource(POLY_SRC)
}

function syncPolygons(
  map: MapLibreMap,
  geojsonUrl: string,
  rev: string,
  opacity: number,
): void {
  clearRaster(map)
  const url = cacheBust(geojsonUrl, rev)
  const existing = map.getSource(POLY_SRC) as { setData?: (u: string) => void } | undefined
  if (existing?.setData) {
    existing.setData(url)
  } else if (!map.getSource(POLY_SRC)) {
    map.addSource(POLY_SRC, { type: 'geojson', data: url })
  }

  const before = insertBeforeId(map)
  if (!map.getLayer(POLY_FILL)) {
    map.addLayer(
      {
        id: POLY_FILL,
        type: 'fill',
        source: POLY_SRC,
        paint: {
          'fill-color': FILL_COLOR,
          'fill-opacity': opacity * 0.62,
        },
      },
      before,
    )
  } else {
    map.setPaintProperty(POLY_FILL, 'fill-opacity', opacity * 0.55)
  }
  if (!map.getLayer(POLY_LINE)) {
    map.addLayer(
      {
        id: POLY_LINE,
        type: 'line',
        source: POLY_SRC,
        paint: {
          'line-color': LINE_COLOR,
          'line-width': 1.5,
          'line-opacity': Math.min(1, opacity * 0.95),
        },
      },
      before && map.getLayer(before) ? before : undefined,
    )
  } else {
    map.setPaintProperty(POLY_LINE, 'line-opacity', Math.min(1, opacity * 0.95))
  }
  // Keep outline above fill.
  if (map.getLayer(POLY_FILL) && map.getLayer(POLY_LINE)) {
    map.moveLayer(POLY_FILL, before)
    map.moveLayer(POLY_LINE, before)
  }
}

function syncRaster(
  map: MapLibreMap,
  pngUrl: string,
  bounds: NonNullable<FlowAccumOverlay['bounds']>,
  rev: string,
  opacity: number,
): void {
  clearPolygons(map)
  const coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ]
  const url = cacheBust(pngUrl, rev)
  const existing = map.getSource(RASTER_SRC) as
    | { updateImage: (o: { url: string; coordinates: typeof coordinates }) => void }
    | undefined
  if (existing?.updateImage) {
    existing.updateImage({ url, coordinates })
  } else if (!map.getSource(RASTER_SRC)) {
    map.addSource(RASTER_SRC, { type: 'image', url, coordinates })
  }

  const before = insertBeforeId(map)
  if (!map.getLayer(RASTER_LAYER)) {
    map.addLayer(
      {
        id: RASTER_LAYER,
        type: 'raster',
        source: RASTER_SRC,
        paint: {
          'raster-opacity': opacity,
          'raster-fade-duration': 0,
        },
      },
      before,
    )
  } else {
    map.setPaintProperty(RASTER_LAYER, 'raster-opacity', opacity)
    if (before) map.moveLayer(RASTER_LAYER, before)
  }
}

export function syncFlowAccumLayer(
  map: MapLibreMap,
  overlay: FlowAccumOverlay | null | undefined,
  visible: boolean,
  opacity = 0.9,
): void {
  const show = Boolean(visible && overlay?.available)
  if (!show) {
    clearRaster(map)
    clearPolygons(map)
    return
  }

  const rev = overlay!.revision != null ? String(overlay!.revision) : '1'
  // Prefer continuous PNG corridors (matches valley floodpath maps); polygons as fallback.
  if (overlay!.pngUrl && overlay!.bounds) {
    syncRaster(map, overlay!.pngUrl, overlay!.bounds, rev, opacity)
    return
  }
  if (overlay!.geojsonUrl) {
    syncPolygons(map, overlay!.geojsonUrl, rev, opacity)
  }
}
