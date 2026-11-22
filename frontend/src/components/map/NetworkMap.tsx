import { IS_VIEWER } from '../../lib/mode'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlowParticles } from './FlowParticles'
import { SurfaceFlow, type SurfaceField } from './SurfaceFlow'
import { MapLabels } from './MapLabels'
import { MeasureTool, type MeasureMode, type MeasureResult } from './MeasureTool'
import { styleColor, styleOpacity, styleSize, type MapStyle } from '../../lib/mapStyle'
import { buildNodeIconImageData } from '../../lib/nodeIcons'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
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
import {
  NETWORK3D_CUSTOM_LAYER_ID,
  Network3DCustomLayer,
} from './layers/Network3DCustomLayer'
import { pinMeshLayersAboveSubs, pinNetwork3DLayer } from './layers/NetworkLayer'
import {
  boundsToViewState,
  boundsToWgs84,
  geoJsonWgsBounds,
  reprojectGeoJson,
  wgs84ToProject,
} from '../../lib/projection'
import { clearCamera, getSavedCamera, saveCamera } from '../../lib/mapViewStore'
import { useCoarsePointer } from '../../lib/useMedia'
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
  setChangeSymbology,
  isChangeSymbology,
} from '../../lib/resultsSymbology'
import type { DrawMode } from './MapToolbar'
import { BLANK_DARK, BLANK_LIGHT, CANVAS_MAXZOOM, CARTO_ATTRIBUTION, CARTO_TILES, effectiveBasemap, emptyStyle, isLightBasemap, type BasemapMode, type MapBackground } from './MapCanvas'
import { useResolvedTheme } from '../../lib/theme'
import {
  pinDemLayersBelowOverlays,
  gisVectorLayerIds,
  syncGisBackgroundLayers,
} from './layers/GisBackgroundLayer'
import {
  syncFlowAccumLayer,
  type FlowAccumOverlay,
} from './layers/FlowAccumLayer'

export type { BasemapMode }
export type Selection = {
  object_type: 'node' | 'link' | 'subcatchment'
  id: string
} | null

export type NodeKind = 'junction' | 'outfall' | 'storage'

interface NetworkMapProps {
  /** XYZ / WMS tile URL template for the `custom` basemap ({z}/{x}/{y} or {bbox-epsg-3857}). */
  customTilesUrl?: string
  /** Colour elements by a chosen property or check result (overrides the default colours). */
  thematic?: ThematicStyle | null
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
  /** DEM flow-accumulation PNG overlay (above DEM, below network). */
  flowAccumOverlay?: FlowAccumOverlay | null
  showFlowAccum?: boolean
  selection: Selection
  /** Bump to pan/zoom the camera onto the current selection. */
  zoomToSelectionNonce?: number
  /** additive: Shift/Ctrl/Cmd held, so add to (or remove from) the selection. */
  onSelect: (sel: Selection, opts?: { additive?: boolean }) => void
  /** Everything selected (highlighted together); defaults to `selection`. */
  multiSelection?: NonNullable<Selection>[]
  /** Shift-drag box selection. */
  onBoxSelect?: (items: NonNullable<Selection>[], additive: boolean) => void
  /** Right-click (without dragging): what's under the pointer and where. */
  onContextMenu?: (info: { target: Selection; lngLat: [number, number]; xy: [number, number]; point: { x: number; y: number } }) => void
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
  /** Nodes already picked for a profile (start, then via points) while picking the end. */
  profilePickedIds?: string[]
  /** Marching-dash flow animation overlay on pipes. */
  showFlowAnim?: boolean
  /** Snapshot values are a change between two runs: colour them on a two-sided scale. */
  changeMode?: boolean
  /** Per-element-type size, opacity and colour (Layers button). */
  layerStyle?: MapStyle
  /** Element ID labels once zoomed in. */
  showLabels?: boolean
  /** 2D surface opacity multiplier (Layers panel). */
  meshOpacity?: number
  /** 2D velocity + depth for the current period: animates surface flow. */
  surfaceFlow?: SurfaceField | null
  /** Extruded OpenStreetMap buildings (OpenFreeMap vector tiles). */
  show3DBuildings?: boolean
  /** Measure tool; map selection and editing pause while it is on. */
  measureMode?: MeasureMode | null
  onMeasureChange?: (r: MeasureResult) => void
  /** 3D pipe + junction water rendering (Three.js custom layer). */
  showNetwork3D?: boolean
  /** Model length unit in meters (0.3048 for US-unit models); 3D uses meters. */
  lengthUnitScale?: number
  /** 3D vertical exaggeration; null/undefined = automatic. */
  verticalExaggeration?: number | null
  onProfileNodePick?: (nodeId: string, opts?: { shift?: boolean }) => void
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
  private onFit: () => void
  constructor(onFit: () => void) {
    this.onFit = onFit
  }

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

    const fit = document.createElement('button')
    fit.type = 'button'
    fit.className = 'maplibregl-ctrl-icon'
    fit.title = 'Zoom to model extent (Home)'
    fit.setAttribute('aria-label', 'Zoom to model extent')
    fit.setAttribute('data-testid', 'map-fit-extent')
    fit.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>'
    fit.style.cssText = 'width: 29px; height: 29px; display: flex; align-items: center; justify-content: center;'
    fit.addEventListener('click', (e) => {
      e.preventDefault()
      this.onFit()
    })

    container.appendChild(north)
    container.appendChild(plan)
    container.appendChild(fit)
    this._container = container
    return container
  }

  onRemove(): void {
    this._container?.remove()
    this._container = undefined
  }
}

/**
 * True once the style itself is parsed and can take addSource/addLayer.
 * Unlike `isStyleLoaded()`, it does not wait for basemap tiles: on a fast
 * screen with many tiles that wait held the network back for many seconds.
 */
function styleReady(map: MapLibreMap): boolean {
  return Boolean((map as unknown as { style?: { _loaded?: boolean } }).style?._loaded)
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
  if (styleReady(map)) {
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
    if (done || !styleReady(map)) return
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
    // A change between runs keeps its sign (lower / higher).
    runoffBySub.set(subIds[i], isChangeSymbology() ? (subVals[i] ?? 0) : Math.abs(subVals[i] ?? 0))
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
        props.flow = isChangeSymbology() ? signed : Math.abs(signed)
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

const FLOW_GLOW_LAYER = 'links-flow-glow'
/** The flow halo is the only map layer; droplets are drawn by FlowParticles. */
const FLOW_LAYERS = [FLOW_GLOW_LAYER]

const FLOW_RATIO: maplibregl.ExpressionSpecification = ['coalesce', ['get', 'flow_ratio'], 0.4]

/** Halo and droplet colours: deep blue halo on light maps, cyan glow on dark ones. */
function flowPaint(light: boolean) {
  return {
    glow: ['interpolate', ['linear'], FLOW_RATIO, 0, light ? '#0369a1' : '#0891b2', 1, light ? '#1d4ed8' : '#67e8f9'] as maplibregl.ExpressionSpecification,
    glowOpacity: ['+', light ? 0.32 : 0.28, ['*', light ? 0.3 : 0.4, FLOW_RATIO]] as maplibregl.ExpressionSpecification,
  }
}

/** Re-tint the flow layers when the basemap switches between light and dark. */
function applyFlowTheme(map: MapLibreMap, light: boolean): void {
  const p = flowPaint(light)
  if (map.getLayer(FLOW_GLOW_LAYER)) {
    map.setPaintProperty(FLOW_GLOW_LAYER, 'line-color', p.glow)
    map.setPaintProperty(FLOW_GLOW_LAYER, 'line-opacity', p.glowOpacity)
  }
}

function addFlowLayers(map: MapLibreMap, beforeId?: string): void {
  if (!map.getLayer(FLOW_GLOW_LAYER)) {
    map.addLayer(
      {
        id: FLOW_GLOW_LAYER,
        type: 'line',
        source: 'links-flow-anim',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': flowPaint(false).glow,
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, ['+', 5, ['*', 5, FLOW_RATIO]],
            17, ['+', 10, ['*', 12, FLOW_RATIO]],
          ],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 11, 3, 17, 7],
          'line-opacity': flowPaint(false).glowOpacity,
        },
      },
      // Halo sits under the pipe so the pipe keeps its results colour.
      map.getLayer('links') ? 'links' : beforeId,
    )
  }
}

/**
 * Build oriented link geometries for flow dashes.
 * With a snapshot: only links with |flow| above epsilon; reverse coords when flow < 0.
 * Without: all LineString links (gentle ambient animation).
 */
function buildFlowAnimLinks(
  links: FeatureCollection,
  snapshot: OutSnapshotResponse | null | undefined,
  flowMax: number,
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
    let ratio = 0.4

    if (snapshot) {
      const fromProps = f.properties?.flow_signed
      const signed =
        typeof fromProps === 'number' && Number.isFinite(fromProps)
          ? fromProps
          : (flowByLink.get(id) ?? 0)
      if (!(Math.abs(signed) > FLOW_ANIM_EPS)) continue
      if (signed < 0) coords = coords.slice().reverse()
      // sqrt spreads the low end so small pipes still read as moving.
      ratio = Math.min(1, Math.sqrt(Math.abs(signed) / Math.max(flowMax, FLOW_ANIM_EPS)))
    }

    features.push({
      type: 'Feature',
      properties: {
        ...(f.properties ?? {}),
        flow_ratio: ratio,
      },
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
  for (const layerId of ['links', 'links-hit', FLOW_GLOW_LAYER]) {
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
  basemap: MapBackground,
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
    addFlowLayers(map)
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

  // Hot-add the flow layers if links already existed from an older session
  if (map.getLayer('links') && !map.getLayer(FLOW_GLOW_LAYER) && map.getSource('links-flow-anim')) {
    addFlowLayers(map, map.getLayer('links-selected') ? 'links-selected' : undefined)
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

/** Multiply every output of a zoom interpolation (or a plain value) by `f`. */
function scaleExpr(expr: unknown, f: maplibregl.ExpressionSpecification): maplibregl.ExpressionSpecification {
  if (Array.isArray(expr) && expr[0] === 'interpolate' && Array.isArray(expr[2]) && expr[2][0] === 'zoom') {
    const out = expr.slice(0, 3) as unknown[]
    for (let i = 3; i < expr.length; i += 2) out.push(expr[i], ['*', expr[i + 1], f])
    return out as maplibregl.ExpressionSpecification
  }
  return ['*', expr as number, f] as maplibregl.ExpressionSpecification
}

const nodeKindMatch = (v: (k: 'junction' | 'outfall' | 'storage') => number | string) =>
  ['match', ['get', 'node_kind'], 'outfall', v('outfall'), 'storage', v('storage'), v('junction')] as maplibregl.ExpressionSpecification
const linkKindMatch = (v: (k: 'conduit' | 'pump' | 'orifice' | 'weir' | 'outlet') => number | string) =>
  [
    'match', ['get', 'link_kind'],
    'pump', v('pump'), 'orifice', v('orifice'), 'weir', v('weir'), 'outlet', v('outlet'),
    v('conduit'),
  ] as maplibregl.ExpressionSpecification

/**
 * Apply the user's per-type size, opacity and colour on top of the built-in
 * look. In results mode colours carry the results, so only size and opacity
 * apply there.
 */
function applyMapStyle(map: MapLibreMap, style: MapStyle | undefined, results: boolean, flowMax: number, basemap: MapBackground) {
  const st = style ?? {}
  // Node colours are baked into the icon bitmaps: redraw an icon only when its colour changes.
  const applied = ((map as unknown as { __ssNodeFill?: Record<string, string> }).__ssNodeFill ??= {})
  for (const kind of ['junction', 'outfall', 'storage'] as const) {
    const want = styleColor(st, kind)
    if (applied[kind] === want || !map.hasImage(NODE_ICON_IDS[kind])) continue
    const img = buildNodeIconImageData(kind, want)
    map.updateImage(NODE_ICON_IDS[kind], { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer) })
    applied[kind] = want
  }
  if (map.getLayer('nodes')) {
    map.setLayoutProperty('nodes', 'icon-size', scaleExpr(nodeIconSizeExpr(), nodeKindMatch((k) => styleSize(st, k))))
    map.setPaintProperty('nodes', 'icon-opacity', nodeKindMatch((k) => styleOpacity(st, k)))
  }
  if (map.getLayer('nodes-junction-depth')) {
    map.setPaintProperty('nodes-junction-depth', 'circle-radius', scaleExpr(nodeDepthRadiusExpr(), styleSize(st, 'junction') as unknown as maplibregl.ExpressionSpecification))
    map.setPaintProperty('nodes-junction-depth', 'circle-opacity', styleOpacity(st, 'junction'))
    map.setPaintProperty('nodes-junction-depth', 'circle-stroke-opacity', styleOpacity(st, 'junction'))
  }
  if (map.getLayer('links')) {
    const base = results ? linkFlowWidthExpr(flowMax) : 2.5
    map.setPaintProperty('links', 'line-width', ['*', base, linkKindMatch((k) => styleSize(st, k))] as maplibregl.ExpressionSpecification)
    map.setPaintProperty('links', 'line-opacity', ['*', 0.95, linkKindMatch((k) => styleOpacity(st, k))] as maplibregl.ExpressionSpecification)
    if (!results) map.setPaintProperty('links', 'line-color', linkKindMatch((k) => styleColor(st, k)))
  }
  if (map.getLayer('subs-fill')) {
    const op = styleOpacity(st, 'subcatchment')
    map.setPaintProperty('subs-fill', 'fill-opacity', (isLightBasemap(basemap) ? 0.28 : 0.45) * op)
    if (!results) map.setPaintProperty('subs-fill', 'fill-color', styleColor(st, 'subcatchment'))
  }
  if (map.getLayer('subs-outline')) {
    map.setPaintProperty('subs-outline', 'line-width', styleSize(st, 'subcatchment'))
    map.setPaintProperty('subs-outline', 'line-opacity', 0.7 * styleOpacity(st, 'subcatchment'))
    map.setPaintProperty('subs-outline', 'line-color', st.subcatchment?.color ?? '#166534')
  }
}

/** Colours chosen per element (map styling by property, design checks). */
export type ThematicStyle = {
  target: 'link' | 'node' | 'subcatchment'
  colorById: Record<string, string>
  /** Colour for elements without a value. */
  fallback: string
}

function applyThematic(map: MapLibreMap, t: ThematicStyle | null | undefined) {
  if (!t) return
  const pairs: string[] = []
  for (const [id, c] of Object.entries(t.colorById)) pairs.push(id, c)
  const expr = (pairs.length ? ['match', ['to-string', ['get', 'id']], ...pairs, t.fallback] : t.fallback) as maplibregl.ExpressionSpecification
  if (t.target === 'link' && map.getLayer('links')) {
    map.setPaintProperty('links', 'line-color', expr)
    map.setPaintProperty('links', 'line-width', 3.5)
  } else if (t.target === 'subcatchment' && map.getLayer('subs-fill')) {
    map.setPaintProperty('subs-fill', 'fill-color', expr)
    map.setPaintProperty('subs-fill', 'fill-opacity', 0.6)
  } else if (t.target === 'node' && map.getLayer('nodes-junction-depth')) {
    map.setLayoutProperty('nodes-junction-depth', 'visibility', 'visible')
    map.setPaintProperty('nodes-junction-depth', 'circle-color', expr)
    map.setPaintProperty('nodes-junction-depth', 'circle-radius', 6)
    map.setPaintProperty('nodes-junction-depth', 'circle-stroke-width', 1)
    map.setFilter('nodes', ['match', ['get', 'node_kind'], 'outfall', true, 'storage', true, false])
  }
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

/** Shift, Ctrl or Cmd: add to the selection instead of replacing it. */
function additiveEvent(e: MouseEvent | undefined) {
  return Boolean(e && (e.shiftKey || e.ctrlKey || e.metaKey))
}

export function NetworkMap({
  customTilesUrl = '',
  thematic = null,
  network,
  basemap: basemapPref,
  showSubcatchments,
  showLinks,
  showJunctions = true,
  showOutfalls = true,
  showStorage = true,
  visibleLinkKinds = defaultVisibleLinkKinds(),
  backgroundLayers = [],
  flowAccumOverlay = null,
  showFlowAccum = false,
  selection,
  zoomToSelectionNonce = 0,
  onSelect,
  multiSelection,
  onBoxSelect,
  onContextMenu,
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
  profilePickedIds = [],
  showFlowAnim = false,
  changeMode = false,
  layerStyle,
  showLabels = false,
  meshOpacity = 1,
  surfaceFlow = null,
  show3DBuildings = false,
  measureMode = null,
  onMeasureChange,
  showNetwork3D = false,
  lengthUnitScale = 1,
  verticalExaggeration = null,
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
  const coarse = useCoarsePointer()
  // "None" follows the theme: dark in dark mode, light in light mode.
  const theme = useResolvedTheme()
  const basemap = effectiveBasemap(basemapPref, theme)
  // Before anything below builds features or colours from the snapshot.
  setChangeSymbology(changeMode)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const dragNodeIdRef = useRef<string | null>(null)
  const middlePanRef = useRef({ active: false, lastX: 0, lastY: 0 })
  const hoverRafRef = useRef<number | null>(null)
  const hoverElRef = useRef<HTMLDivElement | null>(null)
  const setHover = (h: { x: number; y: number; id: string; kind: string; value?: string } | null) => {
    const el = hoverElRef.current
    if (!el) return
    if (!h) {
      el.style.display = 'none'
      return
    }
    el.style.display = 'block'
    el.style.left = `${h.x + 14}px`
    el.style.top = `${h.y + 14}px`
    ;(el.children[0] as HTMLElement).textContent = h.id
    ;(el.children[1] as HTMLElement).textContent = h.kind
    ;(el.children[2] as HTMLElement).textContent = h.value ?? ''
  }
  const customTilesRef = useRef(customTilesUrl)
  customTilesRef.current = customTilesUrl
  const thematicRef = useRef(thematic)
  thematicRef.current = thematic
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const scaleRef = useRef<maplibregl.ScaleControl | null>(null)
  const layerStyleRef = useRef(layerStyle)
  layerStyleRef.current = layerStyle
  const unitsRef = useRef(lengthUnitScale)
  unitsRef.current = lengthUnitScale
  const projectKeyRef = useRef(projectKey)
  projectKeyRef.current = projectKey
  /** Fit extent once network data is ready after open / toolbar request */
  const pendingFitRef = useRef(true)
  /** Project path we last successfully fitted — avoids fitting stale network on switch */
  const lastFittedProjectRef = useRef<string | null>(null)

  const handlersRef = useRef({
    onSelect,
    onBoxSelect,
    onContextMenu,
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
    measuring: false as boolean,
  })

  handlersRef.current = {
    onSelect,
    onBoxSelect,
    onContextMenu,
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
    measuring: measureMode != null,
  }

  const wgsGeojson = useMemo(
    () => reprojectGeoJson(network.geojson, network.crs),
    [network.geojson, network.crs],
  )
  const wgsGeojsonRef = useRef(wgsGeojson)
  wgsGeojsonRef.current = wgsGeojson
  const networkRef = useRef(network)
  const projectInfo = useQuery({ queryKey: ['project'], queryFn: api.currentProject, staleTime: 30_000 })
  const crsAreaRef = useRef<[number, number, number, number] | null>(null)
  crsAreaRef.current = projectInfo.data?.crs_area ?? null
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
  const network3dLayerRef = useRef<Network3DCustomLayer | null>(null)
  const network3dPitchedRef = useRef(false)

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
    if (!styleReady(map)) {
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
    // An empty model has no real extent: its bounds sit at coordinate (0, 0),
    // which for most projected CRSs is open ocean (UTM 32N: the Gulf of
    // Guinea). Show the CRS's own area of use instead, or the world.
    const empty = !featureBounds && !meshBounds && !(wgsGeojsonRef.current?.features?.length)
    if (empty) {
      const area = crsAreaRef.current
      pendingFitRef.current = false
      lastFittedProjectRef.current = projectKeyRef.current
      map.resize()
      map.stop()
      if (area && area[2] > area[0] && area[3] > area[1]) {
        map.fitBounds(
          [
            [area[0], Math.max(area[1], -56)],
            [area[2], Math.min(area[3], 72)],
          ],
          { padding: 40, animate: false, maxZoom: 9 },
        )
      } else {
        map.jumpTo({ center: [0, 20], zoom: 1.5 })
      }
      return
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
        duration: fitAnimatedRef.current ? 500 : 0,
        maxZoom: 17,
      },
    )
    fitAnimatedRef.current = false
  }
  /** The next fit was asked for by the user: move there instead of jumping. */
  const fitAnimatedRef = useRef(false)
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
  const depthMax = Math.max(
    symbologyExtents?.depthMax ?? snapshot?.node_depth_max ?? 0.01,
    0.01,
  )
  const flowMax = Math.max(
    symbologyExtents?.flowMax ?? snapshot?.link_flow_max ?? 0.01,
    0.01,
  )
  const [geomSyncTick, setGeomSyncTick] = useState(0)
  const backgroundLayersRef = useRef<GisLayer[]>([])
  const flowAnimLinks = useMemo(
    () =>
      showFlowAnim && showLinks
        ? buildFlowAnimLinks(links, snapshot, flowMax)
        : { type: 'FeatureCollection' as const, features: [] },
    [showFlowAnim, showLinks, links, snapshot, flowMax],
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
    map.addControl(
      new OrientationControl(() => {
        fitAnimatedRef.current = true
        pendingFitRef.current = true
        lastFittedProjectRef.current = null
        applyPendingFitRef.current()
      }),
      'top-left',
    )
    const scale = new maplibregl.ScaleControl({ maxWidth: 110, unit: unitsRef.current !== 1 ? 'imperial' : 'metric' })
    map.addControl(scale, 'bottom-left')
    scaleRef.current = scale
    mapRef.current = map
    if (import.meta.env.DEV || localStorage.getItem("saturday-swmm.debug") === "1") {
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
      applyMapStyle(map, layerStyleRef.current, resultsSymbology, flowMax, basemap)
    applyThematic(map, thematicRef.current)
      // The data the map was created with may be stale by now (results for the
      // shown time step often arrive while the style loads), so let the geometry
      // sync effect push the current features rather than this closure's.
      setGeomSyncTick((t) => t + 1)
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

    // Clicking a background GIS feature shows its attributes.
    let gisPopup: maplibregl.Popup | null = null
    const showGisFeature = (point: maplibregl.PointLike, lngLat: maplibregl.LngLat) => {
      gisPopup?.remove()
      gisPopup = null
      const ids = gisVectorLayerIds(map).filter((id) => map.getLayoutProperty(id, 'visibility') !== 'none')
      if (!ids.length) return
      const hit = map.queryRenderedFeatures(point, { layers: ids })[0]
      if (!hit) return
      const layerId = String(hit.layer.id).replace(/^bg-vec-(fill|line|pt)-/, '')
      const layer = backgroundLayersRef.current.find((l) => l.id === layerId)
      const el = document.createElement('div')
      el.className = 'ss-gis-popup'
      const h = document.createElement('div')
      h.className = 'ss-gis-popup-title'
      h.textContent = layer?.name ?? 'Feature'
      el.appendChild(h)
      const entries = Object.entries(hit.properties ?? {}).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
      const table = document.createElement('table')
      for (const [k, v] of entries.slice(0, 24)) {
        const tr = table.insertRow()
        tr.insertCell().textContent = k
        tr.insertCell().textContent = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v)
      }
      if (!entries.length) {
        const p = document.createElement('p')
        p.textContent = 'No attributes'
        el.appendChild(p)
      } else el.appendChild(table)
      if (entries.length > 24) {
        const p = document.createElement('p')
        p.textContent = `and ${entries.length - 24} more`
        el.appendChild(p)
      }
      gisPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', className: 'ss-gis-popup-wrap' }).setLngLat(lngLat).setDOMContent(el).addTo(map)
    }

    map.on('click', (e) => {
      if (handlersRef.current.measuring) return
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

      // Shift-clicks in select mode go through the box-select handler.
      if (e.originalEvent.shiftKey && h.onBoxSelect && !h.profilePickMode) return
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
            h.onProfileNodePick(id, { shift: e.originalEvent.shiftKey })
            return
          }
          h.onSelect({ object_type, id }, { additive: additiveEvent(e.originalEvent) })
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

      if (additiveEvent(e.originalEvent)) return // keep the selection when Shift/Ctrl-clicking empty map
      showGisFeature(e.point, e.lngLat)
      h.onSelect(null)
      h.onSelectBoundary?.(null)
      h.onSelectTriangle?.(null)
    })

    // ---- right-click menu (ignored when the right button dragged to rotate/tilt)
    let rightDown: { x: number; y: number } | null = null
    map.on('mousedown', (e) => {
      if (handlersRef.current.measuring) return
      if (e.originalEvent.button === 2) rightDown = { x: e.point.x, y: e.point.y }
    })
    map.on('mouseup', (e) => {
      if (handlersRef.current.measuring) return
      if (e.originalEvent.button !== 2 || !rightDown) return
      const moved = Math.hypot(e.point.x - rightDown.x, e.point.y - rightDown.y)
      rightDown = null
      const h = handlersRef.current
      if (moved > 4 || !h.onContextMenu) return
      const f = pickFeature(e.point)
      const ot = String(f?.properties?.object_type ?? '')
      const target =
        f?.properties && (ot === 'node' || ot === 'link' || ot === 'subcatchment')
          ? ({ object_type: ot, id: String(f.properties.id) } as NonNullable<Selection>)
          : null
      const [x, y] = wgs84ToProject(e.lngLat.lng, e.lngLat.lat, h.networkCrs)
      const r = map.getContainer().getBoundingClientRect()
      h.onContextMenu({ target, lngLat: [e.lngLat.lng, e.lngLat.lat], xy: [x, y], point: { x: e.point.x + r.left, y: e.point.y + r.top } })
    })

    // ---- Shift-drag box selection (replaces MapLibre's shift box-zoom)
    map.boxZoom.disable()
    const container = map.getCanvasContainer()
    let box: { start: maplibregl.Point; el: HTMLDivElement; additive: boolean } | null = null
    const pos = (ev: MouseEvent) => {
      const r = container.getBoundingClientRect()
      return new maplibregl.Point(ev.clientX - r.left - container.clientLeft, ev.clientY - r.top - container.clientTop)
    }
    const onBoxMove = (ev: MouseEvent) => {
      if (!box) return
      const p = pos(ev)
      const minX = Math.min(box.start.x, p.x)
      const minY = Math.min(box.start.y, p.y)
      Object.assign(box.el.style, {
        transform: `translate(${minX}px, ${minY}px)`,
        width: `${Math.abs(p.x - box.start.x)}px`,
        height: `${Math.abs(p.y - box.start.y)}px`,
      })
    }
    const onBoxUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onBoxMove)
      document.removeEventListener('mouseup', onBoxUp)
      if (!box) return
      const p = pos(ev)
      const b = box
      box = null
      b.el.remove()
      map.dragPan.enable()
      if (Math.abs(p.x - b.start.x) < 4 && Math.abs(p.y - b.start.y) < 4) {
        // No drag: a Shift-click (the map's own click handler skips these).
        const f = pickFeature(p)
        const ot = String(f?.properties?.object_type ?? '')
        if (f?.properties && (ot === 'node' || ot === 'link' || ot === 'subcatchment'))
          handlersRef.current.onSelect({ object_type: ot, id: String(f.properties.id) } as NonNullable<Selection>, { additive: true })
        return
      }
      const feats = map.queryRenderedFeatures([b.start, p], {
        layers: ['nodes', 'nodes-hit', 'links', 'links-hit', 'subs-fill'].filter((id) => Boolean(map.getLayer(id))),
      })
      const seen = new Set<string>()
      const items: NonNullable<Selection>[] = []
      for (const f of feats) {
        const ot = String(f.properties?.object_type ?? '')
        if (ot !== 'node' && ot !== 'link' && ot !== 'subcatchment') continue
        const key = `${ot}:${f.properties?.id}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ object_type: ot, id: String(f.properties?.id) } as NonNullable<Selection>)
      }
      handlersRef.current.onBoxSelect?.(items, b.additive)
    }
    container.addEventListener(
      'mousedown',
      (ev: MouseEvent) => {
        const h = handlersRef.current
        if (h.measuring || !ev.shiftKey || ev.button !== 0 || h.drawMode !== 'select' || !h.onBoxSelect || h.profilePickMode) return
        ev.preventDefault()
        ev.stopPropagation()
        map.dragPan.disable()
        const el = document.createElement('div')
        el.className = 'pointer-events-none absolute left-0 top-0 z-10 rounded-sm border border-sky-400 bg-sky-400/15'
        container.appendChild(el)
        box = { start: pos(ev), el, additive: ev.ctrlKey || ev.metaKey }
        document.addEventListener('mousemove', onBoxMove)
        document.addEventListener('mouseup', onBoxUp)
      },
      true,
    )

    map.on('dblclick', (e) => {
      if (handlersRef.current.measuring) return
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
      if (handlersRef.current.measuring) return
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
        const ot = f?.properties?.object_type
        if (!f || !['node', 'link', 'subcatchment'].includes(String(ot))) {
          setHover(null)
          return
        }
        const p = f.properties as Record<string, unknown>
        const id = String(p.id ?? '')
        const kind = String(p.node_kind ?? p.link_kind ?? 'subcatchment')
        const snap = snapshotRef.current
        const us = unitsRef.current !== 1
        let value: string | undefined
        if (snap) {
          if (ot === 'node') {
            const i = snap.node_ids.indexOf(id)
            if (i >= 0) value = `Depth ${(snap.node_depths[i] ?? 0).toFixed(2)} ${us ? 'ft' : 'm'}`
          } else if (ot === 'link') {
            const i = snap.link_ids.indexOf(id)
            if (i >= 0) value = `Flow ${(snap.link_flows[i] ?? 0).toFixed(3)}`
          } else {
            const i = (snap.subcatchment_ids ?? []).indexOf(id)
            if (i >= 0) value = `Runoff ${(snap.subcatchment_runoffs?.[i] ?? 0).toFixed(3)}`
          }
        } else if (ot === 'node' && p.max_depth != null) {
          value = `Max depth ${p.max_depth}`
        } else if (ot === 'link' && p.diameter != null) {
          value = `Size ${p.diameter}`
        }
        setHover({ x: point.x, y: point.y, id, kind, value })
      })
    })
    map.on('mouseout', () => {
      setHover(null)
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
      if (handlersRef.current.measuring) return
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
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady(map)) return

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

    const ensureCustom = () => {
      const url = customTilesRef.current
      const src = map.getSource('custom-tiles') as (maplibregl.RasterTileSource & { tiles?: string[] }) | undefined
      if (src && src.tiles?.[0] !== url) {
        if (map.getLayer('custom-tiles')) map.removeLayer('custom-tiles')
        map.removeSource('custom-tiles')
      }
      if (!url) return
      if (!map.getSource('custom-tiles')) map.addSource('custom-tiles', { type: 'raster', tiles: [url], tileSize: 256, attribution: 'Custom tiles' })
      if (!map.getLayer('custom-tiles')) map.addLayer({ id: 'custom-tiles', type: 'raster', source: 'custom-tiles' }, insertBefore)
    }
    const ensureCarto = (kind: 'light' | 'dark') => {
      const id = `canvas-${kind}`
      if (!map.getSource(id)) map.addSource(id, { type: 'raster', tiles: CARTO_TILES[kind], tileSize: 256, maxzoom: CANVAS_MAXZOOM, attribution: CARTO_ATTRIBUTION })
      if (!map.getLayer(id)) map.addLayer({ id, type: 'raster', source: id }, insertBefore)
    }
    setVis('custom-tiles', false)
    setVis('canvas-light', false)
    setVis('canvas-dark', false)
    if (basemap === 'light' || basemap === 'dark') {
      ensureCarto(basemap)
      setVis('osm', false)
      setVis('esri-imagery', false)
      setVis('esri-labels', false)
      setVis(`canvas-${basemap}`, true)
      map.setPaintProperty('background', 'background-color', basemap === 'light' ? '#f2f3f0' : '#0e0e10')
    } else if (basemap === 'custom') {
      ensureCustom()
      setVis('osm', false)
      setVis('esri-imagery', false)
      setVis('esri-labels', false)
      setVis('custom-tiles', true)
      map.setPaintProperty('background', 'background-color', '#dbe4ee')
    } else if (basemap === 'osm') {
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
      map.setPaintProperty('background', 'background-color', basemap === 'projected-light' ? BLANK_LIGHT : BLANK_DARK)
    }
    if (map.getLayer('subs-fill')) {
      map.setPaintProperty(
        'subs-fill',
        'fill-opacity',
        isLightBasemap(basemap) ? 0.28 : 0.4,
      )
    }
  }, [basemap, customTilesUrl])

  // (a) Static 1D geometry + layer paint modes (not per-period result values)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // The style may still be loading; retry once it is, or a toggle made then
    // (e.g. Flow) is silently dropped.
    if (!styleReady(map)) {
      const retry = () => {
        if (styleReady(map)) setGeomSyncTick((t) => t + 1)
      }
      map.on('styledata', retry)
      map.once('load', retry)
      return () => {
        map.off('styledata', retry)
        map.off('load', retry)
      }
    }
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
    applyMapStyle(map, layerStyle, resultsSymbology, flowMax, basemap)
    applyThematic(map, thematicRef.current)
    applyFlowTheme(map, isLightBasemap(basemap))
    ;(map.getSource('subs') as GeoJSONSource)?.setData(
      showSubcatchments ? subs : { type: 'FeatureCollection', features: [] },
    )
    ;(map.getSource('links') as GeoJSONSource)?.setData(showLinks ? links : { type: 'FeatureCollection', features: [] })
    ;(map.getSource('links-flow-anim') as GeoJSONSource)?.setData(
      showFlowAnim && showLinks && !showNetwork3D
        ? flowAnimLinks
        : { type: 'FeatureCollection', features: [] },
    )
    for (const id of FLOW_LAYERS) {
      if (!map.getLayer(id)) continue
      map.setLayoutProperty(
        id,
        'visibility',
        showFlowAnim && showLinks && !showNetwork3D ? 'visible' : 'none',
      )
    }
    // 3D pipes hang below the map: keep a thin dashed trace of each pipe and the
    // manholes on the ground, so the shafts visibly drop from where the network is.
    if (map.getLayer('links')) {
      map.setLayoutProperty('links', 'visibility', showLinks ? 'visible' : 'none')
      if (showNetwork3D) {
        map.setPaintProperty('links', 'line-width', 1.6)
        map.setPaintProperty('links', 'line-opacity', 0.55)
        map.setPaintProperty('links', 'line-dasharray', [2, 2])
      } else {
        map.setPaintProperty('links', 'line-dasharray', undefined)
      }
    }
    if (map.getLayer('nodes')) {
      map.setLayoutProperty('nodes', 'visibility', 'visible')
      if (showNetwork3D) map.setPaintProperty('nodes', 'icon-opacity', 0.8)
    }
    if (map.getLayer('nodes-junction-depth') && showNetwork3D) {
      map.setLayoutProperty('nodes-junction-depth', 'visibility', 'none')
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
    pinNetwork3DLayer(map)
  }, [
    geomSyncTick,
    layerStyle,
    nodes,
    links,
    flowAnimLinks,
    subs,
    showSubcatchments,
    showLinks,
    showFlowAnim,
    showNetwork3D,
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

  // Droplet flow animation on a canvas overlay (no per-frame style changes).
  const flowParticlesRef = useRef<FlowParticles | null>(null)
  const flowOn = showFlowAnim && showLinks && !showNetwork3D
  useEffect(() => {
    const map = mapRef.current
    if (!map || !flowOn) return
    const fp = new FlowParticles(map)
    flowParticlesRef.current = fp
    return () => {
      fp.destroy()
      flowParticlesRef.current = null
    }
  }, [flowOn])
  useEffect(() => {
    const fp = flowParticlesRef.current
    if (!fp) return
    fp.setData(flowAnimLinks)
    const enabled = enabledLinkKinds(visibleLinkKinds)
    fp.setKinds(enabled.length >= 5 ? null : enabled)
    fp.setOptions({
      light: isLightBasemap(basemap),
      still: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    })
  }, [flowOn, flowAnimLinks, visibleLinkKinds, basemap])

  // 3D buildings: OpenFreeMap's OpenMapTiles "building" layer, extruded by height.
  const buildingsTiltedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const light = isLightBasemap(basemap)
      if (show3DBuildings) {
        if (!map.getSource('ofm')) map.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors' })
        // Drawn above the flat layers: flat layers drawn after an extrusion are
        // painted over it regardless of depth, which wrapped subcatchment fills
        // around the buildings. Above them, buildings stand on the ground.
        // Very faint over 3D pipes, so the network underneath stays readable.
        const opacity = showNetwork3D ? 0.16 : 0.65
        if (!map.getLayer('buildings-3d')) {
          const before = ['measure-fill', 'draw-temp-fill'].find((id) => map.getLayer(id))
          map.addLayer(
            {
              id: 'buildings-3d',
              type: 'fill-extrusion',
              source: 'ofm',
              'source-layer': 'building',
              minzoom: 13,
              paint: {
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
                'fill-extrusion-color': light ? '#d6d3d1' : '#334155',
                'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, opacity],
              },
            },
            before,
          )
        } else {
          map.setLayoutProperty('buildings-3d', 'visibility', 'visible')
          map.setPaintProperty('buildings-3d', 'fill-extrusion-color', light ? '#d6d3d1' : '#334155')
          map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, opacity])
        }
        // Buildings only read in 3D: tilt once when they're first turned on.
        if (!buildingsTiltedRef.current && map.getPitch() < 20) {
          buildingsTiltedRef.current = true
          map.easeTo({ pitch: 55, duration: 700 })
        }
      } else if (map.getLayer('buildings-3d')) {
        map.setLayoutProperty('buildings-3d', 'visibility', 'none')
      }
    }
    return whenMapStyleReady(map, apply)
  }, [show3DBuildings, basemap, showNetwork3D])

  // 2D surface-flow tracers (canvas overlay), while Flow is on and depths show.
  const surfaceFlowRef = useRef<SurfaceFlow | null>(null)
  const surfaceOn = Boolean(surfaceFlow && compactMeshWgs && !showNetwork3D)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !surfaceOn || !compactMeshWgs) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const sf = new SurfaceFlow(map, compactMeshWgs)
    surfaceFlowRef.current = sf
    return () => {
      sf.destroy()
      surfaceFlowRef.current = null
    }
  }, [surfaceOn, compactMeshWgs])
  useEffect(() => {
    surfaceFlowRef.current?.setField(surfaceFlow ?? null)
  }, [surfaceFlow, surfaceOn])

  // Scale bar follows the model's length unit.
  useEffect(() => {
    scaleRef.current?.setUnit(lengthUnitScale !== 1 ? 'imperial' : 'metric')
  }, [lengthUnitScale])

  // Element ID labels (canvas overlay, only when zoomed in).
  const labelsRef = useRef<MapLabels | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !showLabels) return
    const l = new MapLabels(map)
    labelsRef.current = l
    return () => {
      l.destroy()
      labelsRef.current = null
    }
  }, [showLabels])
  useEffect(() => {
    const l = labelsRef.current
    if (!l) return
    const enabled = new Set(enabledLinkKinds(visibleLinkKinds))
    l.setData(
      {
        type: 'FeatureCollection',
        features: showNetwork3D
          ? []
          : nodes.features.filter((f) => {
              const k = String(f.properties?.node_kind ?? 'junction')
              return k === 'outfall' ? showOutfalls : k === 'storage' ? showStorage : showJunctions
            }),
      },
      {
        type: 'FeatureCollection',
        features:
          showLinks && !showNetwork3D
            ? links.features.filter((f) => enabled.has(String(f.properties?.link_kind ?? 'conduit') as LinkKind))
            : [],
      },
    )
    l.setLight(isLightBasemap(basemap))
  }, [showLabels, nodes, links, showJunctions, showOutfalls, showStorage, showLinks, showNetwork3D, visibleLinkKinds, basemap])

  // Measure tool.
  const onMeasureRef = useRef(onMeasureChange)
  onMeasureRef.current = onMeasureChange
  useEffect(() => {
    const map = mapRef.current
    if (!map || !measureMode) return
    const start = () => new MeasureTool(map, measureMode, (r) => onMeasureRef.current?.(r))
    let tool: MeasureTool | null = null
    const off = whenMapStyleReady(map, () => (tool = start()))
    return () => {
      off()
      tool?.destroy()
    }
  }, [measureMode])

  // Switching between peak / change colouring redraws the result colours.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    return whenMapStyleReady(map, () => {
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
      applyMapStyle(map, layerStyleRef.current, resultsSymbology, flowMax, basemap)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeMode])

  // (c+d) 2D mesh geometry + flood depth coloring
  // Deps intentionally exclude 1D depthMax/flowMax/runoffMax — those change on every
  // out-snapshot fetch and would re-run this effect (and used to cancel pending depth applies).
  // Large meshes (≥ MESH_LARGE_THRESHOLD) use Mesh2DCustomLayer instead — see effect below.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      if (!styleReady(map)) return
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
      applyMapStyle(map, layerStyleRef.current, resultsSymbology, flowMax, basemap)
    applyThematic(map, thematicRef.current)

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
          if (!styleReady(map) || !map.getLayer('mesh-2d-fill')) return
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
      if (!styleReady(map)) return
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
      applyMapStyle(map, layerStyleRef.current, resultsSymbology, flowMax, basemap)
    applyThematic(map, thematicRef.current)

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
      layer.setOpacity(meshOpacity)
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
    meshOpacity,
  ])

  // Small meshes are plain fill/line layers: same opacity setting.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      if (map.getLayer('mesh-2d-fill')) map.setPaintProperty('mesh-2d-fill', 'fill-opacity', 0.72 * meshOpacity)
      if (map.getLayer('mesh-2d-outline')) map.setPaintProperty('mesh-2d-outline', 'line-opacity', 0.55 * meshOpacity)
    }
    return whenMapStyleReady(map, apply)
  }, [meshOpacity, compactMeshWgs, meshGeoJson])

  // 3D pipe network custom layer (built when toggled on; disposed when off).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      if (!styleReady(map)) return
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
      applyMapStyle(map, layerStyleRef.current, resultsSymbology, flowMax, basemap)
    applyThematic(map, thematicRef.current)

      if (!showNetwork3D) {
        if (map.getLayer(NETWORK3D_CUSTOM_LAYER_ID)) {
          try {
            map.removeLayer(NETWORK3D_CUSTOM_LAYER_ID)
          } catch {
            /* ignore */
          }
        }
        network3dLayerRef.current = null
        if (network3dPitchedRef.current) map.easeTo({ pitch: 0, bearing: 0, duration: 500 })
        network3dPitchedRef.current = false
        return
      }

      let layer = network3dLayerRef.current
      if (!layer || !map.getLayer(NETWORK3D_CUSTOM_LAYER_ID)) {
        layer = new Network3DCustomLayer()
        network3dLayerRef.current = layer
        const before = map.getLayer('subs-fill')
          ? 'subs-fill'
          : map.getLayer('links-selected')
            ? 'links-selected'
            : map.getLayer('nodes')
              ? 'nodes'
              : undefined
        try {
          if (before) map.addLayer(layer as unknown as maplibregl.CustomLayerInterface, before)
          else map.addLayer(layer as unknown as maplibregl.CustomLayerInterface)
        } catch (err) {
          console.error('Failed to add Network3DCustomLayer', err)
          try {
            map.addLayer(layer as unknown as maplibregl.CustomLayerInterface)
          } catch (err2) {
            console.error('Retry add Network3DCustomLayer failed', err2)
            network3dLayerRef.current = null
            return
          }
        }
      }

      layer.setUnitScale(lengthUnitScale)
      layer.setVerticalExaggeration(verticalExaggeration ?? null)
      layer.setNetworkGeoJson(wgsGeojson)
      layer.setSnapshot(
        snapshot
          ? { node_ids: snapshot.node_ids, node_depths: snapshot.node_depths }
          : null,
      )
      layer.setVisible(true)
      // Flow animation and depth halos off in 3D; the pipes keep a thin dashed
      // trace on the ground (styled in geometry sync) under which they hang.
      for (const id of ['nodes-junction-depth', ...FLOW_LAYERS]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }
      if (map.getLayer('links')) {
        map.setPaintProperty('links', 'line-width', 1.6)
        map.setPaintProperty('links', 'line-opacity', 0.55)
        map.setPaintProperty('links', 'line-dasharray', [2, 2])
      }
      pinNetwork3DLayer(map)
      // A lighter ground so the pipes show through it.
      if (map.getLayer('subs-fill')) {
        const op = map.getPaintProperty('subs-fill', 'fill-opacity')
        if (typeof op === 'number') map.setPaintProperty('subs-fill', 'fill-opacity', Math.min(op, 0.3))
      }

      // Tilt once when entering 3D so the depth reads; keep the view centred.
      if (!network3dPitchedRef.current && map.getPitch() < 40) {
        network3dPitchedRef.current = true
        map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 700 })
      }
    }

    const cancel = whenMapStyleReady(map, sync)
    return cancel
  }, [
    showNetwork3D,
    wgsGeojson,
    snapshot,
    basemap,
    resultsSymbology,
    visibleLinkKinds,
    lengthUnitScale,
    verticalExaggeration,
  ])

  // Re-style when the chosen colouring changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    return whenMapStyleReady(map, () => {
      if (!map.getLayer('links')) return
      ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
      applyThematic(map, thematic)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thematic])

  // 2D boundary condition edges
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady(map)) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
    applyThematic(map, thematicRef.current)

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
    if (!map || !styleReady(map)) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
    applyThematic(map, thematicRef.current)

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
    if (!map || !styleReady(map)) return
    syncGisBackgroundLayers(map, backgroundLayers)
    backgroundLayersRef.current = backgroundLayers
  }, [backgroundLayers, basemap, geomSyncTick])

  // DEM flow-accumulation overlay (GIS-style drainage paths)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady(map)) return
    syncFlowAccumLayer(map, flowAccumOverlay, showFlowAccum)
  }, [flowAccumOverlay, showFlowAccum, basemap, backgroundLayers])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource('draw-temp')) return
    // Convert draft WGS84 positions already stored as lng/lat
    ;(map.getSource('draw-temp') as GeoJSONSource).setData(draftCollection(polygonDraft))
  }, [polygonDraft])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('nodes-selected')) return
    const all = multiSelection && multiSelection.length ? multiSelection : selection ? [selection] : []
    const ids = (t: string) => all.filter((x) => x.object_type === t).map((x) => x.id)
    const inFilter = (list: string[]) =>
      (list.length ? ['in', ['get', 'id'], ['literal', list]] : ['==', ['get', 'id'], '']) as maplibregl.FilterSpecification
    const nodeIds = ids('node')
    map.setFilter('nodes-selected', inFilter(pendingLinkFromId && !nodeIds.length ? [pendingLinkFromId] : nodeIds))
    map.setFilter('links-selected', inFilter(ids('link')))
    if (map.getLayer('subs-selected')) {
      map.setFilter('subs-selected', inFilter(ids('subcatchment')))
      map.setFilter('subs-selected-outline', inFilter(ids('subcatchment')))
    }
  }, [selection, multiSelection, pendingLinkFromId])

  useEffect(() => {
    const map = mapRef.current
    if (!(map && styleReady(map))) return
    ensureLayers(map, basemap, depthMax, flowMax, runoffMax, resultsSymbology, twodDepthMax, visibleLinkKinds)
    applyThematic(map, thematicRef.current)
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

  // While picking a profile: mark the start (and via) junctions.
  const pickedKey = profilePickedIds.join('|')
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    return whenMapStyleReady(map, () => {
      if (!map.getSource('nodes')) return
      if (!map.getLayer('nodes-profile-pick')) {
        map.addLayer({
          id: 'nodes-profile-pick',
          type: 'circle',
          source: 'nodes',
          filter: ['==', 'id', ''],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 13, 18, 17],
            'circle-color': '#f59e0b',
            'circle-opacity': 0.28,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#f59e0b',
          },
        })
      }
      map.setFilter('nodes-profile-pick', profilePickedIds.length ? ['in', 'id', ...profilePickedIds] : ['==', 'id', ''])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedKey])

  // Zoom onto the selected object (Find, report tables, model check).
  // Asked for while the map is hidden (from another page), it waits until the
  // map is shown, so restoring the saved camera doesn't undo it.
  const pendingZoomRef = useRef(false)
  const zoomToSelection = () => {
    const map = mapRef.current
    if (!map || !selection) return
    const feat = wgsGeojsonRef.current.features.find(
      (f) => f.properties?.object_type === selection.object_type && String(f.properties?.id) === selection.id,
    )
    if (!feat?.geometry) return
    const pts: number[][] = []
    const walk = (c: unknown) => {
      if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[])
      else if (Array.isArray(c)) c.forEach(walk)
    }
    walk((feat.geometry as { coordinates?: unknown }).coordinates)
    if (!pts.length) return
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const [w, e, s2, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    if (!(e > w) && !(n > s2)) {
      map.easeTo({ center: [w, s2], zoom: Math.max(map.getZoom(), 17), duration: 450 })
    } else {
      map.fitBounds([[w, s2], [e, n]], { padding: 120, duration: 450, maxZoom: 18 })
    }
  }
  const zoomToSelectionRef = useRef(zoomToSelection)
  zoomToSelectionRef.current = zoomToSelection
  useEffect(() => {
    if (zoomToSelectionNonce <= 0) return
    if (!visible) {
      pendingZoomRef.current = true
      return
    }
    zoomToSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomToSelectionNonce])

  // New project → discard prior camera; wait for this project's network before fitting
  useEffect(() => {
    clearCamera(projectKey)
    pendingFitRef.current = true
    lastFittedProjectRef.current = null
  }, [projectKey])

  useEffect(() => {
    if (fitExtentNonce > 0) {
      fitAnimatedRef.current = true
      pendingFitRef.current = true
      lastFittedProjectRef.current = null
      requestAnimationFrame(() => applyPendingFitRef.current())
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

  // The map's box changes without the window changing (a docked pane opening
  // or being dragged, the sidebar collapsing): redraw at the new size.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => mapRef.current?.resize())
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // Restore size + camera when the map tab becomes visible again
  useEffect(() => {
    const map = mapRef.current
    if (!map || !visible) return
    map.resize()
    if (pendingZoomRef.current && lastFittedProjectRef.current === projectKey && !pendingFitRef.current) {
      pendingZoomRef.current = false
      requestAnimationFrame(() => zoomToSelectionRef.current())
      return
    }
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
      <div
        ref={hoverElRef}
        className="map-overlay pointer-events-none absolute z-30 px-2 py-1 text-[11px]"
        style={{ display: 'none' }}
        aria-hidden
      >
        <span className="font-semibold text-fg" />
        <span className="ml-1.5 capitalize text-muted" />
        <div className="tabular-nums text-fg-soft empty:hidden" />
      </div>
      {IS_VIEWER && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 map-overlay px-2.5 py-1 text-[11px] text-muted max-md:hidden">
          {coarse ? 'Drag to pan, pinch to zoom, tap an element for its properties' : 'Drag to pan, scroll to zoom, click an element to see its properties'}
        </div>
      )}
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
