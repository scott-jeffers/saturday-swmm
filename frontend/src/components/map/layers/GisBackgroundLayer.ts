/**
 * Sync DEM / vector background GIS overlays onto a MapLibre map.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GisLayer } from '../../../api/client'

function demInsertBeforeId(map: MapLibreMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    const id = layer.id
    if (
      id === 'background' ||
      id === 'osm' ||
      id === 'esri-imagery' ||
      id === 'esri-labels'
    ) {
      continue
    }
    if (id.startsWith('bg-dem-')) continue
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
  return demInsertBeforeId(map)
}

export function pinDemLayersBelowOverlays(map: MapLibreMap): void {
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    if (!layer.id.startsWith('bg-dem-')) continue
    if (!map.getLayer(layer.id)) continue
    const before = demInsertBeforeId(map)
    if (before) map.moveLayer(layer.id, before)
  }
}

/** Apply / update / remove background GIS layers from the current list. */
export function syncGisBackgroundLayers(
  map: MapLibreMap,
  backgroundLayers: GisLayer[],
): void {
  const desired = new Set(backgroundLayers.map((l) => l.id))
  const style = map.getStyle()
  for (const layer of style?.layers ?? []) {
    if (layer.id.startsWith('bg-dem-') || layer.id.startsWith('bg-vec-')) {
      const lid = layer.id
        .replace(/^bg-dem-/, '')
        .replace(/^bg-vec-fill-/, '')
        .replace(/^bg-vec-line-/, '')
      if (!desired.has(lid)) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id)
      }
    }
  }
  for (const srcId of Object.keys(style?.sources ?? {})) {
    if (!srcId.startsWith('bg-src-')) continue
    const lid = srcId.replace(/^bg-src-/, '')
    if (!desired.has(lid)) {
      const stillUsed = (map.getStyle()?.layers ?? []).some(
        (l) => 'source' in l && (l as { source?: string }).source === srcId,
      )
      if (!stillUsed && map.getSource(srcId)) map.removeSource(srcId)
    }
  }

  for (const layer of backgroundLayers) {
    const srcId = `bg-src-${layer.id}`
    if (layer.type === 'dem') {
      const layerId = `bg-dem-${layer.id}`
      const url = `/api/gis/preview/${encodeURIComponent(layer.id)}/hillshade.png`
      const b = layer.bounds
      if (!b) continue
      const coordinates: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ] = [
        [b.west, b.north],
        [b.east, b.north],
        [b.east, b.south],
        [b.west, b.south],
      ]
      const existing = map.getSource(srcId) as
        | { updateImage: (o: { url: string; coordinates: typeof coordinates }) => void }
        | undefined
      if (existing?.updateImage) {
        existing.updateImage({ url, coordinates })
      } else if (!map.getSource(srcId)) {
        map.addSource(srcId, { type: 'image', url, coordinates })
      }
      const before = demInsertBeforeId(map)
      if (!map.getLayer(layerId)) {
        map.addLayer(
          {
            id: layerId,
            type: 'raster',
            source: srcId,
            paint: {
              'raster-opacity': layer.visible ? layer.opacity : 0,
              'raster-fade-duration': 0,
            },
          },
          before,
        )
      } else {
        map.setPaintProperty(layerId, 'raster-opacity', layer.visible ? layer.opacity : 0)
        if (before) map.moveLayer(layerId, before)
      }
    } else {
      const fillId = `bg-vec-fill-${layer.id}`
      const lineId = `bg-vec-line-${layer.id}`
      const url = `/api/gis/preview/${encodeURIComponent(layer.id)}/vector.geojson`
      if (!map.getSource(srcId)) {
        map.addSource(srcId, { type: 'geojson', data: url })
      } else {
        const src = map.getSource(srcId) as { setData?: (u: string) => void }
        src.setData?.(url)
      }
      const before = vectorInsertBeforeId(map)
      const opacity = layer.visible ? layer.opacity : 0
      if (!map.getLayer(fillId)) {
        map.addLayer(
          {
            id: fillId,
            type: 'fill',
            source: srcId,
            filter: [
              'any',
              ['==', ['geometry-type'], 'Polygon'],
              ['==', ['geometry-type'], 'MultiPolygon'],
            ],
              paint: {
                'fill-color': '#94a3b8',
                'fill-opacity': opacity * 0.45,
                'fill-outline-color': '#64748b',
              },
            },
            before,
          )
        } else {
          map.setPaintProperty(fillId, 'fill-opacity', opacity * 0.45)
          if (before) map.moveLayer(fillId, before)
        }
        if (!map.getLayer(lineId)) {
          map.addLayer(
            {
              id: lineId,
              type: 'line',
              source: srcId,
              paint: {
                'line-color': '#475569',
                'line-width': 1.25,
                'line-opacity': opacity,
              },
            },
            before,
          )
        } else {
          map.setPaintProperty(lineId, 'line-opacity', opacity)
          if (before) map.moveLayer(lineId, before)
        }
    }
  }
  pinDemLayersBelowOverlays(map)
}
