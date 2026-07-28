import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Position } from 'geojson'
import type { ModelNetwork, OutSnapshotResponse, GisLayer, TwoDSnapshotResponse } from '../../api/client'
import {
  boundsToViewState,
  boundsToWgs84,
  geoJsonWgsBounds,
  reprojectGeoJson,
  wgs84ToProject,
} from '../../lib/projection'
import { clearCamera, getSavedCamera, saveCamera } from '../../lib/mapViewStore'
import { ensureNodeIcons, NODE_ICON_IDS } from '../../lib/nodeIcons'
import type { DrawMode } from './MapToolbar'

export type BasemapMode = 'projected' | 'osm'
export type Selection = {
  object_type: 'node' | 'link' | 'subcatchment'
  id: string
} | null

export type NodeKind = 'junction' | 'outfall' | 'storage'

interface NetworkMapProps {
  network: ModelNetwork
  basemap: BasemapMode
  showSubcatchments: boolean
  showLinks: boolean
  showJunctions?: boolean
  showOutfalls?: boolean
  showStorage?: boolean
  /** Background DEM / shapefile overlays (under network). */
  backgroundLayers?: GisLayer[]
  selection: Selection
  onSelect: (sel: Selection) => void
  snapshot?: OutSnapshotResponse | null
  /** When true, color by results (depth/flow/runoff). When false, color by object type. */
  resultsSymbology?: boolean
  /** 2D triangle mesh GeoJSON in project CRS (same as network). */
  meshGeoJson?: FeatureCollection | null
  show2dMesh?: boolean
  show2dDepth?: boolean
  twodSnapshot?: TwoDSnapshotResponse | null
  /** Preview mesh from generate API (project CRS). */
  meshPreviewGeoJson?: FeatureCollection | null
  /** AOI polygon vertices in WGS84 while drawing. */
  meshAoiDraft?: Position[]
  onMeshAoiDraftChange?: (ring: Position[]) => void
  /** Fired when polygon AOI is finished (project CRS ring, open). */
  onMeshAoiComplete?: (ring: number[][]) => void
  profileNodeIds?: string[]
  profileLinkIds?: string[]
  profilePickMode?: 'start' | 'end' | null
  onProfileNodePick?: (nodeId: string) => void
  onNodeDragEnd?: (nodeId: string, x: number, y: number) => void
  drawMode?: DrawMode
  pendingLinkFromId?: string | null
  polygonDraft?: Position[]
  onCreateNode?: (kind: NodeKind, x: number, y: number) => void
  onCreateLink?: (fromId: string, toId: string) => void
  onLinkFromPicked?: (nodeId: string | null) => void
  onPolygonDraftChange?: (ring: Position[]) => void
  onCreateSubcatchment?: (ring: Position[]) => void
  onRequestDelete?: (sel: NonNullable<Selection>) => void
  /** Stable key for camera persistence (e.g. project path). */
  projectKey?: string
  /** When false, map is hidden — call resize when becoming true. */
  visible?: boolean
  /** Increment to fit network bounds. */
  fitExtentNonce?: number
  /** Zoom map to these WGS84 bounds (west/south/east/north). Bump nonce each request. */
  fitWgsBoundsRequest?: {
    nonce: number
    west: number
    south: number
    east: number
    north: number
  } | null
}

function emptyStyle(basemap: BasemapMode): maplibregl.StyleSpecification {
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
  return {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b1220' } },
    ],
  }
}

/** Insert DEM rasters immediately above basemap / below all overlays. */
function demInsertBeforeId(map: MapLibreMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    const id = layer.id
    if (id === 'background' || id === 'osm') continue
    if (id.startsWith('bg-dem-')) continue
    return id
  }
  return undefined
}

/** Vectors sit above DEM but under mesh results / network. */
function vectorInsertBeforeId(map: MapLibreMap): string | undefined {
  for (const id of [
    'mesh-2d-fill',
    'mesh-preview-fill',
    'mesh-aoi-fill',
    'subs-fill',
    'links-hit',
    'nodes-hit',
    'nodes',
  ]) {
    if (map.getLayer(id)) return id
  }
  return demInsertBeforeId(map)
}

/** Keep DEM hillshades above basemap and below mesh/results/network. */
function pinDemLayersBelowOverlays(map: MapLibreMap): void {
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    if (!layer.id.startsWith('bg-dem-')) continue
    if (!map.getLayer(layer.id)) continue
    const before = demInsertBeforeId(map)
    if (before) map.moveLayer(layer.id, before)
  }
}

/** North + Plan View controls under the zoom buttons. */
class OrientationControl implements maplibregl.IControl {
  private _container: HTMLDivElement | undefined

  onAdd(map: MapLibreMap): HTMLElement {
    const container = document.createElement('div')
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    container.setAttribute('data-testid', 'map-orientation-ctrl')

    const north = document.createElement('button')
    north.type = 'button'
    north.className = 'maplibregl-ctrl-icon'
    north.title = 'North (reset bearing)'
    north.setAttribute('aria-label', 'North')
    north.textContent = 'N'
    north.style.cssText =
      'font: 700 12px/20px system-ui,sans-serif; width: 29px; height: 29px; display: flex; align-items: center; justify-content: center;'
    north.addEventListener('click', (e) => {
      e.preventDefault()
      map.easeTo({ bearing: 0, duration: 400 })
    })

    const plan = document.createElement('button')
    plan.type = 'button'
    plan.className = 'maplibregl-ctrl-icon'
    plan.title = 'Plan view (top-down)'
    plan.setAttribute('aria-label', 'Plan view')
    plan.textContent = '2D'
    plan.style.cssText =
      'font: 700 10px/20px system-ui,sans-serif; width: 29px; height: 29px; display: flex; align-items: center; justify-content: center;'
    plan.addEventListener('click', (e) => {
      e.preventDefault()
      map.easeTo({ pitch: 0, bearing: 0, duration: 400 })
    })

    container.appendChild(north)
    container.appendChild(plan)
    this._container = container
    return container
  }

  onRemove(): void {
    this._container?.remove()
    this._container = undefined
  }
}

function enrichWithSnapshot(
  geojson: FeatureCollection,
  snapshot?: OutSnapshotResponse | null,
): FeatureCollection {
  if (!snapshot) return geojson
  const depthMap = new globalThis.Map(
    snapshot.node_ids.map((id, i) => [id, snapshot.node_depths[i]] as [string, number]),
  )
  const flowMap = new globalThis.Map(
    snapshot.link_ids.map((id, i) => [id, snapshot.link_flows[i]] as [string, number]),
  )
  const runoffIds = snapshot.subcatchment_ids ?? []
  const runoffVals = snapshot.subcatchment_runoffs ?? []
  const runoffMap = new globalThis.Map(
    runoffIds.map((id, i) => [id, runoffVals[i]] as [string, number]),
  )
  return {
    type: 'FeatureCollection',
    features: geojson.features.map((f: Feature) => {
      const props = { ...(f.properties ?? {}) }
      const id = String(props.id ?? '')
      if (props.object_type === 'node' && depthMap.has(id)) props.depth = depthMap.get(id)
      if (props.object_type === 'link' && flowMap.has(id))
        props.flow = Math.abs(flowMap.get(id) ?? 0)
      if (props.object_type === 'subcatchment' && runoffMap.has(id))
        props.runoff = Math.abs(runoffMap.get(id) ?? 0)
      return { ...f, properties: props }
    }),
  }
}

function enrichMeshWithSnapshot(
  geojson: FeatureCollection,
  snapshot?: TwoDSnapshotResponse | null,
): FeatureCollection {
  if (!snapshot) return geojson
  return {
    type: 'FeatureCollection',
    features: geojson.features.map((f: Feature) => {
      const props = { ...(f.properties ?? {}) }
      const idx = Number(props.triangle_index ?? props.id)
      if (Number.isFinite(idx) && idx >= 0 && idx < snapshot.values.length) {
        props.depth = snapshot.values[idx]
      }
      return { ...f, properties: props }
    }),
  }
}

function meshDepthColorExpr(depthMax: number): maplibregl.ExpressionSpecification {
  const max = Math.max(depthMax, 0.001)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'depth'], 0],
    0,
    'rgba(14,165,233,0)',
    max * 0.05,
    '#0ea5e9',
    max * 0.35,
    '#22c55e',
    max * 0.65,
    '#eab308',
    max,
    '#ef4444',
  ]
}

function splitByType(fc: FeatureCollection) {
  const nodes: FeatureCollection = { type: 'FeatureCollection', features: [] }
  const links: FeatureCollection = { type: 'FeatureCollection', features: [] }
  const subs: FeatureCollection = { type: 'FeatureCollection', features: [] }
  for (const f of fc.features) {
    const t = f.properties?.object_type
    if (t === 'node') nodes.features.push(f)
    else if (t === 'link') links.features.push(f)
    else if (t === 'subcatchment') subs.features.push(f)
  }
  return { nodes, links, subs }
}

/** 64px SDF glyphs — scale with zoom so overview stays readable */
function nodeIconSizeExpr(): maplibregl.ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    0.11,
    12,
    0.15,
    14,
    0.22,
    16,
    0.34,
    18,
    0.46,
  ]
}

function nodeHitRadiusExpr(): maplibregl.ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 10, 18, 14]
}

function nodeImageExpr(): maplibregl.ExpressionSpecification {
  return [
    'match',
    ['get', 'node_kind'],
    'outfall',
    NODE_ICON_IDS.outfall,
    'storage',
    NODE_ICON_IDS.storage,
    NODE_ICON_IDS.junction,
  ]
}

function junctionDepthColorExpr(depthMax: number): maplibregl.ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'depth'], 0],
    0,
    '#38bdf8',
    depthMax * 0.25,
    '#22c55e',
    depthMax * 0.6,
    '#eab308',
    depthMax,
    '#ef4444',
  ]
}

function ensureLayers(
  map: MapLibreMap,
  basemap: BasemapMode,
  depthMax: number,
  flowMax: number,
  runoffMax: number,
  resultsSymbology: boolean,
  twodDepthMax = 0.01,
) {
  if (!map.getSource('mesh-2d')) {
    map.addSource('mesh-2d', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getSource('mesh-preview')) {
    map.addSource('mesh-preview', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getSource('mesh-aoi')) {
    map.addSource('mesh-aoi', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getSource('subs')) {
    map.addSource('subs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getSource('links')) {
    map.addSource('links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getSource('nodes')) {
    map.addSource('nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getSource('draw-temp')) {
    map.addSource('draw-temp', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  // Mesh under 1D network (above GIS backgrounds)
  if (!map.getLayer('mesh-2d-fill')) {
    map.addLayer({
      id: 'mesh-2d-fill',
      type: 'fill',
      source: 'mesh-2d',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': meshDepthColorExpr(twodDepthMax),
        'fill-opacity': 0.72,
      },
    })
    map.addLayer({
      id: 'mesh-2d-outline',
      type: 'line',
      source: 'mesh-2d',
      layout: { visibility: 'none' },
      paint: {
        'line-color': basemap === 'osm' ? '#64748b' : '#94a3b8',
        'line-width': 0.4,
        'line-opacity': 0.55,
      },
    })
  }
  if (!map.getLayer('mesh-preview-fill')) {
    map.addLayer({
      id: 'mesh-preview-fill',
      type: 'fill',
      source: 'mesh-preview',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': '#f59e0b',
        'fill-opacity': 0.22,
      },
    })
    map.addLayer({
      id: 'mesh-preview-outline',
      type: 'line',
      source: 'mesh-preview',
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#d97706',
        'line-width': 0.6,
        'line-opacity': 0.85,
      },
    })
  }
  if (!map.getLayer('mesh-aoi-fill')) {
    map.addLayer({
      id: 'mesh-aoi-fill',
      type: 'fill',
      source: 'mesh-aoi',
      paint: {
        'fill-color': '#6366f1',
        'fill-opacity': 0.12,
      },
    })
    map.addLayer({
      id: 'mesh-aoi-outline',
      type: 'line',
      source: 'mesh-aoi',
      paint: {
        'line-color': '#4f46e5',
        'line-width': 2,
        'line-dasharray': [2, 1],
      },
    })
  }

  if (!map.getLayer('subs-fill')) {
    map.addLayer({
      id: 'subs-fill',
      type: 'fill',
      source: 'subs',
      paint: {
        'fill-color': '#16a34a',
        'fill-opacity': basemap === 'osm' ? 0.28 : 0.4,
      },
    })
    map.addLayer({
      id: 'subs-outline',
      type: 'line',
      source: 'subs',
      paint: { 'line-color': '#166534', 'line-width': 1, 'line-opacity': 0.7 },
    })
  }
  if (!map.getLayer('subs-selected')) {
    map.addLayer({
      id: 'subs-selected',
      type: 'fill',
      source: 'subs',
      filter: ['==', 'id', ''],
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.35 },
    })
    map.addLayer({
      id: 'subs-selected-outline',
      type: 'line',
      source: 'subs',
      filter: ['==', 'id', ''],
      paint: { 'line-color': '#ef4444', 'line-width': 3 },
    })
  }

  if (!map.getLayer('links')) {
    map.addLayer({
      id: 'links-hit',
      type: 'line',
      source: 'links',
      paint: { 'line-color': '#000', 'line-width': 12, 'line-opacity': 0 },
    })
    map.addLayer({
      id: 'links',
      type: 'line',
      source: 'links',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-opacity': 0.95 },
    })
    map.addLayer({
      id: 'links-selected',
      type: 'line',
      source: 'links',
      filter: ['==', 'id', ''],
      paint: { 'line-color': '#ef4444', 'line-width': 5 },
    })
    map.addLayer({
      id: 'links-profile',
      type: 'line',
      source: 'links',
      filter: ['==', 'id', ''],
      paint: { 'line-color': '#f59e0b', 'line-width': 5 },
    })
  }

  // Rebuild node layers when migrating off SDF/halo (black squares) to baked-border icons
  if (
    map.getLayer('nodes') &&
    (!map.getLayer('nodes-junction-depth') || !map.hasImage(NODE_ICON_IDS.junction))
  ) {
    for (const id of [
      'nodes-profile',
      'nodes-selected',
      'nodes-junction-depth',
      'nodes',
      'nodes-hit',
    ]) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
  }

  if (map.getLayer('nodes') && map.getLayer('nodes')?.type !== 'symbol') {
    for (const id of [
      'nodes-profile',
      'nodes-selected',
      'nodes-junction-depth',
      'nodes',
      'nodes-hit',
    ]) {
      if (map.getLayer(id)) map.removeLayer(id)
    }
  }

  if (!map.getLayer('nodes')) {
    ensureNodeIcons(map)
    map.addLayer({
      id: 'nodes-hit',
      type: 'circle',
      source: 'nodes',
      paint: { 'circle-radius': nodeHitRadiusExpr(), 'circle-opacity': 0 },
    })
    map.addLayer({
      id: 'nodes',
      type: 'symbol',
      source: 'nodes',
      layout: {
        'icon-image': nodeImageExpr(),
        'icon-size': nodeIconSizeExpr(),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
    map.addLayer({
      id: 'nodes-junction-depth',
      type: 'circle',
      source: 'nodes',
      filter: ['==', 'node_kind', 'junction'],
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 5, 18, 7],
        'circle-color': '#38bdf8',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#000000',
      },
    })
    map.addLayer({
      id: 'nodes-selected',
      type: 'circle',
      source: 'nodes',
      filter: ['==', 'id', ''],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7.5, 18, 11],
        'circle-color': 'transparent',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ef4444',
      },
    })
    map.addLayer({
      id: 'nodes-profile',
      type: 'circle',
      source: 'nodes',
      filter: ['==', 'id', ''],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 14, 7, 18, 10],
        'circle-color': 'transparent',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f59e0b',
      },
    })
  } else {
    ensureNodeIcons(map)
    map.setLayoutProperty('nodes', 'icon-size', nodeIconSizeExpr())
    map.setLayoutProperty('nodes', 'icon-image', nodeImageExpr())
    if (map.getLayer('nodes-hit')) {
      map.setPaintProperty('nodes-hit', 'circle-radius', nodeHitRadiusExpr())
    }
  }

  if (!map.getLayer('draw-temp-fill')) {
    map.addLayer({
      id: 'draw-temp-fill',
      type: 'fill',
      source: 'draw-temp',
      filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.2 },
    })
    map.addLayer({
      id: 'draw-temp-line',
      type: 'line',
      source: 'draw-temp',
      paint: { 'line-color': '#38bdf8', 'line-width': 2, 'line-dasharray': [2, 1] },
    })
    map.addLayer({
      id: 'draw-temp-points',
      type: 'circle',
      source: 'draw-temp',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#38bdf8',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#fff',
      },
    })
  }

  if (resultsSymbology) {
    map.setPaintProperty('links', 'line-color', [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'flow'], 0],
      0,
      '#2563eb',
      flowMax * 0.5,
      '#06b6d4',
      flowMax,
      '#ea580c',
    ])
    map.setPaintProperty('links', 'line-width', [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'flow'], 0],
      0,
      2,
      flowMax,
      6,
    ])
    if (map.getLayer('nodes-junction-depth')) {
      map.setLayoutProperty('nodes-junction-depth', 'visibility', 'visible')
      map.setPaintProperty('nodes-junction-depth', 'circle-color', junctionDepthColorExpr(depthMax))
    }
    // Hide baked junction symbols while depth circles show; keep outfall/storage icons
    map.setFilter('nodes', [
      'match',
      ['get', 'node_kind'],
      ['outfall', 'storage'],
      true,
      false,
    ])
    map.setPaintProperty('subs-fill', 'fill-color', [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'runoff'], 0],
      0,
      '#14532d',
      runoffMax * 0.25,
      '#22c55e',
      runoffMax * 0.6,
      '#eab308',
      runoffMax,
      '#ef4444',
    ])
  } else {
    map.setPaintProperty('links', 'line-color', [
      'match',
      ['get', 'link_kind'],
      'pump',
      '#db2777',
      'orifice',
      '#7c3aed',
      'weir',
      '#ca8a04',
      'outlet',
      '#ea580c',
      '#1d4ed8',
    ])
    map.setPaintProperty('links', 'line-width', 2.5)
    if (map.getLayer('nodes-junction-depth')) {
      map.setLayoutProperty('nodes-junction-depth', 'visibility', 'none')
    }
    map.setFilter('nodes', null)
    map.setPaintProperty('subs-fill', 'fill-color', '#16a34a')
  }

  map.setPaintProperty('subs-fill', 'fill-opacity', basemap === 'osm' ? 0.28 : 0.45)
}

function draftCollection(ring: Position[]): FeatureCollection {
  const features: Feature[] = ring.map((c) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: c },
  }))
  if (ring.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: ring },
    })
  }
  if (ring.length >= 3) {
    const closed = [...ring, ring[0]]
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closed] },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function NetworkMap({
  network,
  basemap,
  showSubcatchments,
  showLinks,
  showJunctions = true,
  showOutfalls = true,
  showStorage = true,
  backgroundLayers = [],
  selection,
  onSelect,
  snapshot,
  resultsSymbology = false,
  meshGeoJson = null,
  show2dMesh = false,
  show2dDepth = false,
  twodSnapshot = null,
  meshPreviewGeoJson = null,
  meshAoiDraft = [],
  onMeshAoiDraftChange,
  onMeshAoiComplete,
  profileNodeIds = [],
  profileLinkIds = [],
  profilePickMode = null,
  onProfileNodePick,
  onNodeDragEnd,
  drawMode = 'select',
  pendingLinkFromId = null,
  polygonDraft = [],
  onCreateNode,
  onCreateLink,
  onLinkFromPicked,
  onPolygonDraftChange,
  onCreateSubcatchment,
  onRequestDelete,
  projectKey = 'default',
  visible = true,
  fitExtentNonce = 0,
  fitWgsBoundsRequest = null,
}: NetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const dragNodeIdRef = useRef<string | null>(null)
  const middlePanRef = useRef({ active: false, lastX: 0, lastY: 0 })
  const projectKeyRef = useRef(projectKey)
  projectKeyRef.current = projectKey
  /** Fit extent once network data is ready after open / toolbar request */
  const pendingFitRef = useRef(true)
  /** Project path we last successfully fitted — avoids fitting stale network on switch */
  const lastFittedProjectRef = useRef<string | null>(null)

  const handlersRef = useRef({
    onSelect,
    onProfileNodePick,
    onNodeDragEnd,
    profilePickMode,
    networkCrs: network.crs,
    drawMode,
    pendingLinkFromId,
    polygonDraft,
    meshAoiDraft,
    onCreateNode,
    onCreateLink,
    onLinkFromPicked,
    onPolygonDraftChange,
    onCreateSubcatchment,
    onRequestDelete,
    onMeshAoiDraftChange,
    onMeshAoiComplete,
  })

  handlersRef.current = {
    onSelect,
    onProfileNodePick,
    onNodeDragEnd,
    profilePickMode,
    networkCrs: network.crs,
    drawMode,
    pendingLinkFromId,
    polygonDraft,
    meshAoiDraft,
    onCreateNode,
    onCreateLink,
    onLinkFromPicked,
    onPolygonDraftChange,
    onCreateSubcatchment,
    onRequestDelete,
    onMeshAoiDraftChange,
    onMeshAoiComplete,
  }

  const wgsGeojson = useMemo(
    () => reprojectGeoJson(network.geojson, network.crs),
    [network.geojson, network.crs],
  )
  const wgsGeojsonRef = useRef(wgsGeojson)
  wgsGeojsonRef.current = wgsGeojson
  const networkRef = useRef(network)
  networkRef.current = network

  const wgsMesh = useMemo(() => {
    if (!meshGeoJson) return null
    return reprojectGeoJson(meshGeoJson, network.crs)
  }, [meshGeoJson, network.crs])
  const meshData = useMemo(
    () => (wgsMesh ? enrichMeshWithSnapshot(wgsMesh, twodSnapshot) : null),
    [wgsMesh, twodSnapshot],
  )
  const meshDataRef = useRef(meshData)
  meshDataRef.current = meshData

  const applyPendingFit = () => {
    if (!pendingFitRef.current) return
    const map = mapRef.current
    if (!map) return
    // Don't wait on raster tiles — only the style must be ready
    if (!map.isStyleLoaded()) {
      map.once('idle', () => applyPendingFitRef.current())
      return
    }

    const featureBounds = geoJsonWgsBounds(wgsGeojsonRef.current)
    const meshBounds = meshDataRef.current
      ? geoJsonWgsBounds(meshDataRef.current)
      : null
    let swNe: [[number, number], [number, number]] | null = featureBounds
    if (meshBounds) {
      if (!swNe) {
        swNe = meshBounds
      } else {
        swNe = [
          [
            Math.min(swNe[0][0], meshBounds[0][0]),
            Math.min(swNe[0][1], meshBounds[0][1]),
          ],
          [
            Math.max(swNe[1][0], meshBounds[1][0]),
            Math.max(swNe[1][1], meshBounds[1][1]),
          ],
        ]
      }
    }
    if (!swNe && networkRef.current.bounds) {
      swNe = boundsToWgs84(networkRef.current.bounds, networkRef.current.crs)
    }
    if (!swNe) return

    const [[minLng, minLat], [maxLng, maxLat]] = swNe
    // Degenerate / empty → skip (keep pending)
    if (!(maxLng > minLng) || !(maxLat > minLat)) {
      if (Math.abs(maxLng - minLng) < 1e-9 && Math.abs(maxLat - minLat) < 1e-9) {
        pendingFitRef.current = false
        lastFittedProjectRef.current = projectKeyRef.current
        map.jumpTo({ center: [minLng, minLat], zoom: 16 })
        return
      }
    }

    pendingFitRef.current = false
    lastFittedProjectRef.current = projectKeyRef.current
    map.resize()
    map.stop()
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: { top: 56, bottom: 56, left: 56, right: 56 },
        duration: 0,
        maxZoom: 17,
      },
    )
  }
  const applyPendingFitRef = useRef(applyPendingFit)
  applyPendingFitRef.current = applyPendingFit
  const data = useMemo(
    () => enrichWithSnapshot(wgsGeojson, snapshot),
    [wgsGeojson, snapshot],
  )
  const { nodes, links, subs } = useMemo(() => splitByType(data), [data])
  const depthMax = Math.max(snapshot?.node_depth_max ?? 0.01, 0.01)
  const flowMax = Math.max(snapshot?.link_flow_max ?? 0.01, 0.01)
  const runoffMax = Math.max(snapshot?.subcatchment_runoff_max ?? 0.01, 0.01)
  const twodDepthMax = Math.max(twodSnapshot?.value_max ?? 0.01, 0.01)
  const extentView = useMemo(() => {
    if (network.bounds) return boundsToViewState(network.bounds, network.crs)
    return { longitude: 10.35, latitude: 55.35, zoom: 12 }
  }, [network.bounds, network.crs])

  const initialCamera = useMemo(() => {
    const saved = getSavedCamera(projectKey)
    if (saved) return saved
    return { ...extentView, bearing: 0, pitch: 0 }
    // Only for first mount of this map instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: emptyStyle(basemap),
      center: [initialCamera.longitude, initialCamera.latitude],
      zoom: initialCamera.zoom,
      bearing: initialCamera.bearing ?? 0,
      pitch: initialCamera.pitch ?? 0,
      attributionControl: basemap === 'osm' ? {} : false,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      maxPitch: 85,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    map.addControl(new OrientationControl(), 'top-left')
    mapRef.current = map

    const canvas = map.getCanvas()
    const blockContextMenu = (e: Event) => e.preventDefault()
    canvas.addEventListener('contextmenu', blockContextMenu)

    const persistCamera = () => {
      const c = map.getCenter()
      saveCamera(projectKeyRef.current, {
        longitude: c.lng,
        latitude: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      })
    }
    map.on('moveend', persistCamera)

    map.on('load', () => {
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax)
      ;(map.getSource('subs') as GeoJSONSource)?.setData(subs)
      ;(map.getSource('links') as GeoJSONSource)?.setData(links)
      ;(map.getSource('nodes') as GeoJSONSource)?.setData(nodes)
      if (meshData) {
        ;(map.getSource('mesh-2d') as GeoJSONSource)?.setData(meshData)
      }
      map.getCanvas().style.cursor = 'grab'
      // Fit as soon as style is up (network may arrive later via effect)
      requestAnimationFrame(() => applyPendingFitRef.current())
    })

    const selectableLayers = () =>
      ['nodes', 'nodes-hit', 'links', 'links-hit', 'subs-fill'].filter((id) =>
        Boolean(map.getLayer(id)),
      )

    const pickFeature = (point: maplibregl.PointLike) => {
      const feats = map.queryRenderedFeatures(point, { layers: selectableLayers() })
      const node = feats.find((f) => f.properties?.object_type === 'node')
      if (node) return node
      const link = feats.find((f) => f.properties?.object_type === 'link')
      if (link) return link
      return feats.find((f) => f.properties?.object_type === 'subcatchment') ?? null
    }

    map.on('click', (e) => {
      const h = handlersRef.current
      const mode = h.drawMode

      if (mode.startsWith('add-') && mode !== 'add-conduit' && mode !== 'add-subcatchment') {
        const kind = mode.replace('add-', '') as NodeKind
        const [x, y] = wgs84ToProject(e.lngLat.lng, e.lngLat.lat, h.networkCrs)
        h.onCreateNode?.(kind, x, y)
        return
      }

      if (mode === 'add-conduit') {
        const feats = map.queryRenderedFeatures(e.point, {
          layers: ['nodes', 'nodes-hit'].filter((id) => Boolean(map.getLayer(id))),
        })
        const node = feats.find((f) => f.properties?.object_type === 'node')
        if (!node?.properties) return
        const id = String(node.properties.id)
        if (!h.pendingLinkFromId) {
          h.onLinkFromPicked?.(id)
          return
        }
        if (h.pendingLinkFromId === id) return
        h.onCreateLink?.(h.pendingLinkFromId, id)
        h.onLinkFromPicked?.(null)
        return
      }

      if (mode === 'add-subcatchment') {
        const coord: Position = [e.lngLat.lng, e.lngLat.lat]
        const next = [...h.polygonDraft, coord]
        h.onPolygonDraftChange?.(next)
        return
      }

      if (mode === 'draw-mesh-aoi') {
        const coord: Position = [e.lngLat.lng, e.lngLat.lat]
        const next = [...(h.meshAoiDraft ?? []), coord]
        h.onMeshAoiDraftChange?.(next)
        return
      }

      if (mode === 'delete') {
        const f = pickFeature(e.point)
        if (!f?.properties) return
        h.onRequestDelete?.({
          object_type: String(f.properties.object_type) as NonNullable<Selection>['object_type'],
          id: String(f.properties.id),
        })
        return
      }

      const f = pickFeature(e.point)
      if (!f?.properties) {
        h.onSelect(null)
        return
      }
      const object_type = String(f.properties.object_type) as NonNullable<Selection>['object_type']
      const id = String(f.properties.id)
      if (h.profilePickMode && object_type === 'node' && h.onProfileNodePick) {
        h.onProfileNodePick(id)
        return
      }
      h.onSelect({ object_type, id })
    })

    map.on('dblclick', (e) => {
      const h = handlersRef.current
      if (h.drawMode === 'add-subcatchment') {
        e.preventDefault()
        if (h.polygonDraft.length >= 3) {
          h.onCreateSubcatchment?.(h.polygonDraft)
        }
        return
      }
      if (h.drawMode === 'draw-mesh-aoi') {
        e.preventDefault()
        const draft = h.meshAoiDraft ?? []
        if (draft.length < 3) return
        const ring = draft.map(([lng, lat]) =>
          wgs84ToProject(lng, lat, h.networkCrs),
        )
        h.onMeshAoiComplete?.(ring)
      }
    })

    map.on('mousemove', (e) => {
      if (dragNodeIdRef.current || middlePanRef.current.active) return
      if (e.originalEvent.buttons !== 0) return
      const h = handlersRef.current
      if (h.profilePickMode || h.drawMode !== 'select') {
        map.getCanvas().style.cursor = 'crosshair'
        return
      }
      const f = pickFeature(e.point)
      map.getCanvas().style.cursor = f ? 'pointer' : 'grab'
    })
    map.on('mouseout', () => {
      if (dragNodeIdRef.current || middlePanRef.current.active) return
      const h = handlersRef.current
      map.getCanvas().style.cursor =
        h.profilePickMode || h.drawMode !== 'select' ? 'crosshair' : 'grab'
    })

    const onMiddleDown = (ev: MouseEvent) => {
      if (ev.button !== 1) return
      ev.preventDefault()
      middlePanRef.current = { active: true, lastX: ev.clientX, lastY: ev.clientY }
      canvas.style.cursor = 'grabbing'
    }
    const onMiddleMove = (ev: MouseEvent) => {
      const state = middlePanRef.current
      if (!state.active) return
      const dx = ev.clientX - state.lastX
      const dy = ev.clientY - state.lastY
      state.lastX = ev.clientX
      state.lastY = ev.clientY
      map.panBy([-dx, -dy], { animate: false })
    }
    const onMiddleUp = () => {
      if (!middlePanRef.current.active) return
      middlePanRef.current.active = false
      const h = handlersRef.current
      canvas.style.cursor =
        h.profilePickMode || h.drawMode !== 'select' ? 'crosshair' : 'grab'
    }
    const preventAutoScroll = (ev: MouseEvent) => {
      if (ev.button === 1) ev.preventDefault()
    }
    canvas.addEventListener('mousedown', onMiddleDown)
    window.addEventListener('mousemove', onMiddleMove)
    window.addEventListener('mouseup', onMiddleUp)
    canvas.addEventListener('auxclick', preventAutoScroll)
    canvas.addEventListener('mousedown', preventAutoScroll)

    map.on('mousedown', (e) => {
      if (e.originalEvent.button === 1) return
      if (handlersRef.current.drawMode !== 'select') return
      if (!e.originalEvent.altKey || handlersRef.current.profilePickMode) return
      const feats = map.queryRenderedFeatures(e.point, {
        layers: ['nodes', 'nodes-hit'].filter((id) => Boolean(map.getLayer(id))),
      })
      const f = feats.find((feat) => feat.properties?.object_type === 'node')
      if (!f?.properties) return
      e.preventDefault()
      dragNodeIdRef.current = String(f.properties.id)
      map.dragPan.disable()
      map.dragRotate.disable()
      map.getCanvas().style.cursor = 'grabbing'
    })

    const endDrag = (e?: maplibregl.MapMouseEvent) => {
      const id = dragNodeIdRef.current
      if (!id) return
      dragNodeIdRef.current = null
      map.dragPan.enable()
      map.dragRotate.enable()
      const h = handlersRef.current
      map.getCanvas().style.cursor =
        h.profilePickMode || h.drawMode !== 'select' ? 'crosshair' : 'grab'
      if (e) {
        const [x, y] = wgs84ToProject(e.lngLat.lng, e.lngLat.lat, h.networkCrs)
        h.onNodeDragEnd?.(id, x, y)
      }
    }
    map.on('mouseup', endDrag)
    const windowMouseUp = () => endDrag()
    window.addEventListener('mouseup', windowMouseUp)

    const onKey = (ev: KeyboardEvent) => {
      const h = handlersRef.current
      if (ev.key === 'Escape') {
        h.onLinkFromPicked?.(null)
        h.onPolygonDraftChange?.([])
        return
      }
      if (
        (ev.key === 'Enter' || ev.key === ' ') &&
        h.drawMode === 'add-subcatchment' &&
        h.polygonDraft.length >= 3
      ) {
        ev.preventDefault()
        h.onCreateSubcatchment?.(h.polygonDraft)
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      canvas.removeEventListener('contextmenu', blockContextMenu)
      canvas.removeEventListener('mousedown', onMiddleDown)
      window.removeEventListener('mousemove', onMiddleMove)
      window.removeEventListener('mouseup', onMiddleUp)
      canvas.removeEventListener('auxclick', preventAutoScroll)
      canvas.removeEventListener('mousedown', preventAutoScroll)
      window.removeEventListener('mouseup', windowMouseUp)
      window.removeEventListener('keydown', onKey)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const ensureOsm = () => {
      if (!map.getSource('osm')) {
        map.addSource('osm', {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap',
        })
      }
      if (!map.getLayer('osm')) {
        map.addLayer(
          { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.9 } },
          map.getLayer('subs-fill') ? 'subs-fill' : undefined,
        )
      }
    }

    if (basemap === 'osm') {
      ensureOsm()
      if (map.getLayer('osm')) map.setLayoutProperty('osm', 'visibility', 'visible')
      map.setPaintProperty('background', 'background-color', '#dbe4ee')
    } else {
      if (map.getLayer('osm')) map.setLayoutProperty('osm', 'visibility', 'none')
      map.setPaintProperty('background', 'background-color', '#0b1220')
    }
    if (map.getLayer('subs-fill')) {
      map.setPaintProperty('subs-fill', 'fill-opacity', basemap === 'osm' ? 0.28 : 0.4)
    }
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax)
    ;(map.getSource('subs') as GeoJSONSource)?.setData(
      showSubcatchments ? subs : { type: 'FeatureCollection', features: [] },
    )
    ;(map.getSource('links') as GeoJSONSource)?.setData(
      showLinks ? links : { type: 'FeatureCollection', features: [] },
    )
    const visibleNodes: FeatureCollection = {
      type: 'FeatureCollection',
      features: nodes.features.filter((f) => {
        const kind = String(f.properties?.node_kind ?? 'junction')
        if (kind === 'outfall') return showOutfalls
        if (kind === 'storage') return showStorage
        return showJunctions
      }),
    }
    ;(map.getSource('nodes') as GeoJSONSource)?.setData(visibleNodes)

    if (map.getSource('mesh-2d')) {
      ;(map.getSource('mesh-2d') as GeoJSONSource).setData(
        show2dMesh && meshData
          ? meshData
          : { type: 'FeatureCollection', features: [] },
      )
    }
    if (map.getLayer('mesh-2d-outline')) {
      map.setLayoutProperty(
        'mesh-2d-outline',
        'visibility',
        show2dMesh ? 'visible' : 'none',
      )
      map.setPaintProperty(
        'mesh-2d-outline',
        'line-color',
        basemap === 'osm' ? '#64748b' : '#94a3b8',
      )
    }
    if (map.getLayer('mesh-2d-fill')) {
      const showFill = show2dMesh && show2dDepth && Boolean(twodSnapshot)
      map.setLayoutProperty('mesh-2d-fill', 'visibility', showFill ? 'visible' : 'none')
      if (showFill) {
        map.setPaintProperty('mesh-2d-fill', 'fill-color', meshDepthColorExpr(twodDepthMax))
      }
    }
    pinDemLayersBelowOverlays(map)
  }, [
    nodes,
    links,
    subs,
    showSubcatchments,
    showLinks,
    showJunctions,
    showOutfalls,
    showStorage,
    snapshot,
    resultsSymbology,
    depthMax,
    flowMax,
    runoffMax,
    basemap,
    meshData,
    show2dMesh,
    show2dDepth,
    twodSnapshot,
    twodDepthMax,
  ])

  // Mesh preview + AOI overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax)

    const previewWgs = meshPreviewGeoJson
      ? reprojectGeoJson(meshPreviewGeoJson, network.crs)
      : null
    if (map.getSource('mesh-preview')) {
      ;(map.getSource('mesh-preview') as GeoJSONSource).setData(
        previewWgs ?? { type: 'FeatureCollection', features: [] },
      )
    }
    const showPreview = Boolean(previewWgs && previewWgs.features.length > 0)
    if (map.getLayer('mesh-preview-fill')) {
      map.setLayoutProperty('mesh-preview-fill', 'visibility', showPreview ? 'visible' : 'none')
    }
    if (map.getLayer('mesh-preview-outline')) {
      map.setLayoutProperty(
        'mesh-preview-outline',
        'visibility',
        showPreview ? 'visible' : 'none',
      )
    }

    if (map.getSource('mesh-aoi')) {
      ;(map.getSource('mesh-aoi') as GeoJSONSource).setData(draftCollection(meshAoiDraft))
    }
    pinDemLayersBelowOverlays(map)
  }, [
    meshPreviewGeoJson,
    meshAoiDraft,
    network.crs,
    basemap,
    depthMax,
    flowMax,
    runoffMax,
    resultsSymbology,
    twodDepthMax,
  ])

  // Background GIS: DEM just above basemap; vectors under mesh/results/network
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

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
        // Only remove source if no layers reference it
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
        const coordinates: [[number, number], [number, number], [number, number], [number, number]] =
          [
            [b.west, b.north],
            [b.east, b.north],
            [b.east, b.south],
            [b.west, b.south],
          ]
        const existing = map.getSource(srcId) as maplibregl.ImageSource | undefined
        if (existing) {
          existing.updateImage({ url, coordinates })
        } else {
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
          ;(map.getSource(srcId) as GeoJSONSource).setData(url)
        }
        const opacity = layer.visible ? layer.opacity : 0
        const before = vectorInsertBeforeId(map)
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
  }, [backgroundLayers, basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource('draw-temp')) return
    // Convert draft WGS84 positions already stored as lng/lat
    ;(map.getSource('draw-temp') as GeoJSONSource).setData(draftCollection(polygonDraft))
  }, [polygonDraft])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('nodes-selected')) return
    const nodeFilter =
      selection?.object_type === 'node'
        ? (['==', 'id', selection.id] as maplibregl.FilterSpecification)
        : pendingLinkFromId
          ? (['==', 'id', pendingLinkFromId] as maplibregl.FilterSpecification)
          : (['==', 'id', ''] as maplibregl.FilterSpecification)
    map.setFilter('nodes-selected', nodeFilter)
    map.setFilter(
      'links-selected',
      selection?.object_type === 'link'
        ? ['==', 'id', selection.id]
        : ['==', 'id', ''],
    )
    if (map.getLayer('subs-selected')) {
      const subFilter =
        selection?.object_type === 'subcatchment'
          ? (['==', 'id', selection.id] as maplibregl.FilterSpecification)
          : (['==', 'id', ''] as maplibregl.FilterSpecification)
      map.setFilter('subs-selected', subFilter)
      map.setFilter('subs-selected-outline', subFilter)
    }
  }, [selection, pendingLinkFromId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('nodes-profile')) return
    map.setFilter(
      'nodes-profile',
      profileNodeIds.length ? ['in', 'id', ...profileNodeIds] : ['==', 'id', ''],
    )
    map.setFilter(
      'links-profile',
      profileLinkIds.length ? ['in', 'id', ...profileLinkIds] : ['==', 'id', ''],
    )
  }, [profileNodeIds, profileLinkIds])

  // New project → discard prior camera; wait for this project's network before fitting
  useEffect(() => {
    clearCamera(projectKey)
    pendingFitRef.current = true
    lastFittedProjectRef.current = null
  }, [projectKey])

  useEffect(() => {
    if (fitExtentNonce > 0) {
      pendingFitRef.current = true
      lastFittedProjectRef.current = null
    }
  }, [fitExtentNonce])

  useEffect(() => {
    const map = mapRef.current
    const req = fitWgsBoundsRequest
    if (!map || !req || req.nonce <= 0) return
    const { west, south, east, north } = req
    if (
      !Number.isFinite(west) ||
      !Number.isFinite(south) ||
      !Number.isFinite(east) ||
      !Number.isFinite(north)
    ) {
      return
    }
    map.stop()
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: { top: 56, bottom: 56, left: 56, right: 56 },
        duration: 450,
        maxZoom: 17,
      },
    )
  }, [fitWgsBoundsRequest?.nonce])

  // Restore size + camera when the map tab becomes visible again
  useEffect(() => {
    const map = mapRef.current
    if (!map || !visible) return
    map.resize()
    if (pendingFitRef.current || lastFittedProjectRef.current !== projectKey) {
      pendingFitRef.current = true
      requestAnimationFrame(() => applyPendingFitRef.current())
      return
    }
    const saved = getSavedCamera(projectKey)
    if (saved) {
      map.jumpTo({ center: [saved.longitude, saved.latitude], zoom: saved.zoom })
    }
  }, [visible, projectKey])

  // Zoom to extent as soon as this project's geojson/bounds exist
  useEffect(() => {
    if (!visible) return
    if (lastFittedProjectRef.current === projectKey && !pendingFitRef.current) return
    const hasData =
      wgsGeojson.features.length > 0 || Boolean(network.bounds)
    if (!hasData) return
    pendingFitRef.current = true
    requestAnimationFrame(() => applyPendingFitRef.current())
  }, [visible, projectKey, fitExtentNonce, wgsGeojson, network.bounds, network.crs])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor =
      profilePickMode || drawMode !== 'select' ? 'crosshair' : 'grab'
  }, [profilePickMode, drawMode])

  return (
    <div className="network-map relative h-full min-h-0 flex-1">
      <div ref={containerRef} className="network-map-canvas h-full w-full min-h-0" />
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-border bg-elevated/90 px-2.5 py-1 text-[11px] text-muted shadow">
        Drag / middle-drag to pan · scroll zoom · Alt+drag node · Esc cancels draw
      </div>
    </div>
  )
}

export function useMapSymbologyExtents(snapshot?: OutSnapshotResponse | null) {
  return {
    depthMax: Math.max(snapshot?.node_depth_max ?? 0.01, 0.01),
    flowMax: Math.max(snapshot?.link_flow_max ?? 0.01, 0.01),
    runoffMax: Math.max(snapshot?.subcatchment_runoff_max ?? 0.01, 0.01),
    hasSnapshot: Boolean(snapshot),
  }
}
