import { useEffect, useMemo, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection, Position } from 'geojson'
import type {
  ModelNetwork,
  OutSnapshotResponse,
  GisLayer,
  TwoDSnapshotResponse,
  TwoDBinarySnapshot,
} from '../../api/client'
import { MESH_LARGE_THRESHOLD } from '../../lib/meshConstants'
import type { CompactMeshWgs } from '../../lib/meshGeoJson'
import { findTriangleAt, triangleRingWgs } from '../../lib/pickTriangle'
import {
  MESH2D_CUSTOM_LAYER_ID,
  Mesh2DCustomLayer,
} from './layers/Mesh2DCustomLayer'
import { pinMeshLayersAboveSubs } from './layers/NetworkLayer'
import {
  boundsToViewState,
  boundsToWgs84,
  geoJsonWgsBounds,
  reprojectGeoJson,
  wgs84ToProject,
} from '../../lib/projection'
import { clearCamera, getSavedCamera, saveCamera } from '../../lib/mapViewStore'
import { ensureNodeIcons, NODE_ICON_IDS, NODE_ICON_SHAPE_RADIUS, NODE_ICON_STROKE_PX } from '../../lib/nodeIcons'
import {
  defaultVisibleLinkKinds,
  enabledLinkKinds,
  type LinkKind,
} from '../../lib/linkKinds'
import { BC_TYPE_COLORS } from '../../lib/boundaryColors'
import {
  junctionDepthColorExpr,
  linkFlowColorExpr,
  linkFlowWidthExpr,
  meshDepthColorExpr,
  runoffColorExpr,
} from '../../lib/resultsSymbology'
import type { DrawMode } from './MapToolbar'
import { emptyStyle, isLightBasemap, type BasemapMode } from './MapCanvas'
import {
  pinDemLayersBelowOverlays,
  syncGisBackgroundLayers,
} from './layers/GisBackgroundLayer'

export type { BasemapMode }
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
  /** Per link-kind visibility (conduit, pump, …). */
  visibleLinkKinds?: Record<LinkKind, boolean>
  /** Background DEM / shapefile overlays (under network). */
  backgroundLayers?: GisLayer[]
  selection: Selection
  onSelect: (sel: Selection) => void
  snapshot?: OutSnapshotResponse | null
  /** When true, color by results (depth/flow/runoff). When false, color by object type. */
  resultsSymbology?: boolean
  /** Optional fixed color-scale maxima (simulation-wide). Falls back to snapshot period max. */
  symbologyExtents?: {
    depthMax?: number
    flowMax?: number
    runoffMax?: number
    twodDepthMax?: number
  } | null
  /** 2D triangle mesh GeoJSON already in WGS84 (unique verts reprojected once). */
  meshGeoJson?: FeatureCollection | null
  /**
   * Compact WGS84 mesh for large meshes (≥ MESH_LARGE_THRESHOLD).
   * When set with enough triangles, depth uses Mesh2DCustomLayer (not GeoJSON fill).
   */
  compactMeshWgs?: CompactMeshWgs | null
  show2dMesh?: boolean
  show2dDepth?: boolean
  /** Open mesh edges with BC types (project CRS reprojected by parent). */
  boundaryGeoJson?: FeatureCollection | null
  show2dBoundaries?: boolean
  selectedBoundaryId?: string | null
  onSelectBoundary?: (id: string | null) => void
  /** Selected 2D mesh triangle index (null = none). */
  selectedTriangleIndex?: number | null
  onSelectTriangle?: (index: number | null) => void
  /** When false, triangle picking is disabled. */
  allowTrianglePick?: boolean
  twodSnapshot?: TwoDSnapshotResponse | null
  /** Binary depth buffer for large-mesh custom layer. */
  twodBinarySnapshot?: TwoDBinarySnapshot | null
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
  /** Marching-dash flow animation overlay on pipes. */
  showFlowAnim?: boolean
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

/**
 * Run `cb` once the style can accept layer/source mutations.
 *
 * `isStyleLoaded()` goes false whenever a source is still loading, so an effect
 * that re-runs mid-load must not wait on `'load'` alone — that event fires once
 * and never again, which strands the callback forever. Listen on the repeating
 * events too and re-check each time.
 */
function whenMapStyleReady(map: MapLibreMap, cb: () => void): () => void {
  if (map.isStyleLoaded()) {
    cb()
    return () => {}
  }
  let done = false
  const detach = () => {
    map.off('load', attempt)
    map.off('styledata', attempt)
    map.off('idle', attempt)
  }
  function attempt() {
    if (done || !map.isStyleLoaded()) return
    done = true
    detach()
    cb()
  }
  map.on('load', attempt)
  map.on('styledata', attempt)
  map.on('idle', attempt)
  return () => {
    done = true
    detach()
  }
}

/**
 * Apply depths and return a FeatureCollection MapLibre will treat as new data.
 *
 * Critical: MapLibre's GeoJSON worker can keep stale fill tiles when Feature `id`
 * + geometry stay the same across setData (layer stays visible). Off→on depth
 * toggle works because visibility none→visible forces a full re-read. We stamp
 * each Feature `id` with the period so tiles cannot be reused, and callers should
 * briefly hide→show the fill layer around setData (same as the working toggle).
 */
function meshDataForMap(
  mesh: FeatureCollection,
  values: number[] | null | undefined,
  period: number | null = null,
): FeatureCollection {
  applyMeshDepthsInPlace(mesh, values, period)
  const periodTag = period ?? -1
  return {
    type: 'FeatureCollection',
    features: mesh.features.map((f) => {
      const idx = Number(f.properties?.triangle_index ?? f.id ?? 0)
      // Period-stamped id forces geojson-vt to treat triangles as new features.
      const id =
        periodTag >= 0 && Number.isFinite(idx)
          ? periodTag * 1_000_000 + idx
          : idx
      return {
        type: 'Feature' as const,
        id,
        geometry: f.geometry,
        properties: f.properties,
      }
    }),
  }
}

/**
 * Update depth on triangle features. Assigns a **new properties object** per
 * feature so MapLibre's GeoJSON worker cannot keep stale painted depths
 * (in-place `props.depth = …` alone is not reliably picked up after setData).
 */
function applyMeshDepthsInPlace(
  mesh: FeatureCollection,
  values: number[] | null | undefined,
  period: number | null = null,
): FeatureCollection {
  const features = mesh.features
  const n = values?.length ?? 0
  const periodTag = period ?? -1
  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    const prev = f.properties ?? {}
    const idx = Number(prev.triangle_index ?? f.id ?? i)
    const depth =
      values && Number.isFinite(idx) && idx >= 0 && idx < n ? (values[idx] ?? 0) : 0
    f.properties = {
      triangle_index: prev.triangle_index ?? idx,
      object_type: prev.object_type ?? 'triangle',
      id: prev.id ?? String(idx),
      mannings_n: prev.mannings_n,
      z_min: prev.z_min,
      z_max: prev.z_max,
      coupled_node: prev.coupled_node,
      cd: prev.cd,
      coupling_area: prev.coupling_area,
      depth,
      _period: periodTag,
    }
  }
  return mesh
}

function enrichWithSnapshot(
  fc: FeatureCollection,
  snapshot: OutSnapshotResponse,
): FeatureCollection {
  const depthByNode = new Map<string, number>()
  for (let i = 0; i < snapshot.node_ids.length; i++) {
    depthByNode.set(snapshot.node_ids[i], snapshot.node_depths[i] ?? 0)
  }
  const flowByLink = new Map<string, number>()
  for (let i = 0; i < snapshot.link_ids.length; i++) {
    flowByLink.set(snapshot.link_ids[i], snapshot.link_flows[i] ?? 0)
  }
  const subIds = snapshot.subcatchment_ids ?? []
  const subVals = snapshot.subcatchment_runoffs ?? []
  const runoffBySub = new Map<string, number>()
  for (let i = 0; i < subIds.length; i++) {
    runoffBySub.set(subIds[i], Math.abs(subVals[i] ?? 0))
  }

  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const t = f.properties?.object_type
      const id = String(f.properties?.id ?? '')
      const props = { ...f.properties }
      if (t === 'node') props.depth = depthByNode.get(id) ?? 0
      else if (t === 'link') {
        const signed = flowByLink.get(id) ?? 0
        props.flow_signed = signed
        props.flow = Math.abs(signed)
      } else if (t === 'subcatchment') props.runoff = runoffBySub.get(id) ?? 0
      return { ...f, properties: props }
    }),
  }
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

/** Min |flow| to show a marching dash (m³/s or CFS — tiny residual). */
const FLOW_ANIM_EPS = 1e-6

/** Mapbox-style dasharray phases for a continuous “flow” march. */
const FLOW_DASH_SEQUENCE: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
]

/**
 * Build oriented link geometries for flow dashes.
 * With a snapshot: only links with |flow| above epsilon; reverse coords when flow < 0.
 * Without: all LineString links (gentle ambient animation).
 */
function buildFlowAnimLinks(
  links: FeatureCollection,
  snapshot: OutSnapshotResponse | null | undefined,
): FeatureCollection {
  const flowByLink = new Map<string, number>()
  if (snapshot) {
    for (let i = 0; i < snapshot.link_ids.length; i++) {
      flowByLink.set(snapshot.link_ids[i], snapshot.link_flows[i] ?? 0)
    }
  }

  const features: Feature[] = []
  for (const f of links.features) {
    if (f.geometry?.type !== 'LineString') continue
    const id = String(f.properties?.id ?? '')
    let coords = f.geometry.coordinates as Position[]

    if (snapshot) {
      const fromProps = f.properties?.flow_signed
      const signed =
        typeof fromProps === 'number' && Number.isFinite(fromProps)
          ? fromProps
          : (flowByLink.get(id) ?? 0)
      if (!(Math.abs(signed) > FLOW_ANIM_EPS)) continue
      if (signed < 0) coords = coords.slice().reverse()
    }

    features.push({
      type: 'Feature',
      properties: { ...(f.properties ?? {}) },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }
  return { type: 'FeatureCollection', features }
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

/** Scale a pixel metric from the 64px node icon bitmap by zoom-dependent icon-size. */
function scaleNodeIconMetric(metric: number): maplibregl.ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    0.11 * metric,
    12,
    0.15 * metric,
    14,
    0.22 * metric,
    16,
    0.34 * metric,
    18,
    0.46 * metric,
  ]
}

/** Match Types-mode junction icon fill + stroke (same geometry as nodeIcons bitmap). */
function nodeDepthRadiusExpr(): maplibregl.ExpressionSpecification {
  return scaleNodeIconMetric(NODE_ICON_SHAPE_RADIUS)
}

function nodeDepthStrokeWidthExpr(): maplibregl.ExpressionSpecification {
  return scaleNodeIconMetric(NODE_ICON_STROKE_PX)
}

const junctionNodeFilter = [
  'match',
  ['get', 'node_kind'],
  'outfall',
  false,
  'storage',
  false,
  true,
] as maplibregl.FilterSpecification

function applyLinkKindFilter(
  map: MapLibreMap,
  visibleLinkKinds: Record<LinkKind, boolean>,
): void {
  const enabled = enabledLinkKinds(visibleLinkKinds)
  const filter: maplibregl.FilterSpecification | null =
    enabled.length === 0
      ? (['==', ['get', 'id'], ''] as maplibregl.FilterSpecification)
      : enabled.length >= 5
        ? null
        : ([
            'in',
            ['get', 'link_kind'],
            ['literal', enabled],
          ] as maplibregl.FilterSpecification)
  for (const layerId of ['links', 'links-hit', 'links-flow-anim']) {
    if (map.getLayer(layerId)) map.setFilter(layerId, filter)
  }
}

/** Depth circles sit above icons but below selection halos. */
function pinJunctionDepthLayerOnTop(map: MapLibreMap): void {
  if (!map.getLayer('nodes-junction-depth')) return
  const before = map.getLayer('nodes-selected')
    ? 'nodes-selected'
    : map.getLayer('nodes-profile')
      ? 'nodes-profile'
      : undefined
  if (before) map.moveLayer('nodes-junction-depth', before)
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

function boundaryColorExpr(): maplibregl.ExpressionSpecification {
  const entries: Array<string | maplibregl.ExpressionSpecification> = [
    'match',
    ['get', 'bc_type'],
  ]
  for (const [type, color] of Object.entries(BC_TYPE_COLORS)) {
    entries.push(type, color)
  }
  entries.push('#94a3b8')
  return entries as maplibregl.ExpressionSpecification
}

function ensureLayers(
  map: MapLibreMap,
  basemap: BasemapMode,
  depthMax: number,
  flowMax: number,
  runoffMax: number,
  resultsSymbology: boolean,
  twodDepthMax = 0.01,
  visibleLinkKinds: Record<LinkKind, boolean> = defaultVisibleLinkKinds(),
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
  if (!map.getSource('mesh-boundaries')) {
    map.addSource('mesh-boundaries', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getSource('mesh-2d-selection')) {
    map.addSource('mesh-2d-selection', {
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
  if (!map.getSource('links-flow-anim')) {
    map.addSource('links-flow-anim', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
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
  }
  if (!map.getLayer('mesh-2d-outline')) {
    map.addLayer({
      id: 'mesh-2d-outline',
      type: 'line',
      source: 'mesh-2d',
      layout: { visibility: 'none' },
      paint: {
        'line-color': isLightBasemap(basemap) ? '#64748b' : '#94a3b8',
        'line-width': 0.4,
        'line-opacity': 0.55,
      },
    })
  } else {
    // Undo any prior minzoom gate so mesh is visible at all zoom levels.
    map.setLayerZoomRange('mesh-2d-outline', 0, 24)
  }
  if (!map.getLayer('mesh-2d-selected')) {
    map.addLayer({
      id: 'mesh-2d-selected-fill',
      type: 'fill',
      source: 'mesh-2d-selection',
      paint: {
        'fill-color': '#fbbf24',
        'fill-opacity': 0.28,
      },
    })
    map.addLayer({
      id: 'mesh-2d-selected',
      type: 'line',
      source: 'mesh-2d-selection',
      paint: {
        'line-color': '#f59e0b',
        'line-width': 2.5,
        'line-opacity': 1,
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

  if (!map.getLayer('mesh-boundaries')) {
    map.addLayer({
      id: 'mesh-boundaries-hit',
      type: 'line',
      source: 'mesh-boundaries',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 },
    })
    map.addLayer({
      id: 'mesh-boundaries',
      type: 'line',
      source: 'mesh-boundaries',
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': boundaryColorExpr(),
        'line-width': 3.5,
        'line-opacity': 0.95,
      },
    })
    map.addLayer({
      id: 'mesh-boundaries-selected',
      type: 'line',
      source: 'mesh-boundaries',
      filter: ['==', 'id', ''],
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#fbbf24',
        'line-width': 7,
        'line-opacity': 1,
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
        'fill-opacity': isLightBasemap(basemap) ? 0.28 : 0.4,
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
      id: 'links-flow-anim',
      type: 'line',
      source: 'links-flow-anim',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        visibility: 'none',
      },
      paint: {
        'line-color': '#7dd3fc',
        'line-width': 3.25,
        'line-opacity': 0.9,
        'line-dasharray': FLOW_DASH_SEQUENCE[0],
      },
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

  // Hot-add anim layer if links already existed from an older session
  if (map.getLayer('links') && !map.getLayer('links-flow-anim') && map.getSource('links-flow-anim')) {
    map.addLayer(
      {
        id: 'links-flow-anim',
        type: 'line',
        source: 'links-flow-anim',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: 'none',
        },
        paint: {
          'line-color': '#7dd3fc',
          'line-width': 3.25,
          'line-opacity': 0.9,
          'line-dasharray': FLOW_DASH_SEQUENCE[0],
        },
      },
      map.getLayer('links-selected') ? 'links-selected' : undefined,
    )
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
      filter: junctionNodeFilter,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': nodeDepthRadiusExpr(),
        'circle-color': '#38bdf8',
        'circle-stroke-width': nodeDepthStrokeWidthExpr(),
        'circle-stroke-color': '#000000',
        'circle-opacity': 1,
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
    if (!map.getLayer('nodes-junction-depth')) {
      map.addLayer(
        {
          id: 'nodes-junction-depth',
          type: 'circle',
          source: 'nodes',
          filter: junctionNodeFilter,
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': nodeDepthRadiusExpr(),
            'circle-color': '#38bdf8',
            'circle-stroke-width': nodeDepthStrokeWidthExpr(),
            'circle-stroke-color': '#000000',
            'circle-opacity': 1,
          },
        },
        map.getLayer('nodes-selected') ? 'nodes-selected' : undefined,
      )
    } else {
      map.setFilter('nodes-junction-depth', junctionNodeFilter)
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
    map.setPaintProperty('links', 'line-color', linkFlowColorExpr(flowMax))
    map.setPaintProperty('links', 'line-width', linkFlowWidthExpr(flowMax))
    if (map.getLayer('nodes-junction-depth')) {
      map.setLayoutProperty('nodes-junction-depth', 'visibility', 'visible')
      map.setPaintProperty('nodes-junction-depth', 'circle-color', junctionDepthColorExpr(depthMax))
      map.setPaintProperty('nodes-junction-depth', 'circle-radius', nodeDepthRadiusExpr())
      map.setPaintProperty('nodes-junction-depth', 'circle-stroke-width', nodeDepthStrokeWidthExpr())
    }
    // Hide baked junction symbols while depth circles show; keep outfall/storage icons
    map.setFilter('nodes', [
      'match',
      ['get', 'node_kind'],
      'outfall',
      true,
      'storage',
      true,
      false,
    ])
    map.setPaintProperty('subs-fill', 'fill-color', runoffColorExpr(runoffMax))
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

  map.setPaintProperty('subs-fill', 'fill-opacity', isLightBasemap(basemap) ? 0.28 : 0.45)
  applyLinkKindFilter(map, visibleLinkKinds)
  pinJunctionDepthLayerOnTop(map)
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
  visibleLinkKinds = defaultVisibleLinkKinds(),
  backgroundLayers = [],
  selection,
  onSelect,
  snapshot,
  resultsSymbology = false,
  symbologyExtents = null,
  meshGeoJson = null,
  compactMeshWgs = null,
  show2dMesh = false,
  show2dDepth = false,
  boundaryGeoJson = null,
  show2dBoundaries = false,
  selectedBoundaryId = null,
  onSelectBoundary,
  selectedTriangleIndex = null,
  onSelectTriangle,
  allowTrianglePick = true,
  twodSnapshot = null,
  twodBinarySnapshot = null,
  meshPreviewGeoJson = null,
  meshAoiDraft = [],
  onMeshAoiDraftChange,
  onMeshAoiComplete,
  profileNodeIds = [],
  profileLinkIds = [],
  profilePickMode = null,
  showFlowAnim = false,
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
  const hoverRafRef = useRef<number | null>(null)
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
    onSelectBoundary,
    onSelectTriangle,
    compactMeshWgs,
    useCustomMesh: false as boolean,
    allowTrianglePick: true as boolean,
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
    onSelectBoundary,
    onSelectTriangle,
    compactMeshWgs,
    useCustomMesh: false,
    allowTrianglePick,
  }

  const wgsGeojson = useMemo(
    () => reprojectGeoJson(network.geojson, network.crs),
    [network.geojson, network.crs],
  )
  const wgsGeojsonRef = useRef(wgsGeojson)
  wgsGeojsonRef.current = wgsGeojson
  const networkRef = useRef(network)
  networkRef.current = network

  const wgsMesh = meshGeoJson ?? null
  const meshDataRef = useRef(wgsMesh)
  meshDataRef.current = wgsMesh
  /** Last mesh identity loaded into MapLibre (geometry only). */
  const lastLoadedMeshRef = useRef<FeatureCollection | null>(null)
  /** Last 2D depth period applied onto the shared mesh features. */
  const lastAppliedPeriodRef = useRef<number | null>(null)
  /** Last values array reference applied (detects new period payloads). */
  const lastAppliedValuesRef = useRef<number[] | null>(null)
  /** Bumps so a deferred visibility-show from an older apply is ignored. */
  const depthApplyGenRef = useRef(0)
  const customMeshLayerRef = useRef<Mesh2DCustomLayer | null>(null)

  const useCustomMesh =
    Boolean(compactMeshWgs) &&
    (compactMeshWgs?.triangles.length ?? 0) >= MESH_LARGE_THRESHOLD

  handlersRef.current.useCustomMesh = useCustomMesh
  handlersRef.current.compactMeshWgs = compactMeshWgs
  handlersRef.current.onSelectTriangle = onSelectTriangle
  handlersRef.current.allowTrianglePick = allowTrianglePick

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
  // Geometry + optional per-period result properties on features.
  const displayGeojson = useMemo(() => {
    if (resultsSymbology && snapshot) {
      return enrichWithSnapshot(wgsGeojson, snapshot)
    }
    return wgsGeojson
  }, [wgsGeojson, snapshot, resultsSymbology])
  const { nodes, links, subs } = useMemo(() => splitByType(displayGeojson), [displayGeojson])
  const flowAnimLinks = useMemo(
    () =>
      showFlowAnim && showLinks
        ? buildFlowAnimLinks(links, snapshot)
        : { type: 'FeatureCollection' as const, features: [] },
    [showFlowAnim, showLinks, links, snapshot],
  )
  const depthMax = Math.max(
    symbologyExtents?.depthMax ?? snapshot?.node_depth_max ?? 0.01,
    0.01,
  )
  const flowMax = Math.max(
    symbologyExtents?.flowMax ?? snapshot?.link_flow_max ?? 0.01,
    0.01,
  )
  const runoffMax = Math.max(
    symbologyExtents?.runoffMax ?? snapshot?.subcatchment_runoff_max ?? 0.01,
    0.01,
  )
  const twodDepthMax = Math.max(
    symbologyExtents?.twodDepthMax ??
      twodBinarySnapshot?.value_max ??
      twodSnapshot?.value_max ??
      0.01,
    0.01,
  )
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
      attributionControl: isLightBasemap(basemap) ? {} : false,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      maxPitch: 85,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    map.addControl(new OrientationControl(), 'top-left')
    mapRef.current = map
    if (import.meta.env.DEV) {
      ;(window as unknown as { __ssMap?: maplibregl.Map }).__ssMap = map
    }

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
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
      ;(map.getSource('subs') as GeoJSONSource)?.setData(subs)
      ;(map.getSource('links') as GeoJSONSource)?.setData(links)
      ;(map.getSource('links-flow-anim') as GeoJSONSource)?.setData(flowAnimLinks)
      ;(map.getSource('nodes') as GeoJSONSource)?.setData(nodes)
      if (meshDataRef.current) {
        ;(map.getSource('mesh-2d') as GeoJSONSource)?.setData(meshDataRef.current)
      }
      map.getCanvas().style.cursor = 'grab'
      // Fit as soon as style is up (network may arrive later via effect)
      requestAnimationFrame(() => applyPendingFitRef.current())
    })

    const selectableLayers = () =>
      [
        'mesh-boundaries',
        'mesh-boundaries-hit',
        'nodes',
        'nodes-hit',
        'links',
        'links-hit',
        'subs-fill',
        'mesh-2d-fill',
      ].filter((id) => Boolean(map.getLayer(id)))

    const pickFeature = (point: maplibregl.PointLike) => {
      const feats = map.queryRenderedFeatures(point, { layers: selectableLayers() })
      const boundary = feats.find((f) => f.properties?.object_type === '2d_boundary')
      if (boundary) return boundary
      const node = feats.find((f) => f.properties?.object_type === 'node')
      if (node) return node
      const link = feats.find((f) => f.properties?.object_type === 'link')
      if (link) return link
      const sub = feats.find((f) => f.properties?.object_type === 'subcatchment')
      if (sub) return sub
      return feats.find((f) => f.properties?.object_type === 'triangle') ?? null
    }

    const pickTriangleIndex = (lng: number, lat: number, point: maplibregl.PointLike) => {
      const h = handlersRef.current
      // Prefer GeoJSON fill hit when that layer is queryable (small meshes).
      const f = pickFeature(point)
      if (f?.properties?.object_type === 'triangle') {
        const ti = Number(f.properties.triangle_index ?? f.properties.id)
        return Number.isFinite(ti) ? ti : null
      }
      // Large-mesh custom layer: geometric pick against compact WGS84 mesh.
      if (h.useCustomMesh && h.compactMeshWgs) {
        return findTriangleAt(lng, lat, h.compactMeshWgs)
      }
      return null
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
        const ot = String(f.properties.object_type)
        if (ot === 'triangle' || ot === '2d_boundary') return
        h.onRequestDelete?.({
          object_type: ot as NonNullable<Selection>['object_type'],
          id: String(f.properties.id),
        })
        return
      }

      const f = pickFeature(e.point)
      if (f?.properties && String(f.properties.object_type) === '2d_boundary') {
        h.onSelect(null)
        h.onSelectTriangle?.(null)
        h.onSelectBoundary?.(String(f.properties.id))
        return
      }
      if (f?.properties) {
        const object_type = String(f.properties.object_type)
        if (
          object_type === 'node' ||
          object_type === 'link' ||
          object_type === 'subcatchment'
        ) {
          h.onSelectBoundary?.(null)
          h.onSelectTriangle?.(null)
          const id = String(f.properties.id)
          if (h.profilePickMode && object_type === 'node' && h.onProfileNodePick) {
            h.onProfileNodePick(id)
            return
          }
          h.onSelect({ object_type, id })
          return
        }
      }

      const tri =
        h.allowTrianglePick !== false
          ? pickTriangleIndex(e.lngLat.lng, e.lngLat.lat, e.point)
          : null
      if (tri != null) {
        h.onSelect(null)
        h.onSelectBoundary?.(null)
        h.onSelectTriangle?.(tri)
        return
      }

      h.onSelect(null)
      h.onSelectBoundary?.(null)
      h.onSelectTriangle?.(null)
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
      const point = e.point
      if (hoverRafRef.current != null) return
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null
        const h = handlersRef.current
        if (h.profilePickMode || h.drawMode !== 'select') {
          map.getCanvas().style.cursor = 'crosshair'
          return
        }
        const f = pickFeature(point)
        map.getCanvas().style.cursor = f ? 'pointer' : 'grab'
      })
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
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current)
        hoverRafRef.current = null
      }
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

    const insertBefore = map.getLayer('subs-fill')
      ? 'subs-fill'
      : map.getLayer('mesh-2d-fill')
        ? 'mesh-2d-fill'
        : undefined

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
          insertBefore,
        )
      }
    }

    const ensureHybrid = () => {
      if (!map.getSource('esri-imagery')) {
        map.addSource('esri-imagery', {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri, Maxar, Earthstar Geographics',
        })
      }
      if (!map.getSource('esri-labels')) {
        map.addSource('esri-labels', {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: '© Esri',
        })
      }
      if (!map.getLayer('esri-imagery')) {
        map.addLayer(
          {
            id: 'esri-imagery',
            type: 'raster',
            source: 'esri-imagery',
            paint: { 'raster-opacity': 1 },
          },
          insertBefore,
        )
      }
      if (!map.getLayer('esri-labels')) {
        map.addLayer(
          {
            id: 'esri-labels',
            type: 'raster',
            source: 'esri-labels',
            paint: { 'raster-opacity': 0.95 },
          },
          insertBefore,
        )
      }
    }

    const setVis = (id: string, visible: boolean) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      }
    }

    if (basemap === 'osm') {
      ensureOsm()
      setVis('osm', true)
      setVis('esri-imagery', false)
      setVis('esri-labels', false)
      map.setPaintProperty('background', 'background-color', '#dbe4ee')
    } else if (basemap === 'hybrid') {
      ensureHybrid()
      setVis('osm', false)
      setVis('esri-imagery', true)
      setVis('esri-labels', true)
      map.setPaintProperty('background', 'background-color', '#0b1220')
    } else {
      setVis('osm', false)
      setVis('esri-imagery', false)
      setVis('esri-labels', false)
      map.setPaintProperty('background', 'background-color', '#0b1220')
    }
    if (map.getLayer('subs-fill')) {
      map.setPaintProperty(
        'subs-fill',
        'fill-opacity',
        isLightBasemap(basemap) ? 0.28 : 0.4,
      )
    }
  }, [basemap])

  // (a) Static 1D geometry + layer paint modes (not per-period result values)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
    ;(map.getSource('subs') as GeoJSONSource)?.setData(
      showSubcatchments ? subs : { type: 'FeatureCollection', features: [] },
    )
    ;(map.getSource('links') as GeoJSONSource)?.setData(
      showLinks ? links : { type: 'FeatureCollection', features: [] },
    )
    ;(map.getSource('links-flow-anim') as GeoJSONSource)?.setData(flowAnimLinks)
    if (map.getLayer('links-flow-anim')) {
      map.setLayoutProperty(
        'links-flow-anim',
        'visibility',
        showFlowAnim && showLinks ? 'visible' : 'none',
      )
    }
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
    pinDemLayersBelowOverlays(map)
    pinMeshLayersAboveSubs(map)
  }, [
    nodes,
    links,
    flowAnimLinks,
    subs,
    showSubcatchments,
    showLinks,
    showFlowAnim,
    showJunctions,
    showOutfalls,
    showStorage,
    resultsSymbology,
    depthMax,
    flowMax,
    runoffMax,
    basemap,
    twodDepthMax,
    visibleLinkKinds,
  ])

  // Marching-dash flow animation (layer-wide dasharray phase cycle)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !showFlowAnim || !showLinks) return

    let raf = 0
    let step = 0
    let lastTs = 0
    let cancelled = false
    const frameMs = 40 // ~25 fps

    const tick = (ts: number) => {
      if (cancelled) return
      raf = requestAnimationFrame(tick)
      if (document.visibilityState === 'hidden') return
      if (!map.getLayer('links-flow-anim')) return
      if (ts - lastTs < frameMs) return
      lastTs = ts
      step = (step + 1) % FLOW_DASH_SEQUENCE.length
      map.setPaintProperty('links-flow-anim', 'line-dasharray', FLOW_DASH_SEQUENCE[step]!)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [showFlowAnim, showLinks])

  // (c+d) 2D mesh geometry + flood depth coloring
  // Deps intentionally exclude 1D depthMax/flowMax/runoffMax — those change on every
  // out-snapshot fetch and would re-run this effect (and used to cancel pending depth applies).
  // Large meshes (≥ MESH_LARGE_THRESHOLD) use Mesh2DCustomLayer instead — see effect below.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      if (!map.isStyleLoaded()) return
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)

      // Custom WebGL path owns fill for large meshes — clear GeoJSON fill/source.
      if (useCustomMesh) {
        if (map.getLayer('mesh-2d-fill')) {
          map.setLayoutProperty('mesh-2d-fill', 'visibility', 'none')
        }
        // Outline skipped at large scale (performance).
        if (map.getLayer('mesh-2d-outline')) {
          map.setLayoutProperty('mesh-2d-outline', 'visibility', 'none')
        }
        const meshSrc = map.getSource('mesh-2d') as GeoJSONSource | undefined
        if (meshSrc && lastLoadedMeshRef.current != null) {
          lastLoadedMeshRef.current = null
          lastAppliedPeriodRef.current = null
          lastAppliedValuesRef.current = null
          meshSrc.setData({ type: 'FeatureCollection', features: [] })
        }
        pinDemLayersBelowOverlays(map)
        pinMeshLayersAboveSubs(map)
        return
      }

      const showGeometry = Boolean((show2dMesh || show2dDepth) && wgsMesh)
      const meshSrc = map.getSource('mesh-2d') as GeoJSONSource | undefined

      if (map.getLayer('mesh-2d-outline')) {
        map.setLayoutProperty(
          'mesh-2d-outline',
          'visibility',
          show2dMesh && showGeometry ? 'visible' : 'none',
        )
        map.setPaintProperty(
          'mesh-2d-outline',
          'line-color',
          basemap === 'hybrid' || basemap === 'osm' ? '#64748b' : '#94a3b8',
        )
        map.setLayerZoomRange('mesh-2d-outline', 0, 24)
      }

      const showFill = Boolean(show2dDepth && showGeometry && twodSnapshot && wgsMesh)
      // Visibility is set after setData when depth changes — see applyDepthToMap.
      // Keep paint scale in sync whenever fill should be shown.
      if (map.getLayer('mesh-2d-fill') && showFill) {
        map.setPaintProperty('mesh-2d-fill', 'fill-color', meshDepthColorExpr(twodDepthMax))
      }

      if (!meshSrc) {
        pinDemLayersBelowOverlays(map)
        pinMeshLayersAboveSubs(map)
        return
      }

      if (!showGeometry || !wgsMesh) {
        if (lastLoadedMeshRef.current != null) {
          lastLoadedMeshRef.current = null
          lastAppliedPeriodRef.current = null
          lastAppliedValuesRef.current = null
          meshSrc.setData({ type: 'FeatureCollection', features: [] })
        }
        if (map.getLayer('mesh-2d-fill')) {
          map.setLayoutProperty('mesh-2d-fill', 'visibility', 'none')
        }
        pinDemLayersBelowOverlays(map)
        pinMeshLayersAboveSubs(map)
        return
      }

      const meshChanged = lastLoadedMeshRef.current !== wgsMesh
      const values = showFill ? twodSnapshot!.values : null
      const period = showFill ? twodSnapshot!.period : null
      const depthNeedsApply =
        showFill &&
        values != null &&
        period != null &&
        (lastAppliedPeriodRef.current !== period || lastAppliedValuesRef.current !== values)

      /** Mimic the working off→on toggle so MapLibre re-reads fill tiles.
       * Hide + setData must run now; show is deferred one frame (same-tick
       * none→visible is coalesced and does nothing — unlike a real UI toggle). */
      const applyDepthToMap = (data: FeatureCollection, visible: boolean) => {
        const gen = ++depthApplyGenRef.current
        if (map.getLayer('mesh-2d-fill')) {
          map.setLayoutProperty('mesh-2d-fill', 'visibility', 'none')
        }
        meshSrc.setData(data)
        if (!visible) {
          map.triggerRepaint()
          return
        }
        requestAnimationFrame(() => {
          if (gen !== depthApplyGenRef.current) return
          if (!map.isStyleLoaded() || !map.getLayer('mesh-2d-fill')) return
          map.setLayoutProperty('mesh-2d-fill', 'visibility', 'visible')
          map.triggerRepaint()
        })
      }

      if (!meshChanged && !depthNeedsApply && showFill) {
        // Paint scale may still need a repaint when only value_max changed.
        if (map.getLayer('mesh-2d-fill')) {
          map.setLayoutProperty('mesh-2d-fill', 'visibility', 'visible')
        }
        map.triggerRepaint()
        pinDemLayersBelowOverlays(map)
        pinMeshLayersAboveSubs(map)
        return
      }

      if (!meshChanged && !depthNeedsApply && !showFill) {
        if (map.getLayer('mesh-2d-fill')) {
          map.setLayoutProperty('mesh-2d-fill', 'visibility', 'none')
        }
        pinDemLayersBelowOverlays(map)
        pinMeshLayersAboveSubs(map)
        return
      }

      if (showFill && values != null && period != null) {
        lastLoadedMeshRef.current = wgsMesh
        lastAppliedPeriodRef.current = period
        lastAppliedValuesRef.current = values
        applyDepthToMap(meshDataForMap(wgsMesh, values, period), true)
      } else {
        lastAppliedPeriodRef.current = null
        lastAppliedValuesRef.current = null
        lastLoadedMeshRef.current = wgsMesh
        applyDepthToMap(meshDataForMap(wgsMesh, null, null), false)
      }
      pinDemLayersBelowOverlays(map)
      pinMeshLayersAboveSubs(map)
    }

    // whenMapStyleReady already invokes sync() immediately when the style is
    // loaded. Calling sync() again here would run it twice in the same tick and
    // collapse applyDepthToMap's hide→rAF→show sequence (same-tick none→visible
    // is coalesced by MapLibre, so the fill keeps stale tiles until a real toggle).
    const cancel = whenMapStyleReady(map, sync)
    return cancel
    // depthMax/flowMax/runoffMax omitted on purpose — per-period 1D snapshot
    // arrivals must not re-run this effect. twodDepthMax is typically a static
    // simulation-wide extent and is safe to include for paint scale updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    wgsMesh,
    show2dMesh,
    show2dDepth,
    twodSnapshot,
    twodDepthMax,
    basemap,
    resultsSymbology,
    visibleLinkKinds,
    useCustomMesh,
  ])

  // Large-mesh custom WebGL layer (geometry once, Float32Array depths per period).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      if (!map.isStyleLoaded()) return
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)

      if (!useCustomMesh || !compactMeshWgs) {
        if (map.getLayer(MESH2D_CUSTOM_LAYER_ID)) {
          try {
            map.removeLayer(MESH2D_CUSTOM_LAYER_ID)
          } catch {
            /* ignore */
          }
        }
        customMeshLayerRef.current = null
        return
      }

      let layer = customMeshLayerRef.current
      if (!layer || !map.getLayer(MESH2D_CUSTOM_LAYER_ID)) {
        layer = new Mesh2DCustomLayer()
        customMeshLayerRef.current = layer
        // Insert under 1D network (above GIS). Prefer before mesh-2d-fill if present.
        const before =
          map.getLayer('mesh-2d-fill')
            ? 'mesh-2d-fill'
            : map.getLayer('subs-fill')
              ? 'subs-fill'
              : undefined
        try {
          if (before) map.addLayer(layer as unknown as maplibregl.CustomLayerInterface, before)
          else map.addLayer(layer as unknown as maplibregl.CustomLayerInterface)
        } catch (err) {
          console.error('Failed to add Mesh2DCustomLayer', err)
          try {
            map.addLayer(layer as unknown as maplibregl.CustomLayerInterface)
          } catch (err2) {
            console.error('Retry add Mesh2DCustomLayer failed', err2)
            customMeshLayerRef.current = null
            return
          }
        }
      }

      layer.setGeometry(compactMeshWgs)
      layer.setDepthMax(twodDepthMax)
      const hasDepth = Boolean(show2dDepth && twodBinarySnapshot?.values)
      const showLayer = Boolean(show2dMesh || hasDepth)
      layer.setVisible(showLayer)
      layer.setWireframe(show2dMesh && showLayer, isLightBasemap(basemap))
      if (hasDepth && twodBinarySnapshot?.values) {
        layer.setDepths(twodBinarySnapshot.values)
      } else if (show2dMesh) {
        layer.setSolidColor()
      } else {
        layer.setDepths(null)
      }
      pinDemLayersBelowOverlays(map)
      pinMeshLayersAboveSubs(map)
    }

    const cancel = whenMapStyleReady(map, sync)
    return cancel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    useCustomMesh,
    compactMeshWgs,
    show2dMesh,
    show2dDepth,
    twodBinarySnapshot,
    twodDepthMax,
    basemap,
    resultsSymbology,
    visibleLinkKinds,
  ])

  // 2D boundary condition edges
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)

    const wgs =
      boundaryGeoJson && boundaryGeoJson.features.length > 0
        ? reprojectGeoJson(boundaryGeoJson, network.crs)
        : { type: 'FeatureCollection' as const, features: [] }
    if (map.getSource('mesh-boundaries')) {
      ;(map.getSource('mesh-boundaries') as GeoJSONSource).setData(wgs)
    }
    const vis = show2dBoundaries && wgs.features.length > 0 ? 'visible' : 'none'
    for (const id of ['mesh-boundaries', 'mesh-boundaries-hit', 'mesh-boundaries-selected']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    }
    if (map.getLayer('mesh-boundaries-selected')) {
      map.setFilter(
        'mesh-boundaries-selected',
        selectedBoundaryId
          ? (['==', 'id', selectedBoundaryId] as maplibregl.FilterSpecification)
          : (['==', 'id', ''] as maplibregl.FilterSpecification),
      )
    }
  }, [
    boundaryGeoJson,
    show2dBoundaries,
    selectedBoundaryId,
    network.crs,
    basemap,
    depthMax,
    flowMax,
    runoffMax,
    resultsSymbology,
    twodDepthMax,
    visibleLinkKinds,
  ])

  // Mesh preview + AOI overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)

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
    visibleLinkKinds,
  ])

  // Background GIS: DEM just above basemap; vectors under mesh/results/network
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    syncGisBackgroundLayers(map, backgroundLayers)
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
    if (!map?.isStyleLoaded()) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
    const src = map.getSource('mesh-2d-selection') as GeoJSONSource | undefined
    if (!src) return
    if (selectedTriangleIndex == null || selectedTriangleIndex < 0) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    let ring: number[][] | null = null
    if (compactMeshWgs) {
      ring = triangleRingWgs(compactMeshWgs, selectedTriangleIndex)
    } else if (meshGeoJson?.features?.length) {
      const feat = meshGeoJson.features.find(
        (f) => Number(f.properties?.triangle_index ?? f.id) === selectedTriangleIndex,
      )
      if (feat?.geometry?.type === 'Polygon') {
        ring = feat.geometry.coordinates[0] as number[][]
      }
    }
    if (!ring) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    src.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { triangle_index: selectedTriangleIndex },
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
      ],
    })
  }, [
    selectedTriangleIndex,
    compactMeshWgs,
    meshGeoJson,
    basemap,
    depthMax,
    flowMax,
    runoffMax,
    resultsSymbology,
    twodDepthMax,
    visibleLinkKinds,
  ])

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
