/**
 * Draw background GIS layers on a MapLibre map: DEM hillshades, web tile
 * layers (XYZ, WMS, ArcGIS) and vector layers (fills, lines, points, labels),
 * stacked by z_order under the SWMM network.
 */

import type maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl'
import type { GisLayer } from '../../../api/client'
import { GLYPHS_URL, LABEL_FONT, LAYER_COLORS, tileTemplate } from '../../../lib/gisSources'

const BASEMAP_IDS = new Set(['background', 'osm', 'esri-imagery', 'esri-labels'])
const isBg = (id: string) => /^bg-(dem|tile|vec-(fill|line|pt|lbl))-/.test(id)
const isRasterBg = (id: string) => id.startsWith('bg-dem-') || id.startsWith('bg-tile-')

/** First layer above the basemap and the raster backgrounds. */
function rasterInsertBeforeId(map: MapLibreMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    const id = layer.id
    if (BASEMAP_IDS.has(id) || id.startsWith('canvas-') || isRasterBg(id)) continue
    return id
  }
  return undefined
}

function vectorInsertBeforeId(map: MapLibreMap): string | undefined {
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

/** Keep hillshades and web tiles at the bottom (another overlay may have been added above). */
export function pinDemLayersBelowOverlays(map: MapLibreMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (!isRasterBg(layer.id) || !map.getLayer(layer.id)) continue
    const before = rasterInsertBeforeId(map)
    if (before) map.moveLayer(layer.id, before)
  }
}

/** Ids of drawn vector GIS layers, for clicking on their features. */
export function gisVectorLayerIds(map: MapLibreMap): string[] {
  return (map.getStyle()?.layers ?? []).map((l) => l.id).filter((id) => /^bg-vec-(fill|line|pt)-/.test(id))
}

/** A stable colour for a layer without one. */
export function layerColor(layer: GisLayer): string {
  if (layer.style?.color) return layer.style.color
  let h = 0
  for (const c of layer.id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return LAYER_COLORS[h % LAYER_COLORS.length]!
}

type Tracked = { __bgKeys?: Map<string, string> }
const keys = (map: MapLibreMap) => ((map as unknown as Tracked).__bgKeys ??= new Map())

function upsert(map: MapLibreMap, spec: Parameters<MapLibreMap['addLayer']>[0], before: string | undefined) {
  if (!map.getLayer(spec.id)) map.addLayer(spec, before)
  else if (before && before !== spec.id) map.moveLayer(spec.id, before)
}

function setPaint(map: MapLibreMap, id: string, paint: Record<string, unknown>) {
  for (const [k, v] of Object.entries(paint)) map.setPaintProperty(id, k, v)
}

/** Apply / update / remove background GIS layers from the current list. */
export function syncGisBackgroundLayers(map: MapLibreMap, backgroundLayers: GisLayer[]): void {
  const ordered = [...backgroundLayers].sort((a, b) => a.z_order - b.z_order)
  const want = new Set<string>()
  const wantSrc = new Set(ordered.map((l) => `bg-src-${l.id}`))
  const k = keys(map)

  for (const layer of ordered) {
    const srcId = `bg-src-${layer.id}`
    const vis = layer.visible ? 'visible' : 'none'
    if (layer.type === 'dem' || layer.type === 'tiles') {
      const layerId = `${layer.type === 'dem' ? 'bg-dem-' : 'bg-tile-'}${layer.id}`
      want.add(layerId)
      let key: string
      if (layer.type === 'dem') {
        const b = layer.bounds
        if (!b) continue
        key = `dem|${b.west},${b.south},${b.east},${b.north}`
        const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
          [b.west, b.north],
          [b.east, b.north],
          [b.east, b.south],
          [b.west, b.south],
        ]
        if (k.get(srcId) !== key && map.getSource(srcId)) {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
          map.removeSource(srcId)
        }
        if (!map.getSource(srcId)) {
          map.addSource(srcId, { type: 'image', url: `/api/gis/preview/${encodeURIComponent(layer.id)}/hillshade.png`, coordinates })
        }
      } else {
        if (!layer.web) continue
        const tiles = tileTemplate(layer.web)
        key = `tiles|${tiles}`
        if (k.get(srcId) !== key && map.getSource(srcId)) {
          if (map.getLayer(layerId)) map.removeLayer(layerId)
          map.removeSource(srcId)
        }
        if (!map.getSource(srcId)) {
          map.addSource(srcId, { type: 'raster', tiles: [tiles], tileSize: 256, ...(layer.web.attribution ? { attribution: layer.web.attribution } : {}) })
        }
      }
      k.set(srcId, key)
      upsert(map, { id: layerId, type: 'raster', source: srcId, paint: { 'raster-opacity': layer.opacity, 'raster-fade-duration': 0 } }, rasterInsertBeforeId(map))
      map.setPaintProperty(layerId, 'raster-opacity', layer.opacity)
      map.setLayoutProperty(layerId, 'visibility', vis)
      continue
    }

    // vector
    const data = layer.data ?? `/api/gis/preview/${encodeURIComponent(layer.id)}/vector.geojson`
    const dataKey = typeof data === 'string' ? data : `inline|${layer.feature_count}|${layer.bounds?.west}|${layer.bounds?.north}`
    const src = map.getSource(srcId) as GeoJSONSource | undefined
    if (!src) map.addSource(srcId, { type: 'geojson', data })
    else if (k.get(srcId) !== dataKey) src.setData(data)
    k.set(srcId, dataKey)

    const color = layerColor(layer)
    const st = layer.style ?? {}
    const before = vectorInsertBeforeId(map)
    const ids = {
      fill: `bg-vec-fill-${layer.id}`,
      line: `bg-vec-line-${layer.id}`,
      pt: `bg-vec-pt-${layer.id}`,
      lbl: `bg-vec-lbl-${layer.id}`,
    }
    const polys: maplibregl.FilterSpecification = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']]
    const points: maplibregl.FilterSpecification = ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']]
    const fillPaint = { 'fill-color': color, 'fill-opacity': layer.opacity * (st.fill_opacity ?? 0.25) }
    const linePaint = { 'line-color': color, 'line-width': st.line_width ?? 1.5, 'line-opacity': layer.opacity }
    const ptPaint = {
      'circle-color': color,
      'circle-radius': st.point_radius ?? 4,
      'circle-opacity': layer.opacity,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
      'circle-stroke-opacity': layer.opacity,
    }
    upsert(map, { id: ids.fill, type: 'fill', source: srcId, filter: polys, paint: fillPaint }, before)
    upsert(map, { id: ids.line, type: 'line', source: srcId, filter: ['!', points], paint: linePaint }, before)
    upsert(map, { id: ids.pt, type: 'circle', source: srcId, filter: points, paint: ptPaint }, before)
    setPaint(map, ids.fill, fillPaint)
    setPaint(map, ids.line, linePaint)
    setPaint(map, ids.pt, ptPaint)
    for (const id of [ids.fill, ids.line, ids.pt]) {
      want.add(id)
      map.setLayoutProperty(id, 'visibility', vis)
    }

    if (st.label_field) {
      if (!map.getStyle()?.glyphs) map.setGlyphs(GLYPHS_URL)
      want.add(ids.lbl)
      const textField: maplibregl.ExpressionSpecification = ['to-string', ['get', st.label_field]]
      upsert(
        map,
        {
          id: ids.lbl,
          type: 'symbol',
          source: srcId,
          layout: { 'text-field': textField, 'text-font': LABEL_FONT, 'text-size': 11, 'text-max-width': 10, 'text-allow-overlap': false },
          paint: { 'text-color': color, 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4, 'text-opacity': layer.opacity },
        },
        before,
      )
      map.setLayoutProperty(ids.lbl, 'text-field', textField)
      map.setPaintProperty(ids.lbl, 'text-color', color)
      map.setLayoutProperty(ids.lbl, 'visibility', vis)
    }
  }

  // remove what's no longer wanted
  for (const layer of map.getStyle()?.layers ?? []) {
    if (isBg(layer.id) && !want.has(layer.id) && map.getLayer(layer.id)) map.removeLayer(layer.id)
  }
  for (const srcId of Object.keys(map.getStyle()?.sources ?? {})) {
    if (srcId.startsWith('bg-src-') && !wantSrc.has(srcId)) {
      if (map.getSource(srcId)) map.removeSource(srcId)
      k.delete(srcId)
    }
  }
  pinDemLayersBelowOverlays(map)
}
