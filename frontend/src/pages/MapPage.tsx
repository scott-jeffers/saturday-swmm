import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Mountain,
  Play,
  Settings2,
  Waves,
} from 'lucide-react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ApiError,
  api,
  type ConflictDetail,
  type ModelNetwork,
  type ModelObjectResponse,
  type TwoDBoundaryItem,
} from '../api/client'
import {
  NetworkMap,
  type BasemapMode,
  type Selection,
} from '../components/map/NetworkMap'
import { MapToolbar, type DrawMode, type LinkDrawKind } from '../components/map/MapToolbar'
import { MapLegend } from '../components/map/MapLegend'
import { BackgroundLayersPanel } from '../components/map/BackgroundLayersPanel'
import { ObjectInspector } from '../components/inspector/ObjectInspector'
import { BoundaryInspector } from '../components/inspector/BoundaryInspector'
import { TriangleInspector } from '../components/inspector/TriangleInspector'
import { TimeSlider } from '../components/results/TimeSlider'
import { TimeSeriesChart } from '../components/TimeSeriesChart'
import { ProfileViewer } from '../components/profile/ProfileViewer'
import { useRunStatus } from '../hooks/useRunStatus'
import { useObjectSeries } from '../hooks/useObjectSeries'
import { useTriangleSeries } from '../hooks/useTriangleSeries'
import { useResultsPlayback } from '../hooks/useResultsPlayback'
import { AlertDialog, Button, Panel, Switch, useToast } from '../components/ui'
import { wgs84ToProject, ensureCrs, DEFAULT_CRS } from '../lib/projection'
import { Link } from 'react-router-dom'
import {
  createUnlockedAudioContext,
  playProfileDepthSequence,
  type DepthSonifyHandle,
} from '../lib/depthSonify'
import { meshResponseToCompactWgs, meshResponseToWgsGeoJson } from '../lib/meshGeoJson'
import { MESH_WIREFRAME_MIN_ZOOM } from '../lib/meshConstants'
import {
  clearMeshAoi,
  getMeshSettings,
  patchMeshSettings,
  subscribeMeshSettings,
} from '../lib/meshSettingsStore'
import {
  removeNetworkObject,
  updateNodeCoordsInNetwork,
  upsertNetworkObject,
} from '../lib/networkCache'
import {
  pushUndo,
  snapshotForRecreate,
  type UndoAction,
} from '../lib/editUndo'
import type { FeatureCollection, Position } from 'geojson'
import { cn } from '../lib/cn'
import {
  defaultVisibleLinkKinds,
  LINK_KIND_OPTIONS,
  type LinkKind,
} from '../lib/linkKinds'
import {
  getLiveRendering,
  subscribeLiveRendering,
} from '../lib/liveRenderingStore'


interface MapPageProps {
  projectPath: string
  visible?: boolean
}

const LAYERS_DEFAULT_W = 256
const LAYERS_WIDE_W = 448
const INSPECTOR_DEFAULT_W = 320
const INSPECTOR_WIDE_W = 480
const PANEL_MIN_W = 180
const PANEL_MAX_W = 640
const BOTTOM_DEFAULT_H = 320
const BOTTOM_TALL_H = 520
const BOTTOM_MIN_H = 140
const BOTTOM_MAX_H = 900

function drawHint(
  mode: DrawMode,
  pendingFrom: string | null,
  draftLen: number,
  linkKind: LinkDrawKind = 'conduit',
) {
  switch (mode) {
    case 'add-junction':
      return 'Click map to place a junction'
    case 'add-outfall':
      return 'Click map to place an outfall'
    case 'add-storage':
      return 'Click map to place a storage node'
    case 'add-conduit':
      return pendingFrom
        ? `From ${pendingFrom} — click destination node (${linkKind})`
        : `Click from-node, then to-node (${linkKind})`
    case 'add-subcatchment':
      return draftLen
        ? `${draftLen} vertices · double-click / Enter to finish · Esc cancel`
        : 'Click to add polygon vertices'
    case 'draw-mesh-aoi':
      return draftLen
        ? `${draftLen} vertices · double-click / Enter to finish · Esc cancel`
        : 'Click to add mesh AOI polygon vertices'
    case 'delete':
      return 'Click an object to delete'
    default:
      return undefined
  }
}

function nearestNodeId(
  network: ModelNetwork,
  x: number,
  y: number,
): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const f of network.geojson.features) {
    if (f.properties?.object_type !== 'node' || f.geometry?.type !== 'Point') continue
    const coords = f.geometry.coordinates
    if (!coords || coords.length < 2) continue
    const d = Math.hypot(Number(coords[0]) - x, Number(coords[1]) - y)
    if (d < bestDist) {
      bestDist = d
      best = String(f.properties.id)
    }
  }
  return best
}

/** Straight-line conduit length from map node coordinates (project CRS). */
function gisConduitLength(
  network: ModelNetwork,
  fromId: string,
  toId: string,
): number | undefined {
  let from: [number, number] | null = null
  let to: [number, number] | null = null
  for (const f of network.geojson.features) {
    if (f.properties?.object_type !== 'node' || f.geometry?.type !== 'Point') continue
    const id = String(f.properties.id)
    const c = f.geometry.coordinates
    if (!c || c.length < 2) continue
    if (id === fromId) from = [Number(c[0]), Number(c[1])]
    if (id === toId) to = [Number(c[0]), Number(c[1])]
  }
  if (!from || !to) return undefined
  const len = Math.hypot(to[0] - from[0], to[1] - from[1])
  return Number.isFinite(len) && len > 0 ? len : undefined
}

export function MapPage({ projectPath, visible = true }: MapPageProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [basemap, setBasemap] = useState<BasemapMode>('osm')
  const [showSubcatchments, setShowSubcatchments] = useState(true)
  const [showLinks, setShowLinks] = useState(true)
  const [visibleLinkKinds, setVisibleLinkKinds] = useState(defaultVisibleLinkKinds)
  const [showJunctions, setShowJunctions] = useState(true)
  const [showOutfalls, setShowOutfalls] = useState(true)
  const [showStorage, setShowStorage] = useState(true)
  const [show2dMesh, setShow2dMesh] = useState(true)
  const [show2dDepth, setShow2dDepth] = useState(true)
  const [show2dBoundaries, setShow2dBoundaries] = useState(false)
  const [showFlowAccum, setShowFlowAccum] = useState(true)
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null)
  const [selectedTriangleIndex, setSelectedTriangleIndex] = useState<number | null>(null)
  const [legendOverrides, setLegendOverrides] = useState<{
    depthMax?: number
    flowMax?: number
    runoffMax?: number
    twodDepthMax?: number
  }>({})
  const [bcDraftType, setBcDraftType] = useState('WALL')
  const [bcDraftParam1, setBcDraftParam1] = useState('')
  const mesh = useSyncExternalStore(subscribeMeshSettings, getMeshSettings, getMeshSettings)
  const liveRenderingPref = useSyncExternalStore(
    subscribeLiveRendering,
    getLiveRendering,
    getLiveRendering,
  )
  const meshAoiDraft = mesh.aoiDraft as Position[]
  const meshAoiPolygon = mesh.aoiPolygon
  const meshPreview = mesh.preview
  const [layersWidth, setLayersWidth] = useState(LAYERS_DEFAULT_W)
  const [layersCollapsed, setLayersCollapsed] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_W)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_DEFAULT_H)
  const [bottomCollapsed, setBottomCollapsed] = useState(false)
  const panelResizeRef = useRef<{
    side: 'layers' | 'inspector' | 'bottom'
    startX: number
    startY: number
    startSize: number
  } | null>(null)
  /** Types = icons / link-kind colors; Results = depth/flow/runoff symbology */
  const [resultsSymbology, setResultsSymbology] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [profileStart, setProfileStart] = useState('')
  const [profileEnd, setProfileEnd] = useState('')
  const [pickMode, setPickMode] = useState<'start' | 'end' | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showFlowAnim, setShowFlowAnim] = useState(false)
  const [showNetwork3D, setShowNetwork3D] = useState(false)
  const [sonifyPlaying, setSonifyPlaying] = useState(false)
  const sonifyHandleRef = useRef<DepthSonifyHandle | null>(null)
  const sonifyGenRef = useRef(0)
  const [drawMode, setDrawMode] = useState<DrawMode>('select')
  const [linkDrawKind, setLinkDrawKind] = useState<LinkDrawKind>('conduit')
  const [pendingLinkFromId, setPendingLinkFromId] = useState<string | null>(null)
  const [polygonDraft, setPolygonDraft] = useState<Position[]>([])
  const [deleteTarget, setDeleteTarget] = useState<NonNullable<Selection> | null>(null)
  const [cascadeLinks, setCascadeLinks] = useState<string[]>([])
  const [forceCascade, setForceCascade] = useState(false)
  const [fitExtentNonce, setFitExtentNonce] = useState(0)
  const [fitWgsBoundsRequest, setFitWgsBoundsRequest] = useState<{
    nonce: number
    west: number
    south: number
    east: number
    north: number
  } | null>(null)
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])
  const undoingRef = useRef(false)
  const { data: runStatus } = useRunStatus()
  const liveActive =
    liveRenderingPref &&
    runStatus?.status === 'running' &&
    Boolean(runStatus?.live_rendering)

  const toggleLinkKind = useCallback((kind: LinkKind) => {
    setVisibleLinkKinds((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }, [])

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
  })

  const projectCrs = project.data?.crs ?? DEFAULT_CRS

  useEffect(() => {
    if (!project.data?.crs) return
    ensureCrs(project.data.crs, project.data.crs_proj4)
  }, [project.data?.crs, project.data?.crs_proj4])

  const network = useQuery({
    queryKey: ['network', projectPath, projectCrs],
    queryFn: () => api.getNetwork(projectCrs),
    enabled: Boolean(project.data),
  })

  const networkKey = ['network', projectPath, projectCrs] as const

  // Fit extent once when this project's network first arrives (or after CRS change)
  const fittedPathRef = useRef<string | null>(null)
  const fittedCrsRef = useRef<string | null>(null)
  useEffect(() => {
    fittedPathRef.current = null
    fittedCrsRef.current = null
  }, [projectPath])
  useEffect(() => {
    if (!visible || !network.data) return
    const already =
      fittedPathRef.current === projectPath && fittedCrsRef.current === projectCrs
    if (already) return
    const has =
      (network.data.geojson?.features?.length ?? 0) > 0 || Boolean(network.data.bounds)
    if (!has) return
    fittedPathRef.current = projectPath
    fittedCrsRef.current = projectCrs
    setFitExtentNonce((n) => n + 1)
  }, [projectPath, projectCrs, network.data, visible])

  const isHybridEngine = project.data?.simulation_engine === 'hybrid'
  const hasHybridResults = Boolean(project.data?.has_hybrid_results)

  const twodInfo = useQuery({
    queryKey: ['2d-info', projectPath, project.data?.inp_path, runStatus?.status],
    queryFn: api.getTwoDInfo,
    enabled: Boolean(project.data) && !isHybridEngine,
    retry: false,
  })

  const twodMesh = useQuery({
    queryKey: ['2d-mesh', projectPath, project.data?.inp_path, projectCrs],
    queryFn: () => api.getTwoDMesh(projectCrs),
    enabled: Boolean(twodInfo.data?.has_mesh) && !isHybridEngine,
    retry: false,
    staleTime: 60_000,
  })

  const hybridMesh = useQuery({
    queryKey: ['hybrid-mesh', projectPath, project.data?.inp_path, runStatus?.status],
    queryFn: api.getHybridMesh,
    enabled: isHybridEngine && hasHybridResults,
    retry: false,
    staleTime: 60_000,
  })

  const activeMesh = isHybridEngine ? hybridMesh.data : twodMesh.data
  const hasTwoDResults = isHybridEngine
    ? hasHybridResults
    : Boolean(twodInfo.data?.has_results)

  const triangleCount =
    activeMesh?.counts?.triangles ??
    (isHybridEngine ? 0 : (twodInfo.data?.triangle_count ?? 0))

  const {
    period,
    setPeriod,
    queryPeriod,
    playing,
    setPlaying,
    showAllPeaks,
    setShowAllPeaks,
    largeMesh,
    liveSnapshot,
    periods,
    snapshot,
    twodSnapshot,
    twodBinary,
    displaySnapshot,
    displayTwodSnapshot,
    displayTwodBinary,
    symbologyExtents: autoSymbology,
    timeLabel,
    hasResultPeriods,
    canShowResults,
    scrubberPeriodCount,
  } = useResultsPlayback({
    projectPath,
    inpPath: project.data?.inp_path,
    hasOut: project.data?.has_out,
    runStatus: runStatus?.status,
    liveActive,
    resultsSymbology,
    show2dDepth,
    hasTwoDResults,
    triangleCount,
    meshSource: isHybridEngine ? 'hybrid' : 'openswmm',
  })

  const symbology = useMemo(
    () => ({
      depthMax: legendOverrides.depthMax ?? autoSymbology.depthMax,
      flowMax: legendOverrides.flowMax ?? autoSymbology.flowMax,
      runoffMax: legendOverrides.runoffMax ?? autoSymbology.runoffMax,
      twodDepthMax: legendOverrides.twodDepthMax ?? autoSymbology.twodDepthMax,
    }),
    [autoSymbology, legendOverrides],
  )

  /** Small meshes: full WGS84 GeoJSON for MapLibre fill. Large: skip (custom layer). */
  const meshGeoJson = useMemo(
    () => (largeMesh ? null : meshResponseToWgsGeoJson(activeMesh, projectCrs)),
    [activeMesh, projectCrs, largeMesh],
  )

  const compactMeshWgs = useMemo(
    () => (largeMesh ? meshResponseToCompactWgs(activeMesh, projectCrs) : null),
    [activeMesh, projectCrs, largeMesh],
  )

  const twodBoundaries = useQuery({
    queryKey: ['2d-boundaries', projectPath, project.data?.inp_path, projectCrs],
    queryFn: () => api.getTwoDBoundaries(projectCrs),
    enabled: Boolean(twodInfo.data?.has_mesh && show2dBoundaries),
    retry: false,
    staleTime: 30_000,
  })

  const saveBoundaries = useMutation({
    mutationFn: (items: TwoDBoundaryItem[]) =>
      api.writeTwoDBoundaries({ items, write_defaults: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['2d-boundaries'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      toast({ title: 'Boundary conditions saved', tone: 'success' })
    },
    onError: (err) =>
      toast({
        title: 'Could not save boundaries',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const boundaryGeoJson = (twodBoundaries.data?.geojson ?? null) as FeatureCollection | null

  const selectedBoundaryFeature = useMemo(() => {
    if (!selectedBoundaryId || !boundaryGeoJson) return null
    return (
      boundaryGeoJson.features.find(
        (f) => String(f.properties?.id ?? '') === selectedBoundaryId,
      ) ?? null
    )
  }, [selectedBoundaryId, boundaryGeoJson])

  useEffect(() => {
    if (!selectedBoundaryFeature?.properties) {
      setBcDraftType('WALL')
      setBcDraftParam1('')
      return
    }
    const p = selectedBoundaryFeature.properties
    setBcDraftType(String(p.bc_type ?? 'WALL'))
    setBcDraftParam1(p.param1 != null && p.param1 !== '' ? String(p.param1) : '')
  }, [selectedBoundaryFeature])

  const objectSeries = useObjectSeries(selection?.object_type, selection?.id)
  const triangleSeries = useTriangleSeries(selectedTriangleIndex)

  const faceInfoQ = useQuery({
    queryKey: ['2d-face', selectedTriangleIndex, projectPath],
    queryFn: () => api.getTwoDFaceInfo(selectedTriangleIndex!),
    enabled: selectedTriangleIndex != null && selectedTriangleIndex >= 0,
    retry: false,
    staleTime: 60_000,
  })

  const triangleCurrentDepth = useMemo(() => {
    if (selectedTriangleIndex == null) return null
    if (displayTwodBinary?.values && selectedTriangleIndex < displayTwodBinary.values.length) {
      return displayTwodBinary.values[selectedTriangleIndex]
    }
    if (displayTwodSnapshot?.values && selectedTriangleIndex < displayTwodSnapshot.values.length) {
      return displayTwodSnapshot.values[selectedTriangleIndex]
    }
    return null
  }, [selectedTriangleIndex, displayTwodBinary, displayTwodSnapshot])

  const show2dDepthActive = Boolean(
    show2dDepth &&
      resultsSymbology &&
      canShowResults &&
      (liveActive
        ? Boolean(displayTwodSnapshot || displayTwodBinary)
        : hasTwoDResults),
  )

  const profile = useQuery({
    queryKey: ['profile', profileStart, profileEnd, queryPeriod, snapshot.data?.period],
    queryFn: () =>
      api.getProfile(
        profileStart,
        profileEnd,
        periods.data && periods.data.period_count > 0 ? queryPeriod : undefined,
      ),
    enabled: Boolean(profileStart && profileEnd),
    retry: false,
  })

  // Topology is independent of report period. Keep the last known path for this
  // start/end so period scrubbing does not clear junction IDs (and cancel depth fetches).
  const [stableProfileNodeIds, setStableProfileNodeIds] = useState<string[]>([])
  useEffect(() => {
    setStableProfileNodeIds([])
  }, [profileStart, profileEnd, projectPath])
  useEffect(() => {
    const ids = profile.data?.path_node_ids
    if (ids?.length) setStableProfileNodeIds(ids)
  }, [profile.data?.path_node_ids])

  const profileNodeIds = stableProfileNodeIds

  // Background prefetch so Tune is ready without visiting each junction.
  useQueries({
    queries: profileNodeIds.map((id) => ({
      queryKey: ['object-series', 'node', id, 'depth', runStatus?.status] as const,
      queryFn: () => api.getNodeSeries(id, 'depth'),
      enabled: Boolean(showProfile && id && project.data?.has_out),
      retry: false as const,
      staleTime: 60_000,
    })),
  })

  const stopSonify = useCallback(() => {
    sonifyGenRef.current += 1
    sonifyHandleRef.current?.stop()
    sonifyHandleRef.current = null
    setSonifyPlaying(false)
  }, [])

  useEffect(() => () => stopSonify(), [stopSonify])

  useEffect(() => {
    stopSonify()
  }, [profileStart, profileEnd, projectPath, stopSonify])

  const toggleSonify = useCallback(async () => {
    if (sonifyPlaying) {
      stopSonify()
      return
    }
    if (!profileNodeIds.length || !project.data?.has_out) return
    setPlaying(false)
    setShowAllPeaks(false)
    const gen = ++sonifyGenRef.current
    setSonifyPlaying(true)
    // Unlock audio in this click turn before any awaits (browser gesture rules).
    const audioContext = createUnlockedAudioContext()
    try {
      const junctions = await Promise.all(
        profileNodeIds.map(async (id) => {
          const series = await queryClient.ensureQueryData({
            queryKey: ['object-series', 'node', id, 'depth', runStatus?.status],
            queryFn: () => api.getNodeSeries(id, 'depth'),
            staleTime: 60_000,
          })
          return { id, values: series.values ?? [] }
        }),
      )
      if (gen !== sonifyGenRef.current) {
        void audioContext.close().catch(() => undefined)
        return
      }
      const ready = junctions.filter((j) => j.values.length > 0)
      if (!ready.length) {
        void audioContext.close().catch(() => undefined)
        setSonifyPlaying(false)
        return
      }
      sonifyHandleRef.current = playProfileDepthSequence(ready, {
        audioContext,
        onJunction: (id) => setSelection({ object_type: 'node', id }),
        onPeriod: (periodIndex) => setPeriod(periodIndex),
        onDone: () => {
          if (gen !== sonifyGenRef.current) return
          sonifyHandleRef.current = null
          setSonifyPlaying(false)
        },
      })
    } catch {
      if (gen === sonifyGenRef.current) {
        void audioContext.close().catch(() => undefined)
        setSonifyPlaying(false)
      } else {
        void audioContext.close().catch(() => undefined)
      }
    }
  }, [
    sonifyPlaying,
    profileNodeIds,
    project.data?.has_out,
    queryClient,
    runStatus?.status,
    stopSonify,
    setPlaying,
    setShowAllPeaks,
    setPeriod,
  ])

  const invalidateNetwork = () => {
    void queryClient.invalidateQueries({ queryKey: ['network'] })
    void queryClient.invalidateQueries({ queryKey: ['object'] })
    void queryClient.invalidateQueries({ queryKey: ['inp'] })
    void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
    void queryClient.invalidateQueries({ queryKey: ['2d-mesh'] })
    void queryClient.invalidateQueries({ queryKey: ['2d-boundaries'] })
    void queryClient.invalidateQueries({ queryKey: ['2d-snapshot'] })
  }

  const applyObjectToCache = (obj: Parameters<typeof upsertNetworkObject>[1]) => {
    queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
      prev ? upsertNetworkObject(prev, obj) : prev,
    )
  }

  const recordUndo = useCallback((action: UndoAction) => {
    if (undoingRef.current) return
    setUndoStack((s) => pushUndo(s, action))
  }, [])

  const softRefreshNetwork = () => {
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['network'] })
    }, 750)
  }

  const moveNode = useMutation({
    mutationFn: ({ id, x, y }: { id: string; x: number; y: number }) =>
      api.patchObject('node', id, { x, y }),
    onMutate: async ({ id }) => {
      const net = queryClient.getQueryData<ModelNetwork>(networkKey)
      const feat = net?.geojson.features.find(
        (f) => f.properties?.object_type === 'node' && String(f.properties?.id) === id,
      )
      if (feat?.geometry?.type === 'Point') {
        const [px, py] = feat.geometry.coordinates
        return { prevX: px, prevY: py }
      }
      return undefined
    },
    onSuccess: (obj, vars, ctx) => {
      queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
        prev ? updateNodeCoordsInNetwork(prev, vars.id, vars.x, vars.y) : prev,
      )
      if (obj.geometry) applyObjectToCache(obj)
      if (ctx && Number.isFinite(ctx.prevX) && Number.isFinite(ctx.prevY)) {
        recordUndo({ kind: 'restore-move', id: vars.id, x: ctx.prevX, y: ctx.prevY })
      }
      void queryClient.invalidateQueries({ queryKey: ['object'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
    },
  })

  const createNode = useMutation({
    mutationFn: api.createNode,
    onSuccess: (obj) => {
      applyObjectToCache(obj)
      setSelection({ object_type: 'node', id: obj.id })
      recordUndo({ kind: 'delete-created', object_type: 'node', id: obj.id })
      toast({ title: 'Node created', description: obj.id, tone: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      softRefreshNetwork()
    },
    onError: (err) =>
      toast({ title: 'Create failed', description: (err as Error).message, tone: 'danger' }),
  })

  const createLink = useMutation({
    mutationFn: api.createLink,
    onSuccess: (obj) => {
      applyObjectToCache(obj)
      setSelection({ object_type: 'link', id: obj.id })
      setPendingLinkFromId(null)
      recordUndo({ kind: 'delete-created', object_type: 'link', id: obj.id })
      const len = obj.attributes?.length
      toast({
        title: 'Conduit created',
        description:
          typeof len === 'number'
            ? `${obj.id} · length ${len.toFixed(2)} (from map)`
            : obj.id,
        tone: 'success',
      })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      softRefreshNetwork()
    },
    onError: (err) =>
      toast({ title: 'Create failed', description: (err as Error).message, tone: 'danger' }),
  })

  const createSub = useMutation({
    mutationFn: api.createSubcatchment,
    onSuccess: (obj) => {
      applyObjectToCache(obj)
      setSelection({ object_type: 'subcatchment', id: obj.id })
      setPolygonDraft([])
      recordUndo({ kind: 'delete-created', object_type: 'subcatchment', id: obj.id })
      toast({ title: 'Subcatchment created', description: obj.id, tone: 'success' })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      softRefreshNetwork()
    },
    onError: (err) =>
      toast({ title: 'Create failed', description: (err as Error).message, tone: 'danger' }),
  })

  const deleteObject = useMutation({
    mutationFn: ({
      sel,
      cascade,
    }: {
      sel: NonNullable<Selection>
      cascade: boolean
      undoSnapshot?: UndoAction | null
    }) => api.deleteObject(sel.object_type, sel.id, cascade),
    onSuccess: (res, vars) => {
      queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
        prev
          ? removeNetworkObject(prev, res.object_type, res.id, res.cascaded_link_ids)
          : prev,
      )
      if (vars.undoSnapshot) recordUndo(vars.undoSnapshot)
      setSelection(null)
      setDeleteTarget(null)
      setCascadeLinks([])
      setForceCascade(false)
      const summary =
        res.cascaded_link_ids.length > 0
          ? `${res.id} (+ ${res.cascaded_link_ids.length} links)`
          : res.id
      const warnings = res.warnings ?? []
      toast({
        title: warnings.length ? 'Deleted — please review' : 'Deleted',
        description: warnings.length ? `${summary}. ${warnings.join(' ')}` : summary,
        tone: warnings.length ? 'default' : 'success',
      })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      void queryClient.invalidateQueries({ queryKey: ['object'] })
      softRefreshNetwork()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const detail = err.detail as ConflictDetail
        if (detail.subcatchment_ids?.length) {
          setDeleteTarget(null)
          toast({ title: 'Cannot delete yet', description: detail.message, tone: 'danger' })
          return
        }
        setCascadeLinks(detail.connected_link_ids ?? [])
        setForceCascade(true)
        return
      }
      toast({ title: 'Delete failed', description: (err as Error).message, tone: 'danger' })
    },
  })

  const performUndo = useCallback(async () => {
    let action: UndoAction | undefined
    setUndoStack((s) => {
      if (!s.length) return s
      action = s[s.length - 1]
      return s.slice(0, -1)
    })
    if (!action) return

    undoingRef.current = true
    try {
      if (action.kind === 'delete-created') {
        const { object_type, id } = action
        try {
          await api.deleteObject(object_type, id, false)
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            await api.deleteObject(object_type, id, true)
          } else {
            throw err
          }
        }
        queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
          prev ? removeNetworkObject(prev, object_type, id) : prev,
        )
        setSelection(null)
        toast({ title: 'Undone', description: `Removed ${id}`, tone: 'success' })
      } else if (action.kind === 'restore-move') {
        const { id, x, y } = action
        const obj = await api.patchObject('node', id, { x, y })
        queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
          prev ? updateNodeCoordsInNetwork(prev, id, x, y) : prev,
        )
        if (obj.geometry) {
          queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
            prev ? upsertNetworkObject(prev, obj) : prev,
          )
        }
        toast({ title: 'Undone', description: `Restored ${id} position`, tone: 'success' })
      } else if (action.kind === 'recreate') {
        let obj: ModelObjectResponse | null = null
        if (action.object_type === 'node' && action.node) {
          obj = await api.createNode(action.node)
        } else if (action.object_type === 'link' && action.link) {
          obj = await api.createLink(action.link)
        } else if (action.object_type === 'subcatchment' && action.sub) {
          obj = await api.createSubcatchment(action.sub)
        }
        if (obj) {
          queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
            prev ? upsertNetworkObject(prev, obj!) : prev,
          )
          setSelection({ object_type: obj.object_type, id: obj.id })
          toast({ title: 'Undone', description: `Restored ${obj.id}`, tone: 'success' })
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      void queryClient.invalidateQueries({ queryKey: ['object'] })
      softRefreshNetwork()
    } catch (err) {
      toast({
        title: 'Undo failed',
        description: (err as Error).message,
        tone: 'danger',
      })
    } finally {
      undoingRef.current = false
    }
  }, [queryClient, toast])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setDrawMode('select')
        setPendingLinkFromId(null)
        setPolygonDraft([])
        patchMeshSettings({ aoiDraft: [] })
        setPickMode(null)
      }
      if (
        ev.key === 'Enter' &&
        drawMode === 'draw-mesh-aoi' &&
        meshAoiDraft.length >= 3 &&
        network.data
      ) {
        ev.preventDefault()
        const ring = meshAoiDraft.map(([lng, lat]) =>
          wgs84ToProject(lng, lat, network.data!.crs),
        )
        patchMeshSettings({
          aoiPolygon: ring,
          aoiDraft: [],
          preview: null,
        })
        setDrawMode('select')
      }
      if (
        (ev.key === 'z' || ev.key === 'Z') &&
        (ev.ctrlKey || ev.metaKey) &&
        !ev.shiftKey &&
        !(ev.target instanceof HTMLInputElement) &&
        !(ev.target instanceof HTMLTextAreaElement)
      ) {
        ev.preventDefault()
        void performUndo()
        return
      }
      if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selection &&
        drawMode === 'select' &&
        !(ev.target instanceof HTMLInputElement) &&
        !(ev.target instanceof HTMLTextAreaElement)
      ) {
        ev.preventDefault()
        setDeleteTarget(selection)
        setCascadeLinks([])
        setForceCascade(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, drawMode, performUndo, meshAoiDraft, network.data])

  const gisLayers = useQuery({
    queryKey: ['gis-layers', projectPath],
    queryFn: api.listGisLayers,
    enabled: Boolean(projectPath),
  })

  const flowAccum = useQuery({
    queryKey: ['flow-accum', projectPath],
    queryFn: api.getFlowAccumInfo,
    enabled: Boolean(projectPath),
  })

  useEffect(() => {
    if (!mesh.demId && (gisLayers.data?.layers ?? []).some((l) => l.type === 'dem')) {
      const first = (gisLayers.data?.layers ?? []).find((l) => l.type === 'dem')
      if (first) patchMeshSettings({ demId: first.id })
    }
  }, [gisLayers.data?.layers, mesh.demId])

  // Only leave Results mode when results are truly gone (not while a period
  // snapshot is refetching — that briefly clears snapshot.data otherwise).
  useEffect(() => {
    if (!canShowResults && resultsSymbology) {
      setResultsSymbology(false)
    }
  }, [canShowResults, resultsSymbology])

  // Auto-enable Results colors while live rendering is painting.
  useEffect(() => {
    if (liveActive && liveSnapshot.data?.available) {
      setResultsSymbology(true)
    }
  }, [liveActive, liveSnapshot.data?.available])

  // Remap MapLibre when side / bottom panel size changes
  useEffect(() => {
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 80)
    return () => window.clearTimeout(t)
  }, [
    bottomHeight,
    bottomCollapsed,
    layersWidth,
    layersCollapsed,
    inspectorWidth,
    inspectorCollapsed,
  ])

  const clampPanelWidth = (w: number) =>
    Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, Math.round(w)))

  const clampBottomHeight = (h: number) => {
    const max = Math.min(BOTTOM_MAX_H, Math.max(BOTTOM_MIN_H, Math.floor(window.innerHeight * 0.75)))
    return Math.min(max, Math.max(BOTTOM_MIN_H, Math.round(h)))
  }

  const onPanelResizePointerDown = (
    side: 'layers' | 'inspector' | 'bottom',
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const startSize =
      side === 'layers' ? layersWidth : side === 'inspector' ? inspectorWidth : bottomHeight
    panelResizeRef.current = {
      side,
      startX: e.clientX,
      startY: e.clientY,
      startSize,
    }
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    document.body.style.cursor = side === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      const drag = panelResizeRef.current
      if (!drag) return
      if (drag.side === 'layers') {
        setLayersWidth(clampPanelWidth(drag.startSize + (ev.clientX - drag.startX)))
      } else if (drag.side === 'inspector') {
        setInspectorWidth(clampPanelWidth(drag.startSize - (ev.clientX - drag.startX)))
      } else {
        setBottomHeight(clampBottomHeight(drag.startSize - (ev.clientY - drag.startY)))
      }
    }
    const onUp = (ev: PointerEvent) => {
      panelResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try {
        target.releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      window.dispatchEvent(new Event('resize'))
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const requestDelete = (sel: NonNullable<Selection>) => {
    setDeleteTarget(sel)
    setCascadeLinks([])
    setForceCascade(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1">
        <aside
          className={cn(
            'relative flex shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-r border-border bg-elevated/40 p-3 scrollbar-none',
            layersCollapsed && 'w-0 overflow-hidden border-0 p-0',
          )}
          style={layersCollapsed ? undefined : { width: layersWidth }}
        >
          {!layersCollapsed && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize layers panel"
                title="Drag to resize"
                onPointerDown={(e) => onPanelResizePointerDown('layers', e)}
                className="absolute inset-y-0 right-0 z-40 w-1.5 cursor-col-resize touch-none hover:bg-accent-soft/40 active:bg-accent-soft/60"
              />
              <Panel title="Layers">
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted">
                      Map colors
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={!resultsSymbology ? 'primary' : 'outline'}
                        className="flex-1"
                        onClick={() => setResultsSymbology(false)}
                      >
                        Types
                      </Button>
                      <Button
                        size="sm"
                        variant={resultsSymbology ? 'primary' : 'outline'}
                        className="flex-1"
                        disabled={!canShowResults}
                        title={
                          canShowResults
                            ? 'Color by depth / flow / runoff'
                            : 'Run a simulation to enable results colors'
                        }
                        onClick={() => setResultsSymbology(true)}
                      >
                        Results
                      </Button>
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
                      Subcatchments
                    </span>
                    <Switch checked={showSubcatchments} onCheckedChange={setShowSubcatchments} />
                  </label>
                  <label
                    className="flex items-center justify-between gap-2"
                    title={
                      flowAccum.data?.available
                        ? 'HAND floodplain polygons (FEMA-style flow paths)'
                        : 'Run with DEM flow accumulation engine to generate'
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#67A9CF]" />
                      Floodplain
                    </span>
                    <Switch
                      checked={showFlowAccum}
                      onCheckedChange={setShowFlowAccum}
                      disabled={!flowAccum.data?.available}
                    />
                  </label>
                  {flowAccum.data?.available &&
                    flowAccum.data.polygon_count != null &&
                    flowAccum.data.polygon_count > 0 && (
                      <p className="ml-1 text-[10px] text-muted">
                        {`${flowAccum.data.polygon_count.toLocaleString()} flow-path polygon${
                          flowAccum.data.polygon_count === 1 ? '' : 's'
                        }${
                          flowAccum.data.hand_max != null
                            ? ` · HAND ≤ ${flowAccum.data.hand_max.toFixed(1)}`
                            : ''
                        }`}
                      </p>
                    )}
                  {!flowAccum.data?.available && (
                    <p className="ml-1 text-[11px] text-muted">
                      Settings → DEM flow accumulation, then Run
                    </p>
                  )}
                  {(twodInfo.data?.has_mesh || (isHybridEngine && hasHybridResults)) && (
                    <>
                      <div className="border-t border-border pt-2 text-[11px] uppercase tracking-wide text-muted">
                        2D surface{isHybridEngine ? ' (hybrid)' : ''}
                      </div>
                      <label
                        className="flex items-center justify-between gap-2"
                        title="Triangle mesh outlines"
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm border border-slate-400 bg-slate-300/40" />
                          2D mesh
                        </span>
                        <Switch checked={show2dMesh} onCheckedChange={setShow2dMesh} />
                      </label>
                      {(twodInfo.data?.mesh_file || isHybridEngine) && (
                        <p
                          className="truncate text-[10px] text-muted"
                          title={
                            isHybridEngine
                              ? 'hybrid/results.npz'
                              : (twodInfo.data?.mesh_file ?? undefined)
                          }
                        >
                          {(isHybridEngine ? hybridMesh.isLoading : twodMesh.isLoading)
                            ? 'Loading mesh…'
                            : meshGeoJson || compactMeshWgs
                              ? `${triangleCount.toLocaleString()} triangles${
                                  largeMesh ? ' (WebGL)' : ''
                                }`
                              : (isHybridEngine ? hybridMesh.isError : twodMesh.isError)
                                ? 'Mesh failed to load'
                                : isHybridEngine
                                  ? 'Hybrid grid'
                                  : 'Mesh file linked'}
                        </p>
                      )}
                      {largeMesh && show2dMesh && (meshGeoJson || compactMeshWgs) && (
                        <p className="ml-1 text-[10px] text-muted">
                          Zoom ≥ {MESH_WIREFRAME_MIN_ZOOM} to show cell outlines
                        </p>
                      )}
                      <label
                        className="flex items-center justify-between gap-2"
                        title={
                          !(hasTwoDResults || liveActive)
                            ? 'Run a simulation to enable 2D depth'
                            : !resultsSymbology
                              ? 'Switch to Results colors to show 2D depth'
                              : 'Flood depth colors (mesh outlines optional)'
                        }
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
                          2D depth
                        </span>
                        <Switch
                          checked={show2dDepth}
                          onCheckedChange={setShow2dDepth}
                          disabled={!(hasTwoDResults || liveActive) || !resultsSymbology}
                        />
                      </label>
                      {!hasTwoDResults && (
                        <p className="ml-1 text-[11px] text-muted">
                          {isHybridEngine
                            ? 'No hybrid results yet — Run with PySWMM + Basilisk'
                            : 'No *.2d.h5 yet — run with REPORT_2D YES'}
                        </p>
                      )}
                      {hasTwoDResults && !resultsSymbology && (
                        <p className="ml-1 text-[11px] text-muted">
                          Enable Results colors to show 2D depth
                        </p>
                      )}
                      {hasTwoDResults &&
                        resultsSymbology &&
                        (largeMesh ? twodBinary.isError : twodSnapshot.isError) && (
                        <p className="ml-1 text-[11px] text-danger">
                          2D depth failed:{' '}
                          {(largeMesh
                            ? twodBinary.error
                            : (twodSnapshot.error as Error)
                          )?.message}
                        </p>
                      )}
                      {hasTwoDResults &&
                        resultsSymbology &&
                        show2dDepth &&
                        (largeMesh
                          ? twodBinary.isLoading && !twodBinary.data
                          : twodSnapshot.isLoading && !twodSnapshot.data) && (
                        <p className="ml-1 text-[11px] text-muted">Loading 2D depth…</p>
                      )}
                      {!isHybridEngine && (
                        <>
                          <label
                            className="flex items-center justify-between gap-2"
                            title="Open mesh edges and their hydraulic boundary conditions"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="h-0.5 w-3 rounded-full bg-fuchsia-400" />
                              2D boundaries
                            </span>
                            <Switch
                              checked={show2dBoundaries}
                              onCheckedChange={(v) => {
                                setShow2dBoundaries(v)
                                if (!v) setSelectedBoundaryId(null)
                              }}
                            />
                          </label>
                          {show2dBoundaries && (
                            <p className="ml-1 text-[10px] text-muted">
                              {twodBoundaries.isLoading
                                ? 'Loading edges…'
                                : twodBoundaries.isError
                                  ? (twodBoundaries.error as Error).message
                                  : `${(twodBoundaries.data?.count ?? twodInfo.data?.boundary_edge_count ?? 0).toLocaleString()} open edges — click an edge to edit in the inspector`}
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                  <label className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-0.5 w-3 rounded-full bg-blue-600" />
                      Links
                    </span>
                    <Switch checked={showLinks} onCheckedChange={setShowLinks} />
                  </label>
                  {showLinks && (
                    <div className="ml-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                      {LINK_KIND_OPTIONS.map(({ kind, label, color }) => (
                        <button
                          key={kind}
                          type="button"
                          title={`${visibleLinkKinds[kind] ? 'Hide' : 'Show'} ${label}`}
                          onClick={() => toggleLinkKind(kind)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-surface/80',
                            visibleLinkKinds[kind] ? 'text-fg-soft' : 'text-muted opacity-45',
                          )}
                        >
                          <span
                            className={cn(
                              'h-0.5 w-2.5 rounded-full',
                              !visibleLinkKinds[kind] && 'opacity-50',
                            )}
                            style={{ backgroundColor: color }}
                          />
                          <span className={cn(!visibleLinkKinds[kind] && 'line-through')}>
                            {label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {showLinks && resultsSymbology && (
                    <p className="ml-1 text-[10px] text-muted">
                      Flow colors: sky (low) → blue → cyan → green → yellow → red (peak); thicker = higher flow
                    </p>
                  )}
                  <div className="border-t border-border pt-2 text-[11px] uppercase tracking-wide text-muted">
                    Nodes
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-blue-600 ring-1 ring-black/80" />
                      Junctions
                    </span>
                    <Switch checked={showJunctions} onCheckedChange={setShowJunctions} />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-red-500 drop-shadow-[0_0_0_1px_#000]"
                        aria-hidden
                      />
                      Outfalls
                    </span>
                    <Switch checked={showOutfalls} onCheckedChange={setShowOutfalls} />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-[1px] bg-amber-600 ring-2 ring-slate-950" />
                      Storage
                    </span>
                    <Switch checked={showStorage} onCheckedChange={setShowStorage} />
                  </label>
                </div>
              </Panel>

              <Panel title="Basemap">
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={basemap === 'osm' ? 'primary' : 'outline'}
                    onClick={() => setBasemap('osm')}
                  >
                    OSM
                  </Button>
                  <Button
                    size="sm"
                    variant={basemap === 'hybrid' ? 'primary' : 'outline'}
                    onClick={() => setBasemap('hybrid')}
                  >
                    Satellite
                  </Button>
                  <Button
                    size="sm"
                    variant={basemap === 'projected' ? 'primary' : 'outline'}
                    onClick={() => setBasemap('projected')}
                  >
                    Grid
                  </Button>
                </div>
              </Panel>

              <BackgroundLayersPanel
                projectPath={projectPath}
                projectCrs={projectCrs}
                onProjectCrsApplied={() => setFitExtentNonce((n) => n + 1)}
                onZoomToLayer={(layer) => {
                  const b = layer.bounds
                  if (!b) {
                    toast({
                      title: 'No bounds',
                      description: `${layer.name} has no extent to zoom to`,
                      tone: 'danger',
                    })
                    return
                  }
                  setFitWgsBoundsRequest({
                    nonce: Date.now(),
                    west: b.west,
                    south: b.south,
                    east: b.east,
                    north: b.north,
                  })
                }}
              />

              <Panel
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Settings2 className="h-3.5 w-3.5" /> 2D meshing
                  </span>
                }
              >
                <p className="text-[11px] text-muted">
                  Draw an AOI with the grid tool, then open Settings to set cell size / DEM and
                  Preview or Apply.
                </p>
                {meshAoiPolygon ? (
                  <p className="mt-2 text-[11px] text-fg-soft">
                    AOI ready ({meshAoiPolygon.length} verts).
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-muted">No AOI drawn yet.</p>
                )}
                <Link
                  to="/settings"
                  className="mt-2 inline-flex text-xs text-accent-soft underline-offset-2 hover:underline"
                >
                  Open Settings
                </Link>
                {(meshPreview || meshAoiPolygon || meshAoiDraft.length > 0) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() => clearMeshAoi()}
                  >
                    Clear preview / AOI
                  </Button>
                )}
              </Panel>
            </>
          )}
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
          <div className="relative min-h-[18%] flex-1 overflow-hidden">
            {network.isLoading && (
              <p className="absolute left-3 top-3 z-20 rounded-lg border border-border bg-elevated/90 px-2 py-1 text-xs text-muted">
                Loading network…
              </p>
            )}
            {network.isError && (
              <p className="absolute left-3 top-3 z-20 rounded-lg border border-danger/40 bg-elevated/90 px-2 py-1 text-xs text-danger">
                {(network.error as Error).message}
              </p>
            )}
            {showNetwork3D && (network.data?.counts?.links ?? 0) > 2000 && (
              <p className="absolute left-3 top-3 z-20 rounded-lg border border-amber-500/40 bg-elevated/90 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                Large network ({network.data?.counts?.links} links) — 3D may be slow.
              </p>
            )}
            {network.data && (
              <NetworkMap
                network={network.data}
                basemap={basemap}
                showSubcatchments={showSubcatchments}
                showLinks={showLinks}
                visibleLinkKinds={visibleLinkKinds}
                showJunctions={showJunctions}
                showOutfalls={showOutfalls}
                showStorage={showStorage}
                backgroundLayers={gisLayers.data?.layers ?? []}
                flowAccumOverlay={
                  flowAccum.data?.available
                    ? {
                        available: true,
                        pngUrl: flowAccum.data.png_url ?? '/api/gis/flow/accum.png',
                        geojsonUrl: flowAccum.data.geojson_url ?? null,
                        bounds: flowAccum.data.bounds,
                        revision: flowAccum.dataUpdatedAt,
                      }
                    : null
                }
                showFlowAccum={showFlowAccum}
                selection={selection}
                onSelect={(sel) => {
                  setSelection(sel)
                  if (sel) {
                    setSelectedBoundaryId(null)
                    setSelectedTriangleIndex(null)
                  }
                }}
                snapshot={displaySnapshot}
                resultsSymbology={resultsSymbology && canShowResults}
                symbologyExtents={symbology}
                meshGeoJson={meshGeoJson}
                compactMeshWgs={compactMeshWgs}
                show2dMesh={Boolean(
                  (twodInfo.data?.has_mesh || (isHybridEngine && hasHybridResults)) &&
                    show2dMesh,
                )}
                show2dDepth={show2dDepthActive}
                allowTrianglePick={Boolean(
                  (twodInfo.data?.has_mesh || (isHybridEngine && hasHybridResults)) &&
                    show2dMesh,
                )}
                boundaryGeoJson={show2dBoundaries ? boundaryGeoJson : null}
                show2dBoundaries={show2dBoundaries}
                selectedBoundaryId={selectedBoundaryId}
                onSelectBoundary={(id) => {
                  setSelectedBoundaryId(id)
                  if (id) {
                    setSelection(null)
                    setSelectedTriangleIndex(null)
                    setInspectorCollapsed(false)
                  }
                }}
                selectedTriangleIndex={selectedTriangleIndex}
                onSelectTriangle={(ti) => {
                  setSelectedTriangleIndex(ti)
                  if (ti != null) {
                    setSelection(null)
                    setSelectedBoundaryId(null)
                    setInspectorCollapsed(false)
                    setBottomCollapsed(false)
                  }
                }}
                twodSnapshot={displayTwodSnapshot}
                twodBinarySnapshot={displayTwodBinary}
                meshPreviewGeoJson={meshPreview?.geojson ?? null}
                meshAoiDraft={meshAoiDraft}
                onMeshAoiDraftChange={(pts) => patchMeshSettings({ aoiDraft: pts })}
                onMeshAoiComplete={(ring) => {
                  patchMeshSettings({
                    aoiPolygon: ring,
                    aoiDraft: [],
                    preview: null,
                  })
                  setDrawMode('select')
                }}
                profileNodeIds={profile.data?.path_node_ids}
                profileLinkIds={profile.data?.path_link_ids}
                profilePickMode={pickMode}
                showFlowAnim={showFlowAnim}
                showNetwork3D={showNetwork3D}
                onProfileNodePick={(id) => {
                  if (pickMode === 'start') {
                    setProfileStart(id)
                    setPickMode(profileEnd ? null : 'end')
                  } else if (pickMode === 'end') {
                    setProfileEnd(id)
                    setPickMode(null)
                  }
                }}
                onNodeDragEnd={(id, x, y) => moveNode.mutate({ id, x, y })}
                drawMode={drawMode}
                pendingLinkFromId={pendingLinkFromId}
                polygonDraft={polygonDraft}
                onCreateNode={(kind, x, y) =>
                  createNode.mutate({ node_kind: kind, x, y, elevation: 0, max_depth: 0 })
                }
                onCreateLink={(fromId, toId) => {
                  const length =
                    linkDrawKind === 'conduit' && network.data != null
                      ? gisConduitLength(network.data, fromId, toId)
                      : undefined
                  createLink.mutate({
                    link_kind: linkDrawKind,
                    from_node: fromId,
                    to_node: toId,
                    ...(length != null ? { length: Math.round(length * 1000) / 1000 } : {}),
                  })
                }}
                onLinkFromPicked={setPendingLinkFromId}
                onPolygonDraftChange={setPolygonDraft}
                onCreateSubcatchment={(ringWgs) => {
                  if (!network.data) return
                  const ring = ringWgs.map(([lng, lat]) =>
                    wgs84ToProject(lng, lat, network.data.crs),
                  )
                  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
                  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
                  const outlet =
                    (selection?.object_type === 'node' ? selection.id : null) ||
                    nearestNodeId(network.data, cx, cy)
                  if (!outlet) {
                    toast({
                      title: 'Need an outlet node',
                      description: 'Create or select a node first',
                      tone: 'danger',
                    })
                    return
                  }
                  createSub.mutate({ outlet, polygon: ring })
                }}
                onRequestDelete={requestDelete}
                projectKey={projectPath}
                visible={visible}
                fitExtentNonce={fitExtentNonce}
                fitWgsBoundsRequest={fitWgsBoundsRequest}
              />
            )}
            <MapToolbar
              mode={drawMode}
              onModeChange={(m) => {
                setDrawMode(m)
                setPendingLinkFromId(null)
                setPolygonDraft([])
                if (m === 'draw-mesh-aoi') {
                  clearMeshAoi()
                }
                if (m !== 'select') setPickMode(null)
              }}
              linkKind={linkDrawKind}
              onLinkKindChange={setLinkDrawKind}
              hint={drawHint(
                drawMode,
                pendingLinkFromId,
                drawMode === 'draw-mesh-aoi' ? meshAoiDraft.length : polygonDraft.length,
                linkDrawKind,
              )}
              onZoomExtent={() => setFitExtentNonce((n) => n + 1)}
              onUndo={() => void performUndo()}
              canUndo={undoStack.length > 0}
            />
            <MapLegend
              depthMax={symbology.depthMax}
              flowMax={symbology.flowMax}
              runoffMax={symbology.runoffMax}
              hasSnapshot={canShowResults && Boolean(displaySnapshot)}
              resultsSymbology={resultsSymbology && canShowResults}
              twodDepthMax={symbology.twodDepthMax}
              show2dDepth={show2dDepthActive}
              autoDepthMax={autoSymbology.depthMax}
              autoFlowMax={autoSymbology.flowMax}
              autoRunoffMax={autoSymbology.runoffMax}
              autoTwodDepthMax={autoSymbology.twodDepthMax}
              overrides={legendOverrides}
              onOverrideChange={(key, value) => {
                setLegendOverrides((prev) => {
                  const next = { ...prev }
                  if (value == null) delete next[key]
                  else next[key] = value
                  return next
                })
              }}
            />
            <div className="pointer-events-auto absolute left-0 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-0.5 rounded-r-lg border border-l-0 border-border bg-elevated/90 p-0.5">
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                disabled={!layersCollapsed && layersWidth >= LAYERS_WIDE_W}
                title={
                  layersCollapsed
                    ? 'Show layers panel'
                    : 'Make layers panel wider'
                }
                aria-label="Expand layers panel"
                onClick={() => {
                  if (layersCollapsed) {
                    setLayersCollapsed(false)
                    setLayersWidth((w) => (w < PANEL_MIN_W ? LAYERS_DEFAULT_W : w))
                  } else {
                    setLayersWidth(LAYERS_WIDE_W)
                  }
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                disabled={layersCollapsed}
                title={
                  layersWidth > LAYERS_DEFAULT_W + 8
                    ? 'Return to default width'
                    : 'Hide layers panel'
                }
                aria-label="Collapse layers panel"
                onClick={() => {
                  if (layersWidth > LAYERS_DEFAULT_W + 8) {
                    setLayersWidth(LAYERS_DEFAULT_W)
                  } else {
                    setLayersCollapsed(true)
                  }
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="pointer-events-auto absolute right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-0.5 rounded-l-lg border border-r-0 border-border bg-elevated/90 p-0.5">
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                disabled={!inspectorCollapsed && inspectorWidth >= INSPECTOR_WIDE_W}
                title={
                  inspectorCollapsed
                    ? 'Show inspector panel'
                    : 'Make inspector panel wider'
                }
                aria-label="Expand inspector panel"
                onClick={() => {
                  if (inspectorCollapsed) {
                    setInspectorCollapsed(false)
                    setInspectorWidth((w) =>
                      w < PANEL_MIN_W ? INSPECTOR_DEFAULT_W : w,
                    )
                  } else {
                    setInspectorWidth(INSPECTOR_WIDE_W)
                  }
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                disabled={inspectorCollapsed}
                title={
                  inspectorWidth > INSPECTOR_DEFAULT_W + 8
                    ? 'Return to default width'
                    : 'Hide inspector panel'
                }
                aria-label="Collapse inspector panel"
                onClick={() => {
                  if (inspectorWidth > INSPECTOR_DEFAULT_W + 8) {
                    setInspectorWidth(INSPECTOR_DEFAULT_W)
                  } else {
                    setInspectorCollapsed(true)
                  }
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

          </div>

          <div
            className={cn(
              'relative z-20 shrink-0',
              bottomCollapsed && 'h-0',
            )}
          >
            {/* Tab snapped to the panel's top border (same idea as left/right wall chevrons) */}
            <div className="pointer-events-auto absolute bottom-full left-1/2 z-30 flex -translate-x-1/2 gap-0.5 rounded-t-lg border border-b-0 border-border bg-elevated/90 p-0.5">
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                disabled={!bottomCollapsed && bottomHeight >= BOTTOM_TALL_H}
                title={
                  bottomCollapsed
                    ? 'Show time / profile panel'
                    : 'Make panel much taller'
                }
                aria-label="Expand bottom panel"
                onClick={() => {
                  if (bottomCollapsed) {
                    setBottomCollapsed(false)
                    setBottomHeight((h) =>
                      h < BOTTOM_MIN_H ? BOTTOM_DEFAULT_H : h,
                    )
                  } else {
                    setBottomHeight(BOTTOM_TALL_H)
                  }
                }}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1 text-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                disabled={bottomCollapsed}
                title={
                  bottomHeight > BOTTOM_DEFAULT_H + 8
                    ? 'Return to default height'
                    : 'Hide time / profile panel'
                }
                aria-label="Collapse bottom panel"
                onClick={() => {
                  if (bottomHeight > BOTTOM_DEFAULT_H + 8) {
                    setBottomHeight(BOTTOM_DEFAULT_H)
                  } else {
                    setBottomCollapsed(true)
                  }
                }}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            <div
              className={cn(
                'relative min-h-0 border-t border-border bg-elevated/80',
                bottomCollapsed
                  ? 'h-0 max-h-0 overflow-hidden border-0 p-0'
                  : 'overflow-y-auto overflow-x-hidden px-3 pb-3 pt-3 scrollbar-none',
              )}
              style={bottomCollapsed ? undefined : { height: bottomHeight }}
            >
              {!bottomCollapsed && (
                <>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize bottom panel"
                    title="Drag to resize"
                    onPointerDown={(e) => onPanelResizePointerDown('bottom', e)}
                    className="absolute inset-x-0 top-0 z-40 h-1.5 cursor-row-resize touch-none hover:bg-accent-soft/40 active:bg-accent-soft/60"
                  />
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="inline-flex items-center gap-2 text-xs text-fg-soft">
                        <Mountain className="h-3.5 w-3.5 text-muted" />
                        <span>Profile</span>
                        <Switch checked={showProfile} onCheckedChange={setShowProfile} />
                      </label>
                      <label
                        className="inline-flex items-center gap-2 text-xs text-fg-soft"
                        title="Show 3D pipes and water levels on the map"
                      >
                        <Box className="h-3.5 w-3.5 text-muted" />
                        <span>3D</span>
                        <Switch checked={showNetwork3D} onCheckedChange={setShowNetwork3D} />
                      </label>
                      <label
                        className="inline-flex items-center gap-2 text-xs text-fg-soft"
                        title="Animate flow along pipes (direction follows results when available)"
                      >
                        <Waves className="h-3.5 w-3.5 text-muted" />
                        <span>Flow</span>
                        <Switch checked={showFlowAnim} onCheckedChange={setShowFlowAnim} />
                      </label>
                    </div>
                    {liveActive ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-accent-soft">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                        Live · {liveSnapshot.data?.time ?? 'waiting for solver…'}
                      </span>
                    ) : (
                      <span className="hidden text-[11px] text-muted sm:inline">
                        Pick start/end on the map, then scrub time or Peak for water and HGL.
                      </span>
                    )}
                  </div>
                  {periods.isError && (
                    <p className="mb-2 text-xs text-danger">
                      Could not load results: {(periods.error as Error).message}
                    </p>
                  )}
                  {project.data?.has_out && periods.isLoading && (
                    <p className="mb-2 text-xs text-muted">Loading existing results…</p>
                  )}
                  {liveActive && !hasResultPeriods ? (
                    <div className="rounded-lg border border-border bg-surface/60 px-3 py-2 text-xs text-muted">
                      Live rendering active — file time scrubbing unlocks when the run finishes.
                      {liveSnapshot.data?.available
                        ? ` Showing solver state at ${liveSnapshot.data.time ?? '…'}.`
                        : ' Waiting for first live frame…'}
                    </div>
                  ) : (
                    <TimeSlider
                      period={period}
                      periodCount={scrubberPeriodCount}
                      timeLabel={timeLabel}
                      onChange={setPeriod}
                      disabled={liveActive}
                      hasExistingOut={Boolean(
                        project.data?.has_out || hasHybridResults,
                      )}
                      peakPeriod={periods.data?.peak_depth_period ?? null}
                      peakTime={periods.data?.peak_time ?? null}
                      peakDepthMax={
                        periods.data?.peak_depth_max ??
                        autoSymbology.twodDepthMax ??
                        null
                      }
                      showAllPeaks={showAllPeaks}
                      onShowAllPeaksChange={setShowAllPeaks}
                      playing={playing}
                      onPlayingChange={setPlaying}
                      playIntervalMs={450}
                      sonifyAvailable={Boolean(
                        showProfile &&
                          profileNodeIds.length > 0 &&
                          project.data?.has_out,
                      )}
                      sonifyPlaying={sonifyPlaying}
                      sonifyLabel={
                        profileNodeIds.length
                          ? `${profileNodeIds.length} junctions`
                          : null
                      }
                      onSonifyToggle={showProfile ? () => void toggleSonify() : undefined}
                    />
                  )}
                  {showProfile && (
                    <div className="mt-3">
                      <ProfileViewer
                        embedded
                        profile={profile.data}
                        start={profileStart}
                        end={profileEnd}
                        onStartChange={setProfileStart}
                        onEndChange={setProfileEnd}
                        pickMode={pickMode}
                        onPickMode={setPickMode}
                        loading={profile.isFetching}
                        error={profile.isError ? (profile.error as Error).message : null}
                        timeLabel={
                          periods.data && periods.data.period_count > 0 ? timeLabel : null
                        }
                        onSelect={setSelection}
                      />
                    </div>
                  )}
                  {selectedTriangleIndex != null && (
                    <div className="mt-2">
                      <TimeSeriesChart
                        series={triangleSeries.series.data}
                        yLabel={triangleSeries.yLabel}
                        variables={triangleSeries.variables}
                        variable={triangleSeries.variable}
                        onVariableChange={triangleSeries.setVariable}
                      />
                    </div>
                  )}
                  {selection && (
                    <div className="mt-2">
                      <TimeSeriesChart
                        series={objectSeries.series.data}
                        yLabel={objectSeries.yLabel}
                        variables={objectSeries.variables}
                        variable={objectSeries.variable}
                        onVariableChange={objectSeries.setVariable}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </main>

        <aside
          className={cn(
            'relative flex shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-l border-border bg-elevated/30 p-3 scrollbar-none',
            inspectorCollapsed && 'w-0 overflow-hidden border-0 p-0',
          )}
          style={inspectorCollapsed ? undefined : { width: inspectorWidth }}
        >
          {!inspectorCollapsed && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize inspector panel"
                title="Drag to resize"
                onPointerDown={(e) => onPanelResizePointerDown('inspector', e)}
                className="absolute inset-y-0 left-0 z-40 w-1.5 cursor-col-resize touch-none hover:bg-accent-soft/40 active:bg-accent-soft/60"
              />
              {selectedBoundaryFeature ? (
                <BoundaryInspector
                  feature={selectedBoundaryFeature}
                  bcTypes={twodBoundaries.data?.bc_types}
                  bcDraftType={bcDraftType}
                  bcDraftParam1={bcDraftParam1}
                  onTypeChange={setBcDraftType}
                  onParam1Change={setBcDraftParam1}
                  saving={saveBoundaries.isPending}
                  onClear={() => setSelectedBoundaryId(null)}
                  onSave={() => {
                    if (!boundaryGeoJson) return
                    const items: TwoDBoundaryItem[] = boundaryGeoJson.features.map((f) => {
                      const p = f.properties ?? {}
                      const id = String(p.id ?? '')
                      const isSel = id === selectedBoundaryId
                      return {
                        triangle_index: Number(p.triangle_index),
                        edge: Number(p.edge),
                        bc_type: isSel ? bcDraftType : String(p.bc_type ?? 'WALL'),
                        param1: isSel
                          ? bcDraftParam1 === ''
                            ? null
                            : Number(bcDraftParam1)
                          : p.param1 != null
                            ? Number(p.param1)
                            : null,
                        param2: p.param2 != null ? String(p.param2) : null,
                        group: p.group != null ? String(p.group) : null,
                      }
                    })
                    saveBoundaries.mutate(items)
                  }}
                />
              ) : selectedTriangleIndex != null ? (
                <TriangleInspector
                  triangleIndex={selectedTriangleIndex}
                  manningsN={faceInfoQ.data?.mannings_n}
                  zMin={faceInfoQ.data?.z_min}
                  zMax={faceInfoQ.data?.z_max}
                  zMean={faceInfoQ.data?.z_mean}
                  area={faceInfoQ.data?.area}
                  coupledNode={faceInfoQ.data?.coupled_node}
                  cd={faceInfoQ.data?.cd}
                  couplingArea={faceInfoQ.data?.coupling_area}
                  currentDepth={triangleCurrentDepth}
                  depthUnit={
                    displayTwodBinary?.unit ?? displayTwodSnapshot?.unit ?? 'm'
                  }
                  loading={faceInfoQ.isLoading}
                  onClear={() => setSelectedTriangleIndex(null)}
                />
              ) : (
                <ObjectInspector
                  selection={selection}
                  onSaved={invalidateNetwork}
                  onDeleteRequest={requestDelete}
                />
              )}
              {!runStatus || runStatus.status === 'idle' ? (
                <p className="px-1 text-xs text-muted">
                  <Play className="mr-1 inline h-3 w-3" />
                  Use the header Run control after setting window / steps in Settings.
                </p>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setCascadeLinks([])
            setForceCascade(false)
          }
        }}
        title={forceCascade ? 'Delete node and connected links?' : 'Delete object?'}
        description={
          deleteTarget ? (
            forceCascade ? (
              <>
                <span className="block">
                  {deleteTarget.id} is connected to {cascadeLinks.length} link(s):{' '}
                  {cascadeLinks.slice(0, 8).join(', ')}
                  {cascadeLinks.length > 8 ? '…' : ''}.
                </span>
                <span className="mt-2 block">This will remove the node and those links from the INP.</span>
              </>
            ) : (
              `Permanently remove ${deleteTarget.object_type} “${deleteTarget.id}” from the INP.`
            )
          ) : (
            ''
          )
        }
        confirmLabel={forceCascade ? 'Delete all' : 'Delete'}
        confirming={deleteObject.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          const sel = deleteTarget
          const cascade = forceCascade
          void (async () => {
            let cached = queryClient.getQueryData<ModelObjectResponse>([
              'object',
              sel.object_type,
              sel.id,
            ])
            if (!cached) {
              try {
                cached = await api.getObject(sel.object_type, sel.id)
              } catch {
                cached = undefined
              }
            }
            const undoSnapshot = cached ? snapshotForRecreate(cached) : null
            deleteObject.mutate({ sel, cascade, undoSnapshot })
          })()
        }}
      />
    </div>
  )
}
