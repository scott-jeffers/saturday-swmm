/**
 * MapLibre map bootstrap helpers (style + camera shell).
 * NetworkMap owns the instance; this module keeps init style definitions shared.
 */

import type { StyleSpecification } from 'maplibre-gl'

/** `custom`: an XYZ or WMS tile URL the user gives (see NetworkMap customTilesUrl). */
export type BasemapMode = 'projected' | 'osm' | 'hybrid' | 'custom'

export function emptyStyle(basemap: BasemapMode): StyleSpecification {
  if (basemap === 'osm') {
    return {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap',
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#dbe4ee' } },
        { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.9 } },
      ],
    }
  }
  if (basemap === 'hybrid') {
    return {
      version: 8,
      sources: {
        'esri-imagery': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri, Maxar, Earthstar Geographics',
        },
        'esri-labels': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri',
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
        {
          id: 'esri-imagery',
          type: 'raster',
          source: 'esri-imagery',
          paint: { 'raster-opacity': 1 },
        },
        {
          id: 'esri-labels',
          type: 'raster',
          source: 'esri-labels',
          paint: { 'raster-opacity': 0.95 },
        },
      ],
    }
  }
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
    ],
  }
}

export function isLightBasemap(basemap: BasemapMode): boolean {
  return basemap === 'osm' || basemap === 'hybrid' || basemap === 'custom'
}
