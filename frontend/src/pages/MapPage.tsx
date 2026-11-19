import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  Box,
  PanelLeft,
  Pin as PinIcon,
  PinOff,
  X as XIcon,
  ExternalLink,
  Clock,
  ChartLine,
  Mountain,
  Play,
  Settings2,
  Waves,
  ArrowDownToLine,
  ArrowUpFromLine,
  Circle,
  Copy,
  Hexagon,
  Info,
  Maximize2,
  Spline,
  Trash2,
  Triangle,
  Undo2,
  ZoomIn,
  ArrowLeftRight,
  Merge,
  Ruler,
  Scissors,
  TrendingDown,
  Pin,
  LineChart as LineChartIcon,
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
  type ThematicStyle,
} from '../components/map/NetworkMap'
import { MapToolbar, type DrawMode, type LinkDrawKind } from '../components/map/MapToolbar'
import { MapLegend } from '../components/map/MapLegend'
import { RunSummaryCard } from '../components/RunSummaryCard'
import { subscribeMapFocus, takeMapFocus } from '../lib/mapFocus'
import { FindObject } from '../components/map/FindObject'
import { ReviewPanel } from '../components/map/ReviewPanel'
import { ElementChart, PinnedChart } from '../components/results/PinnedChart'
import { FloatingWindow } from '../components/FloatingWindow'
import { getPref, setPref, usePref } from '../lib/prefs'
import { useT } from '../lib/i18n'
import { recordMap, type MapRecording } from '../lib/mapRecorder'
import { refreshAfterEdit, useEditHistory } from '../components/UndoRedo'
import { MultiInspector } from '../components/inspector/MultiInspector'
import { MapContextMenu, type MenuItem } from '../components/map/MapContextMenu'
import { buildGraph, routeToOutfall, topOfBranch, trace } from '../lib/networkTrace'
import { IS_VIEWER } from '../lib/mode'
import { GettingStarted } from '../components/map/GettingStarted'
import { ProjectCrsControls } from '../components/ProjectCrsControls'
import { BackgroundLayersPanel } from '../components/map/BackgroundLayersPanel'
import { ObjectInspector } from '../components/inspector/ObjectInspector'
import { BoundaryInspector } from '../components/inspector/BoundaryInspector'
import { TriangleInspector } from '../components/inspector/TriangleInspector'
import { TimeSlider } from '../components/results/TimeSlider'
import { TimeSeriesChart } from '../components/TimeSeriesChart'
import { ProfileViewer } from '../components/profile/ProfileViewer'
import { InputDataPanel } from '../components/results/InputDataPanel'

type DockTab = 'profile' | 'charts' | 'series' | 'curves'
import { useRunStatus } from '../hooks/useRunStatus'
import { useObjectSeries } from '../hooks/useObjectSeries'
import { useTriangleSeries } from '../hooks/useTriangleSeries'
import { useResultsPlayback } from '../hooks/useResultsPlayback'
import { AlertDialog, Button, Dialog, DialogContent, Panel, Switch, useToast } from '../components/ui'
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
const INSPECTOR_DEFAULT_W = 320
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
  const t = useT()
  const [basemap, setBasemap] = useState<BasemapMode>('osm')
  const [customTiles, setCustomTiles] = useState(() => getPref('custom-tiles-url'))
  const customTilesUrl = usePref('custom-tiles-url')
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
  // Map first: on smaller screens the layers panel starts hidden.
  const [layersCollapsed, setLayersCollapsed] = useState(() => getPref('contents-open') !== '1')
  const inspectorPinned = usePref('inspector-pinned') === '1'
  type MapWindow = { key: string; kind: 'profile' | 'chart'; target?: NonNullable<Selection> }
  const [windows, setWindows] = useState<MapWindow[]>([])
  const [topWindow, setTopWindow] = useState<string | null>(null)
  const openWindow = (w: MapWindow) =>
    setWindows((l) => (l.some((x) => x.key === w.key) ? l : [...l, w].slice(-4)))
  const closeWindow = (key: string) => setWindows((l) => l.filter((x) => x.key !== key))
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_W)
  // The inspector opens when something is selected (see effect below).
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_DEFAULT_H)
  const [bottomCollapsed, setBottomCollapsed] = useState(false)
  const dockTabPref = usePref('dock-tab', 'profile')
  const [inputsOpen, setInputsOpen] = useState(false)
  const panelResizeRef = useRef<{
    side: 'layers' | 'inspector' | 'bottom'
    startX: number
    startY: number
    startSize: number
  } | null>(null)
  /** Types = icons / link-kind colors; Results = depth/flow/runoff symbology */
  const [resultsSymbology, setResultsSymbology] = useState(false)
  type MapMode = 'edit' | 'results' | 'review'
  const [mapMode, setMapModeState] = useState<MapMode>(() =>
    IS_VIEWER ? 'results' : ((['edit', 'results', 'review'].includes(getPref('map-mode')) ? getPref('map-mode') : 'edit') as MapMode),
  )
  const canShowResultsRef = useRef(false)
  const [thematic, setThematic] = useState<(ThematicStyle & { legend: { label: string; color: string }[]; title: string }) | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  /** Everything selected (Shift/Ctrl-click, box select); includes `selection`. */
  const [multiSel, setMultiSel] = useState<NonNullable<Selection>[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ target: Selection; lngLat: [number, number]; xy: [number, number]; point: { x: number; y: number } } | null>(null)
  const [bulkDeleteItems, setBulkDeleteItems] = useState<NonNullable<Selection>[] | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [pinned, setPinned] = useState<NonNullable<Selection>[]>([])
  const [crsPromptDismissed, setCrsPromptDismissed] = useState(false)
  const [crsDialogOpen, setCrsDialogOpen] = useState(false)
  const [profileStart, setProfileStart] = useState('')
  const [profileVia, setProfileVia] = useState<string[]>([])
  const [profileEnd, setProfileEnd] = useState('')
  const [pickMode, setPickMode] = useState<'start' | 'end' | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showFlowAnim, setShowFlowAnim] = useState(false)
  const [showNetwork3D, setShowNetwork3D] = useState(false)
  const [ve3d, setVe3d] = useState<number | null>(null)
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
  const editHistory = useEditHistory()
  const sameSel = (a: Selection, b: Selection) => Boolean(a && b && a.object_type === b.object_type && a.id === b.id)
  // Single selections made anywhere (search, tables, check) reset the multi-selection.
  useEffect(() => {
    setMultiSel((m) => (!selection ? (m.length > 1 ? m : []) : m.some((x) => sameSel(x, selection)) ? m : [selection]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])
  const setMapMode = (m: MapMode) => {
    setMapModeState(m)
    if (!IS_VIEWER) setPref('map-mode', m)
    if (m !== 'edit') setDrawMode('select')
    if (m !== 'review') setThematic(null)
    setResultsSymbology(m === 'results' && canShowResultsRef.current)
    if (m === 'results') setBottomCollapsed(false)
  }
  const recordingRef = useRef<MapRecording | null>(null)
  const [recording, setRecording] = useState(false)
  const startRecording = () => {
    const r = recordMap()
    if (!r) {
      toast({ title: 'This browser can’t record the map', description: 'Try a current Chrome, Edge or Firefox.', tone: 'danger' })
      return
    }
    recordingRef.current = r
    setRecording(true)
    setShowAllPeaks(false)
    setPeriod(0)
    window.setTimeout(() => setPlaying(true), 400)
  }
  const stopRecording = async () => {
    const r = recordingRef.current
    recordingRef.current = null
    setRecording(false)
    setPlaying(false)
    const blob = r ? await r.stop() : null
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(project.data?.inp_name ?? 'model').replace(/\.inp$/i, '')}-results.webm`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    toast({ title: 'Saved the animation', description: `${a.download} (WebM video)`, tone: 'success' })
  }
  const recordPlayedRef = useRef(false)
  const stopRecordingRef = useRef(stopRecording)
  stopRecordingRef.current = stopRecording
  const setMapModeRef = useRef(setMapMode)
  setMapModeRef.current = setMapMode
  useEffect(() => {
    const on = (e: Event) => setMapModeRef.current((e as CustomEvent).detail as MapMode)
    window.addEventListener('saturday-swmm-map-mode', on)
    return () => window.removeEventListener('saturday-swmm-map-mode', on)
  }, [])
  const selectItems = (items: NonNullable<Selection>[]) => {
    setMultiSel(items)
    setSelection(items.length ? items[items.length - 1] : null)
  }
  const { data: runStatus } = useRunStatus()
  const scenarioList = useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios, retry: false })
  const [everSelected, setEverSelected] = useState(false)
  const viewerRuns = useQuery({ queryKey: ['runs-archive'], queryFn: api.listRuns, enabled: IS_VIEWER })
  const prevRunStatus = useRef<string | undefined>(undefined)
  const jumpToPeakRef = useRef(false)
  // Set when new results arrive; applied once their periods have loaded.
  const wantResultsColoursRef = useRef(false)
  useEffect(() => {
    const now = runStatus?.status
    if (prevRunStatus.current === 'running' && now === 'completed') {
      // Results are what you want to see the moment a run ends.
      wantResultsColoursRef.current = true
      setSummaryOpen(true)
      jumpToPeakRef.current = true
    }
    prevRunStatus.current = now
  }, [runStatus?.status])
  // Viewer: newly loaded results get the same treatment as a finished run.
  const prevOut = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!IS_VIEWER) return
    const out = runStatus?.status === 'completed' ? runStatus.out_path ?? null : null
    if (out && out !== prevOut.current) {
      wantResultsColoursRef.current = true
      setSummaryOpen(true)
      jumpToPeakRef.current = true
    }
    prevOut.current = out
  }, [runStatus?.status, runStatus?.out_path])
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
  const crsUnconfirmed = project.data?.crs_confirmed === false

  // A model with no chosen coordinate system would land somewhere random on a
  // world basemap; show it on the plain grid until the user picks one.
  useEffect(() => {
    if (crsUnconfirmed) setBasemap('projected')
  }, [crsUnconfirmed, projectPath])

  useEffect(() => {
    setCrsPromptDismissed(false)
    setSummaryOpen(false)
  }, [projectPath])

  const [zoomNonce, setZoomNonce] = useState(0)
  // Selections requested from other pages (e.g. a results table row).
  useEffect(() => {
    const apply = () => {
      const t = takeMapFocus()
      if (t) {
        setMultiSel([t])
        setSelection(t)
        setZoomNonce((n) => n + 1)
      }
    }
    apply()
    return subscribeMapFocus(apply)
  }, [])

  // The inspector opens on selection and gets out of the way otherwise.
  const hasSelection = Boolean(selection) || multiSel.length > 1 || selectedTriangleIndex != null || Boolean(selectedBoundaryId)
  useEffect(() => {
    if (selection) setEverSelected(true)
    setInspectorCollapsed(!hasSelection && !inspectorPinned)
  }, [hasSelection, selection, inspectorPinned])

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

  const twodInfo = useQuery({
    queryKey: ['2d-info', projectPath, project.data?.inp_path, runStatus?.status],
    queryFn: api.getTwoDInfo,
    enabled: Boolean(project.data),
    retry: false,
  })

  const twodMesh = useQuery({
    queryKey: ['2d-mesh', projectPath, project.data?.inp_path, projectCrs],
    queryFn: () => api.getTwoDMesh(projectCrs),
    enabled: Boolean(twodInfo.data?.has_mesh),
    retry: false,
    staleTime: 60_000,
  })

  const activeMesh = twodMesh.data
  const hasTwoDResults = Boolean(twodInfo.data?.has_results)

  const triangleCount = activeMesh?.counts?.triangles ?? twodInfo.data?.triangle_count ?? 0

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
    meshSource: 'openswmm',
  })

  // A recording ends when playback reaches the last time step.
  useEffect(() => {
    if (!recording) {
      recordPlayedRef.current = false
      return
    }
    if (playing) recordPlayedRef.current = true
    else if (recordPlayedRef.current) void stopRecordingRef.current()
  }, [playing, recording])

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
    queryKey: ['profile', profileStart, profileEnd, profileVia.join(','), queryPeriod, snapshot.data?.period],
    queryFn: () =>
      api.getProfile(
        profileStart,
        profileEnd,
        periods.data && periods.data.period_count > 0 ? queryPeriod : undefined,
        profileVia,
      ),
    enabled: Boolean(profileStart && profileEnd),
    retry: false,
    // Keep drawing the last time step while the next one loads: without this
    // the profile blanks on every frame during playback (flicker).
    placeholderData: (prev, prevQuery) =>
      prevQuery && prevQuery.queryKey[1] === profileStart && prevQuery.queryKey[2] === profileEnd && prevQuery.queryKey[3] === profileVia.join(',')
        ? prev
        : undefined,
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
    onSuccess: (obj, vars) => {
      queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
        prev ? updateNodeCoordsInNetwork(prev, vars.id, vars.x, vars.y) : prev,
      )
      if (obj.geometry) applyObjectToCache(obj)
      void queryClient.invalidateQueries({ queryKey: ['object'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
    },
  })

  const createNode = useMutation({
    mutationFn: api.createNode,
    onSuccess: (obj) => {
      applyObjectToCache(obj)
      setSelection({ object_type: 'node', id: obj.id })
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
    onSuccess: (res) => {
      queryClient.setQueryData<ModelNetwork>(networkKey, (prev) =>
        prev
          ? removeNetworkObject(prev, res.object_type, res.id, res.cascaded_link_ids)
          : prev,
      )
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


  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // The map stays mounted behind other pages; only react while it is shown.
      if (!visible) return
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
      const typingInField =
        ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement || ev.target instanceof HTMLSelectElement
      if (!typingInField && (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'a' && network.data) {
        ev.preventDefault()
        // Ctrl+A: every node and link; Ctrl+Shift+A: everything of the selected kind.
        const kind = ev.shiftKey ? selection?.object_type : null
        selectItems(
          network.data.geojson.features
            .map((f) => f.properties ?? {})
            .filter((p) => (kind ? p.object_type === kind : p.object_type === 'node' || p.object_type === 'link'))
            .map((p) => ({ object_type: p.object_type, id: String(p.id) }) as NonNullable<Selection>),
        )
        return
      }
      if (!typingInField && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'c' && (multiSel.length || selection) && !window.getSelection()?.toString()) {
        const items = multiSel.length ? multiSel : [selection!]
        void navigator.clipboard?.writeText(items.map((i) => i.id).join('\n'))
        toast({ title: items.length > 1 ? `Copied ${items.length} IDs` : `Copied ${items[0].id}`, tone: 'success' })
        return
      }
      if (ev.key === 'Escape' && drawMode === 'select' && !typingInField && (multiSel.length || selection)) {
        selectItems([])
      }
      if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        multiSel.length > 1 &&
        drawMode === 'select' &&
        !IS_VIEWER &&
        !typingInField
      ) {
        ev.preventDefault()
        setBulkDeleteItems(multiSel)
        return
      }
      if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selection &&
        !IS_VIEWER &&
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
  }, [visible, selection, multiSel, drawMode, meshAoiDraft, network.data])

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

  canShowResultsRef.current = canShowResults
  // Only leave Results mode when results are truly gone (not while a period
  // snapshot is refetching — that briefly clears snapshot.data otherwise).
  useEffect(() => {
    if (canShowResults && wantResultsColoursRef.current) {
      wantResultsColoursRef.current = false
      setResultsSymbology(true)
      setMapModeState('results')
      setThematic(null)
      return
    }
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
    mapMode,
    showProfile,
    pinned.length,
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

  // After a run, show the moment of peak depth rather than the first time step.
  useEffect(() => {
    const peak = periods.data?.peak_depth_period
    if (jumpToPeakRef.current && peak != null && peak >= 0) {
      jumpToPeakRef.current = false
      setPeriod(peak)
    }
  }, [periods.data?.peak_depth_period, setPeriod])

  const bulkDelete = useMutation({
    mutationFn: (items: NonNullable<Selection>[]) => api.bulkDelete(items, true),
    onSuccess: (r) => {
      setBulkDeleteItems(null)
      selectItems([])
      refreshAfterEdit(queryClient)
      const extra = r.cascaded_link_ids.length ? ` and ${r.cascaded_link_ids.length} connected links` : ''
      toast({
        title: `Deleted ${r.deleted.length} objects${extra}`,
        description: r.errors.length ? `${r.errors.length} couldn’t be deleted: ${r.errors[0].detail}` : 'Ctrl+Z to undo.',
        tone: r.errors.length ? 'default' : 'success',
      })
    },
    onError: (e: Error) => toast({ title: 'Delete failed', description: e.message, tone: 'danger' }),
  })

  const graph = useMemo(() => (network.data ? buildGraph(network.data) : null), [network.data])
  const nodeIdList = useMemo(
    () => (network.data?.geojson.features ?? []).filter((f) => f.properties?.object_type === 'node').map((f) => String(f.properties?.id)),
    [network.data],
  )
  const showProfileBetween = (start: string, end: string) => {
    // Room for the drawing: about half the window for the bottom panel.
    setBottomHeight((h) => Math.max(h, Math.min(560, Math.round(window.innerHeight * 0.5))))
    setProfileVia([])
    setProfileStart(start)
    setProfileEnd(end)
    setShowProfile(true)
    setBottomCollapsed(false)
    setPickMode(null)
  }
  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text)
    toast({ title: `Copied ${what}`, tone: 'success' })
  }

  const runTool = async (tool: Parameters<typeof api.networkTool>[0], body: Record<string, unknown>, done: (r: Record<string, unknown>) => string) => {
    try {
      const r = await api.networkTool(tool, body)
      refreshAfterEdit(queryClient)
      toast({ title: done(r), description: 'Ctrl+Z undoes it.', tone: 'success' })
      return r
    } catch (e) {
      toast({ title: 'That didn’t work', description: (e as Error).message, tone: 'danger' })
      return null
    }
  }

  const contextItems = (): MenuItem[] => {
    if (!ctxMenu) return []
    const t = ctxMenu.target
    const items: MenuItem[] = []
    const inMulti = t && multiSel.length > 1 && multiSel.some((x) => sameSel(x, t))
    const zoomTo = (sel: NonNullable<Selection>) => {
      setSelection(sel)
      setZoomNonce((n) => n + 1)
    }
    const traceSelect = (node: string, dir: 'up' | 'down') => {
      if (!graph) return
      const r = trace(graph, node, dir)
      selectItems([
        ...r.links.map((id) => ({ object_type: 'link', id }) as NonNullable<Selection>),
        ...r.nodes.map((id) => ({ object_type: 'node', id }) as NonNullable<Selection>),
      ])
      toast({ title: `Selected ${r.nodes.length} nodes and ${r.links.length} links ${dir === 'up' ? 'upstream' : 'downstream'}`, tone: 'success' })
    }
    if (inMulti) {
      items.push({ kind: 'header', label: `${multiSel.length} selected` })
      items.push({ label: 'Copy IDs', icon: <Copy className="h-3.5 w-3.5" />, hint: 'Ctrl+C', onSelect: () => copy(multiSel.map((x) => x.id).join('\n'), `${multiSel.length} IDs`) })
      const selLinks = multiSel.filter((x) => x.object_type === 'link').map((x) => x.id)
      if (!IS_VIEWER && selLinks.length) {
        items.push({ kind: 'separator' })
        items.push({ label: `Reverse ${selLinks.length} link${selLinks.length === 1 ? '' : 's'}`, icon: <ArrowLeftRight className="h-3.5 w-3.5" />, onSelect: () => void runTool('reverse', { links: selLinks }, () => `Reversed ${selLinks.length} links`) })
        items.push({ label: `Set ${selLinks.length} length${selLinks.length === 1 ? '' : 's'} from the map`, icon: <Ruler className="h-3.5 w-3.5" />, onSelect: () => void runTool('lengths', { links: selLinks }, (r) => `Updated ${(r.changed as unknown[]).length} lengths`) })
      }
      if (!IS_VIEWER) items.push({ kind: 'separator' }, { label: `Delete ${multiSel.length} objects`, icon: <Trash2 className="h-3.5 w-3.5" />, hint: 'Del', danger: true, onSelect: () => setBulkDeleteItems(multiSel) })
      items.push({ kind: 'separator' }, { label: 'Clear selection', hint: 'Esc', onSelect: () => selectItems([]) })
      return items
    }
    if (t) {
      const props = network.data?.geojson.features.find((f) => f.properties?.object_type === t.object_type && String(f.properties?.id) === t.id)?.properties ?? {}
      const kind = String(props.node_kind ?? props.link_kind ?? t.object_type)
      items.push({ kind: 'header', label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${t.id}` })
      items.push({
        label: canShowResults ? 'Properties and results chart' : 'Properties',
        icon: <Info className="h-3.5 w-3.5" />,
        onSelect: () => {
          setSelection(t)
          setMultiSel([t])
          if (canShowResults) setBottomCollapsed(false)
        },
      })
      items.push({ label: 'Zoom to', icon: <ZoomIn className="h-3.5 w-3.5" />, onSelect: () => zoomTo(t) })
      if (canShowResults && !pinned.some((p) => p.object_type === t.object_type && p.id === t.id))
        items.push({
          label: 'Pin its chart in the dock',
          icon: <Pin className="h-3.5 w-3.5" />,
          onSelect: () => {
            setPinned((l) => [...l, t].slice(-4))
            setBottomCollapsed(false)
          },
        })
      if (t.object_type === 'node' && graph) {
        const route = routeToOutfall(graph, t.id)
        items.push({ kind: 'separator' })
        items.push({
          label: route ? `Long-section to outfall ${route.outfall}` : 'Long-section to outfall',
          icon: <Mountain className="h-3.5 w-3.5" />,
          disabled: !route,
          onSelect: () => route && showProfileBetween(t.id, route.outfall),
        })
        items.push({ label: 'Long-section from top of branch', icon: <Mountain className="h-3.5 w-3.5" />, onSelect: () => showProfileBetween(topOfBranch(graph, t.id), t.id) })
        items.push({
          label: 'Long-section from here to…',
          hint: 'pick end',
          icon: <Mountain className="h-3.5 w-3.5" />,
          onSelect: () => {
            setProfileStart(t.id)
            setProfileEnd('')
            setShowProfile(true)
            setBottomCollapsed(false)
            setPickMode('end')
          },
        })
        items.push({ kind: 'separator' })
        items.push({ label: 'Select everything upstream', icon: <ArrowUpFromLine className="h-3.5 w-3.5" />, onSelect: () => traceSelect(t.id, 'up') })
        items.push({ label: 'Select everything downstream', icon: <ArrowDownToLine className="h-3.5 w-3.5" />, onSelect: () => traceSelect(t.id, 'down') })
        if (!IS_VIEWER) {
          items.push({ kind: 'separator' })
          items.push({
            label: 'Draw a link from here',
            icon: <Spline className="h-3.5 w-3.5" />,
            onSelect: () => {
              setDrawMode('add-conduit')
              setPendingLinkFromId(t.id)
            },
          })
          if (selection?.object_type === 'node' && selection.id !== t.id)
            items.push({
              label: `Merge ${selection.id} into ${t.id}`,
              icon: <Merge className="h-3.5 w-3.5" />,
              onSelect: () => void runTool('merge', { keep: t.id, remove: selection.id }, (r) => `Merged ${selection.id} into ${t.id}${(r.dropped_links as string[]).length ? `; removed ${(r.dropped_links as string[]).join(', ')}` : ''}`).then(() => setSelection({ object_type: 'node', id: t.id })),
            })
          const path = profile.data
          if (showProfile && path && path.path_node_ids.length > 2 && path.path_node_ids.includes(t.id))
            items.push({
              label: `Grade inverts along the long-section (${path.path_node_ids[0]} → ${path.path_node_ids[path.path_node_ids.length - 1]})`,
              icon: <TrendingDown className="h-3.5 w-3.5" />,
              onSelect: () => void runTool('interpolate', { nodes: path.path_node_ids, links: path.path_link_ids }, (r) => `Re-graded ${(r.changed as unknown[]).length} junction inverts`),
            })
        }
      }
      if (t.object_type === 'link' && graph) {
        const ends = graph.linkEnds.get(t.id)
        if (ends) {
          const route = routeToOutfall(graph, ends[1])
          items.push({ kind: 'separator' })
          items.push({ label: 'Long-section along this link', icon: <Mountain className="h-3.5 w-3.5" />, onSelect: () => showProfileBetween(ends[0], ends[1]) })
          items.push({
            label: 'Long-section from here to outfall',
            icon: <Mountain className="h-3.5 w-3.5" />,
            disabled: !route,
            onSelect: () => route && showProfileBetween(ends[0], route.outfall),
          })
          items.push({ kind: 'separator' })
          items.push({ label: 'Select everything upstream', icon: <ArrowUpFromLine className="h-3.5 w-3.5" />, onSelect: () => traceSelect(ends[0], 'up') })
          items.push({ label: 'Select everything downstream', icon: <ArrowDownToLine className="h-3.5 w-3.5" />, onSelect: () => traceSelect(ends[1], 'down') })
          items.push({ label: `Go to upstream node ${ends[0]}`, onSelect: () => zoomTo({ object_type: 'node', id: ends[0] }) })
          items.push({ label: `Go to downstream node ${ends[1]}`, onSelect: () => zoomTo({ object_type: 'node', id: ends[1] }) })
          if (!IS_VIEWER) {
            items.push({ kind: 'separator' })
            items.push({ label: 'Reverse direction', icon: <ArrowLeftRight className="h-3.5 w-3.5" />, onSelect: () => void runTool('reverse', { links: [t.id] }, () => `Reversed ${t.id}`) })
            if (props.link_kind === 'conduit' || !props.link_kind) {
              items.push({
                label: 'Split in the middle',
                icon: <Scissors className="h-3.5 w-3.5" />,
                onSelect: () => void runTool('split', { link: t.id, fraction: 0.5 }, (r) => `Split ${t.id}: new junction ${r.node}`).then((r) => r && setSelection({ object_type: 'node', id: String(r.node) })),
              })
              items.push({ label: 'Set length from the map', icon: <Ruler className="h-3.5 w-3.5" />, onSelect: () => void runTool('lengths', { links: [t.id] }, (r) => `Length of ${t.id} is now ${(r.changed as { new: number }[])[0]?.new ?? '?'}`) })
            }
          }
        }
      }
      if (t.object_type === 'subcatchment' && props.outlet) {
        const out = String(props.outlet)
        const isSub = network.data?.geojson.features.some((f) => f.properties?.object_type === 'subcatchment' && String(f.properties?.id) === out)
        items.push({ kind: 'separator' })
        items.push({ label: `Go to outlet ${out}`, onSelect: () => zoomTo({ object_type: isSub ? 'subcatchment' : 'node', id: out }) })
      }
      items.push({ kind: 'separator' })
      items.push({ label: 'Copy ID', icon: <Copy className="h-3.5 w-3.5" />, hint: 'Ctrl+C', onSelect: () => copy(t.id, t.id) })
      if (!IS_VIEWER)
        items.push({ label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, hint: 'Del', danger: true, onSelect: () => requestDelete(t) })
      return items
    }
    const [x, y] = ctxMenu.xy
    const fmtXY = `${x.toFixed(2)}, ${y.toFixed(2)}`
    items.push({ kind: 'header', label: `X ${x.toFixed(1)} · Y ${y.toFixed(1)}` })
    if (!IS_VIEWER) {
      for (const [k, label, icon] of [
        ['junction', 'Add junction here', <Circle key="j" className="h-3.5 w-3.5" />],
        ['outfall', 'Add outfall here', <Triangle key="o" className="h-3.5 w-3.5" />],
        ['storage', 'Add storage unit here', <Hexagon key="s" className="h-3.5 w-3.5" />],
      ] as const)
        items.push({ label, icon, onSelect: () => createNode.mutate({ node_kind: k, x, y, elevation: 0, max_depth: 0 }) })
      items.push({ kind: 'separator' })
    }
    items.push({ label: 'Copy coordinates', icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => copy(fmtXY, fmtXY) })
    items.push({ label: 'Zoom to the whole network', icon: <Maximize2 className="h-3.5 w-3.5" />, onSelect: () => setFitExtentNonce((n) => n + 1) })
    if (multiSel.length || selection) items.push({ label: 'Clear selection', hint: 'Esc', onSelect: () => selectItems([]) })
    if (!IS_VIEWER && editHistory.undo.length) {
      items.push({ kind: 'separator' })
      items.push({ label: `Undo ${editHistory.undo[0]}`, icon: <Undo2 className="h-3.5 w-3.5" />, hint: 'Ctrl+Z', onSelect: () => void editHistory.run('undo') })
    }
    return items
  }

  // The bottom panel holds one view at a time, as tabs: the long-section, the
  // results hydrographs, and the model's input time series and curves.
  const profilePopped = windows.some((w) => w.kind === 'profile')
  const chartsAvailable =
    mapMode === 'results' || liveActive || pinned.length > 0 || selectedTriangleIndex != null
  const dockTabs: { id: DockTab; label: string }[] = [
    ...(showProfile && !profilePopped ? [{ id: 'profile' as const, label: 'Long-section' }] : []),
    ...(chartsAvailable ? [{ id: 'charts' as const, label: 'Hydrograph' }] : []),
    { id: 'series', label: 'Time series' },
    { id: 'curves', label: 'Curves' },
  ]
  const activeDockTab: DockTab = dockTabs.some((t) => t.id === dockTabPref) ? (dockTabPref as DockTab) : dockTabs[0].id
  const dockHasContent =
    chartsAvailable || (showProfile && !profilePopped) || inputsOpen
  const dockNeedsRoom =
    activeDockTab === 'profile' || activeDockTab === 'series' || activeDockTab === 'curves' ||
    Boolean(selection) || selectedTriangleIndex != null || pinned.length > 0
  const dockHidden = bottomCollapsed || !dockHasContent

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
              <div className="-mb-1 flex items-center">
                <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">Contents</h2>
                <button
                  type="button"
                  aria-label="Close contents"
                  title="Close (reopen with Contents in the tab bar)"
                  className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg"
                  onClick={() => {
                    setLayersCollapsed(true)
                    setPref('contents-open', '0')
                  }}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
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
                  {!IS_VIEWER && <label
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
                  </label>}
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
                  {!flowAccum.data?.available && !IS_VIEWER && (
                    <p className="ml-1 text-[11px] text-muted">
                      Settings → DEM flow accumulation, then Run
                    </p>
                  )}
                  {twodInfo.data?.has_mesh && (
                    <>
                      <div className="border-t border-border pt-2 text-[11px] uppercase tracking-wide text-muted">
                        2D surface
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
                      {twodInfo.data?.mesh_file && (
                        <p
                          className="truncate text-[10px] text-muted"
                          title={twodInfo.data?.mesh_file ?? undefined}
                        >
                          {twodMesh.isLoading
                            ? 'Loading mesh…'
                            : meshGeoJson || compactMeshWgs
                              ? `${triangleCount.toLocaleString()} triangles${
                                  largeMesh ? ' (WebGL)' : ''
                                }`
                              : twodMesh.isError
                                ? 'Mesh failed to load'
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
                          No 2D results yet — run with OpenSWMM (REPORT_2D YES)
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
                      {(
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
                  <Button size="sm" variant={basemap === 'custom' ? 'primary' : 'outline'} onClick={() => setBasemap('custom')}>
                    Custom
                  </Button>
                </div>
                {basemap === 'custom' && (
                  <label className="mt-2 block text-[11px] text-muted">
                    Tile URL (XYZ, or WMS with {'{bbox-epsg-3857}'})
                    <input
                      className="field mt-1 h-7 font-mono text-[11px]"
                      value={customTiles}
                      placeholder="https://tile.example.com/{z}/{x}/{y}.png"
                      onChange={(e) => setCustomTiles(e.target.value)}
                      onBlur={() => setPref('custom-tiles-url', customTiles.trim())}
                      onKeyDown={(e) => e.key === 'Enter' && setPref('custom-tiles-url', customTiles.trim())}
                    />
                    <span className="mt-1 block">Tiles load from that address; nothing about the model is sent.</span>
                  </label>
                )}
              </Panel>

              {!IS_VIEWER && (<>
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
              </>)}
            </>
          )}
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
          {network.data && (
            <div className="relative z-30 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-elevated pl-1 pr-2">
              <div role="tablist" aria-label="Map mode" className="flex h-full shrink-0 items-stretch">
                {(IS_VIEWER ? (['results', 'review'] as const) : (['edit', 'results', 'review'] as const)).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mapMode === m}
                    onClick={() => setMapMode(m)}
                    title={{ edit: 'Draw and edit the network', results: 'Play the run: depths, flows and charts', review: 'Design checks, find by property, colour the map, cost' }[m]}
                    className={cn(
                      '-mb-px border-b-2 px-3 text-[13px]',
                      mapMode === m ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
                    )}
                  >
                    {t(m.charAt(0).toUpperCase() + m.slice(1))}
                  </button>
                ))}
              </div>
              <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
              <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
                {mapMode === 'edit' && (
                  <MapToolbar
                    mode={drawMode}
                    onModeChange={(m) => {
                      setDrawMode(m)
                      setPendingLinkFromId(null)
                      setPolygonDraft([])
                      if (m === 'draw-mesh-aoi') clearMeshAoi()
                      if (m !== 'select') setPickMode(null)
                    }}
                    linkKind={linkDrawKind}
                    onLinkKindChange={setLinkDrawKind}
                    onZoomExtent={() => setFitExtentNonce((n) => n + 1)}
                    onUndo={() => void editHistory.run('undo')}
                    canUndo={editHistory.undo.length > 0}
                  />
                )}
                {mapMode === 'results' && (
                  <>
                    <TabTool
                      active={!bottomCollapsed}
                      icon={<Clock className="h-3.5 w-3.5" />}
                      label="Time bar"
                      title="Play through the run"
                      onClick={() => setBottomCollapsed((c) => !c)}
                    />
                    <TabTool active={summaryOpen} icon={<ChartLine className="h-3.5 w-3.5" />} label="Run summary" disabled={!project.data?.has_out} onClick={() => setSummaryOpen((o) => !o)} />
                  </>
                )}
                <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                <TabTool
                  active={showProfile}
                  icon={<Mountain className="h-3.5 w-3.5" />}
                  label="Long-section" compact={mapMode === 'edit'}
                  title="Pick start and end nodes on the map"
                  onClick={() => {
                    setShowProfile((v) => {
                      if (!v) setPref('dock-tab', 'profile')
                      return !v
                    })
                    setBottomCollapsed(false)
                  }}
                />
                <TabTool
                  active={inputsOpen && !bottomCollapsed && (activeDockTab === 'series' || activeDockTab === 'curves')}
                  icon={<LineChartIcon className="h-3.5 w-3.5" />}
                  label="Inputs"
                  compact={mapMode === 'edit'}
                  title="The model's time series and curves"
                  onClick={() => {
                    const open = inputsOpen && !bottomCollapsed && (activeDockTab === 'series' || activeDockTab === 'curves')
                    if (open) {
                      setInputsOpen(false)
                      return
                    }
                    setInputsOpen(true)
                    setBottomCollapsed(false)
                    if (activeDockTab !== 'curves') setPref('dock-tab', 'series')
                  }}
                />
                <TabTool active={showNetwork3D} icon={<Box className="h-3.5 w-3.5" />} label="3D" compact={mapMode === 'edit'} title="Pipes at their depth below the map" onClick={() => setShowNetwork3D((v) => !v)} />
                {showNetwork3D && (
                  <select
                    value={ve3d ?? ''}
                    onChange={(e) => setVe3d(e.target.value ? Number(e.target.value) : null)}
                    title="Vertical exaggeration"
                    aria-label="3D vertical exaggeration"
                    className="field h-7 w-28 shrink-0 text-[12px]"
                  >
                    <option value="">Depth: auto</option>
                    {[1, 2, 5, 10, 20, 50].map((v) => (
                      <option key={v} value={v}>
                        Depth ×{v}
                      </option>
                    ))}
                  </select>
                )}
                <TabTool active={showFlowAnim} icon={<Waves className="h-3.5 w-3.5" />} label="Flow" compact={mapMode === 'edit'} title="Animate flow along the pipes" onClick={() => setShowFlowAnim((v) => !v)} />
                {liveActive && (
                  <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 text-[11px] text-accent-soft">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                    Live · {liveSnapshot.data?.time ?? 'waiting…'}
                  </span>
                )}
              </div>
              <TabTool
                active={!layersCollapsed}
                icon={<PanelLeft className="h-3.5 w-3.5" />}
                label="Contents" compact={mapMode === 'edit'}
                title="Layers, background map and 2D tools"
                onClick={() => {
                  setLayersCollapsed((c) => {
                    setPref('contents-open', c ? '1' : '0')
                    return !c
                  })
                  setLayersWidth((w) => (w < PANEL_MIN_W ? LAYERS_DEFAULT_W : w))
                }}
              />
              <TabTool
                active={inspectorPinned}
                icon={inspectorPinned ? <PinIcon className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                label="Inspector" compact={mapMode === 'edit'}
                title={inspectorPinned ? 'The inspector stays open. Click to let it close when nothing is selected.' : 'The inspector opens when you select something. Click to keep it open.'}
                onClick={() => {
                  setPref('inspector-pinned', inspectorPinned ? '0' : '1')
                  setInspectorWidth((w) => (w < PANEL_MIN_W ? INSPECTOR_DEFAULT_W : w))
                }}
              />
            </div>
          )}
          <div className="relative min-h-[18%] flex-1 overflow-hidden">
            {network.isLoading && (
              <p className="absolute left-64 top-3 z-20 map-overlay px-2 py-1 text-xs text-muted">
                Loading network…
              </p>
            )}
            {network.isError && (
              <p className="absolute left-64 top-3 z-20 rounded-lg border border-danger/40 bg-elevated/90 px-2 py-1 text-xs text-danger">
                {(network.error as Error).message}
              </p>
            )}
            {showNetwork3D && (
              <div className="pointer-events-none absolute bottom-12 left-1/2 z-20 -translate-x-1/2 map-overlay px-3 py-1.5 text-[11px] text-fg-soft">
                Manhole rims sit on the map; pipes hang at their depth below it (stretched).{' '}
                <span className="text-sky-300">Blue</span> water, <span className="text-red-400">red</span> surcharged,{' '}
                <span className="text-orange-400">orange</span> flooding. Right-drag to tilt and turn.
              </div>
            )}
            {showNetwork3D && (network.data?.counts?.links ?? 0) > 2000 && (
              <p className="absolute left-64 top-3 z-20 rounded-lg border border-amber-500/40 bg-elevated/90 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                Large network ({network.data?.counts?.links} links) — 3D may be slow.
              </p>
            )}
            {crsUnconfirmed && !crsPromptDismissed && network.data && (
              <div className="pointer-events-auto absolute left-1/2 top-20 z-30 flex w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-elevated/95 px-4 py-3 text-sm shadow-[var(--shadow-panel)]">
                <span className="min-w-0 flex-1 text-fg-soft">
                  <strong className="text-fg">Where is this model?</strong> It has no coordinate system yet, so it’s shown on a plain grid.
                </span>
                <Button size="sm" variant="primary" onClick={() => setCrsDialogOpen(true)}>
                  Choose coordinate system
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCrsPromptDismissed(true)
                    void api.setProjectCrs(projectCrs).then(() => queryClient.invalidateQueries({ queryKey: ['project'] }))
                  }}
                >
                  Keep the grid
                </Button>
              </div>
            )}
            <Dialog open={crsDialogOpen} onOpenChange={setCrsDialogOpen}>
              <DialogContent title="Coordinate system" description="Pick the coordinate system the model's X/Y coordinates are in, e.g. a State Plane or UTM zone.">
                <ProjectCrsControls projectPath={projectPath} className="border-0 bg-transparent p-0 shadow-none" />
              </DialogContent>
            </Dialog>
            {summaryOpen && (
              <RunSummaryCard runKey={[projectPath, runStatus?.status, runStatus?.engine]} onClose={() => setSummaryOpen(false)} />
            )}
            {network.data && (
              <NetworkMap
                customTilesUrl={customTilesUrl}
                thematic={thematic}
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
                onSelect={(sel, opts) => {
                  if (sel && opts?.additive) {
                    const has = multiSel.some((x) => sameSel(x, sel))
                    const base = multiSel.length ? multiSel : selection ? [selection] : []
                    selectItems(has ? base.filter((x) => !sameSel(x, sel)) : [...base, sel])
                  } else {
                    setMultiSel(sel ? [sel] : [])
                    setSelection(sel)
                  }
                  if (sel) {
                    setSelectedBoundaryId(null)
                    setSelectedTriangleIndex(null)
                  }
                }}
                multiSelection={multiSel}
                onBoxSelect={(items, additive) => {
                  if (additive) {
                    const base = multiSel.length ? multiSel : selection ? [selection] : []
                    selectItems([...base, ...items.filter((i) => !base.some((b) => sameSel(b, i)))])
                  } else selectItems(items)
                }}
                onContextMenu={(info) => setCtxMenu(info)}
                snapshot={displaySnapshot}
                resultsSymbology={resultsSymbology && canShowResults}
                symbologyExtents={symbology}
                meshGeoJson={meshGeoJson}
                compactMeshWgs={compactMeshWgs}
                show2dMesh={Boolean(
                  twodInfo.data?.has_mesh &&
                    show2dMesh,
                )}
                show2dDepth={show2dDepthActive}
                allowTrianglePick={Boolean(
                  twodInfo.data?.has_mesh &&
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
                verticalExaggeration={ve3d}
                lengthUnitScale={['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? '').toUpperCase()) ? 0.3048 : 1}
                onProfileNodePick={(id, opts) => {
                  if (pickMode === 'start') {
                    setProfileStart(id)
                    setProfileEnd('')
                    setProfileVia([])
                    setPickMode('end')
                  } else if (pickMode === 'end') {
                    // Shift-click: route through this node and keep picking.
                    if (opts?.shift && id !== profileStart) setProfileVia((v) => [...v, id])
                    else {
                      setProfileEnd(id)
                      setPickMode(null)
                    }
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
                zoomToSelectionNonce={zoomNonce}
              />
            )}
            {mapMode === 'edit' && drawMode !== 'select' && (
              <div className="map-overlay pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 px-2.5 py-1 text-xs text-fg-soft">
                {drawHint(drawMode, pendingLinkFromId, drawMode === 'draw-mesh-aoi' ? meshAoiDraft.length : polygonDraft.length, linkDrawKind)}
              </div>
            )}
            {network.data && mapMode === 'review' && (
              <ReviewPanel
                network={network.data}
                onSelectMany={(items) => {
                  selectItems(items)
                  setInspectorCollapsed(false)
                  setZoomNonce((n) => n + 1)
                }}
                onThematic={setThematic}
                onClose={() => setMapMode('edit')}
              />
            )}
            {windows.map((w, i) => (
              <FloatingWindow
                key={w.key}
                title={w.kind === 'profile' ? `Long-section ${profileStart ?? ''} → ${profileEnd ?? ''}` : `${w.target?.id} · ${w.target?.object_type}`}
                initial={{ x: 80 + i * 36, y: 70 + i * 36, w: w.kind === 'profile' ? 760 : 520, h: w.kind === 'profile' ? 420 : 300 }}
                zIndex={topWindow === w.key ? 45 : 40}
                onFocus={() => setTopWindow(w.key)}
                onClose={() => closeWindow(w.key)}
              >
                {w.kind === 'profile' ? (
                  <ProfileViewer
                    embedded
                    profile={profile.data}
                    start={profileStart}
                    end={profileEnd}
                    onStartChange={setProfileStart}
                    onEndChange={setProfileEnd}
                    via={profileVia}
                    onViaChange={setProfileVia}
                    nodeIds={nodeIdList}
                    pickMode={pickMode}
                    onPickMode={setPickMode}
                    loading={profile.isFetching && !profile.data}
                    error={profile.isError ? (profile.error as Error).message : null}
                    timeLabel={periods.data && periods.data.period_count > 0 ? timeLabel : null}
                    onSelect={setSelection}
                  />
                ) : w.target ? (
                  <ElementChart kind={w.target.object_type} id={w.target.id} />
                ) : null}
              </FloatingWindow>
            ))}
            {network.data && !summaryOpen && (
              <GettingStarted
                viewer={IS_VIEWER}
                selected={everSelected}
                ran={runStatus?.status === 'completed'}
                hasScenarios={IS_VIEWER ? (viewerRuns.data?.runs.length ?? 0) > 1 : (scenarioList.data?.scenarios.length ?? 0) > 1}
              />
            )}
            {network.data && (
              <FindObject
                network={network.data}
                onFind={(t) => {
                  setSelection(t)
                  setZoomNonce((n) => n + 1)
                }}
              />
            )}
            {thematic ? (
              <div className="map-overlay absolute bottom-3 right-3 z-10 w-52 p-3 text-xs">
                <div className="mb-2 flex items-center gap-2 font-medium text-fg-soft">
                  <span className="min-w-0 flex-1 truncate" title={thematic.title}>{thematic.title}</span>
                  <button type="button" className="text-[11px] font-normal text-accent-soft hover:underline" onClick={() => setThematic(null)}>
                    Reset
                  </button>
                </div>
                <ul className="m-0 list-none space-y-1 p-0">
                  {thematic.legend.map((l) => (
                    <li key={l.label} className="flex items-center gap-2 tabular-nums text-fg-soft">
                      <span className="h-2.5 w-4 rounded-sm" style={{ background: l.color }} />
                      {l.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
            <MapLegend
              units={{
                len: ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase()) ? 'ft' : 'm',
                flow: String(project.data?.flow_units ?? 'CFS').toLowerCase().replace('cms', 'm³/s').replace('lps', 'L/s').replace('mld', 'ML/d'),
              }}
              counts={network.data?.counts}
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
            )}

          </div>

          <div
            className={cn(
              'relative z-20 shrink-0',
              dockHidden && 'h-0',
            )}
          >
            <div
              className={cn(
                'relative min-h-0 border-t border-border bg-elevated',
                dockHidden
                  ? 'h-0 max-h-0 overflow-hidden border-0 p-0'
                  : 'overflow-y-auto overflow-x-hidden px-4 pb-3 pt-2.5 scrollbar-none',
              )}
              style={
                dockHidden
                  ? undefined
                  : dockNeedsRoom
                    ? { height: bottomHeight }
                    : { maxHeight: bottomHeight }
              }
            >
              {!dockHidden && (
                <>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize bottom panel"
                    title="Drag to resize"
                    onPointerDown={(e) => onPanelResizePointerDown('bottom', e)}
                    className="absolute inset-x-0 top-0 z-40 h-1.5 cursor-row-resize touch-none hover:bg-accent-soft/40 active:bg-accent-soft/60"
                  />
                  <div className="mb-2 flex items-center gap-2">
                    <div role="tablist" aria-label="Bottom panel" className="flex items-center gap-0.5 rounded-md bg-fg/5 p-0.5">
                      {dockTabs.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="tab"
                          aria-selected={activeDockTab === t.id}
                          onClick={() => {
                            setPref('dock-tab', t.id)
                            if (t.id === 'series' || t.id === 'curves') setInputsOpen(true)
                          }}
                          className={cn(
                            'rounded px-2.5 py-1 text-[12px] font-medium transition-colors',
                            activeDockTab === t.id ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <span className="flex-1" />
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fg/5 hover:text-fg"
                      title={bottomHeight >= BOTTOM_TALL_H ? 'Return to the normal height' : 'Make this panel taller'}
                      onClick={() => setBottomHeight((h) => (h >= BOTTOM_TALL_H ? BOTTOM_DEFAULT_H : BOTTOM_TALL_H))}
                    >
                      {bottomHeight >= BOTTOM_TALL_H ? 'Shorter' : 'Taller'}
                    </button>
                    <button type="button" aria-label="Close this panel" title="Close (reopen from the tab bar)" className="rounded p-0.5 text-muted hover:bg-fg/5 hover:text-fg" onClick={() => {
                      setBottomCollapsed(true)
                      setInputsOpen(false)
                    }}>
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {periods.isError && (
                    <p className="mb-2 text-xs text-danger">
                      Could not load results: {(periods.error as Error).message}
                    </p>
                  )}
                  {project.data?.has_out && periods.isLoading && (
                    <p className="mb-2 text-xs text-muted">Loading existing results…</p>
                  )}
                  {mapMode !== 'results' && !liveActive ? null : liveActive && !hasResultPeriods ? (
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
                      startTime={periods.data?.times?.[0] ?? null}
                      secondTime={periods.data?.times?.[1] ?? null}
                      onChange={setPeriod}
                      disabled={liveActive}
                      hasExistingOut={Boolean(
                        project.data?.has_out,
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
                      recording={recording}
                      onRecord={() => (recording ? void stopRecording() : startRecording())}
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
                  {activeDockTab === 'profile' && showProfile && !profilePopped && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-end">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fg/5 hover:text-fg"
                          title="Open the long-section in its own window"
                          onClick={() => openWindow({ key: 'profile', kind: 'profile' })}
                        >
                          <ExternalLink className="h-3 w-3" /> Pop out
                        </button>
                      </div>
                      <ProfileViewer
                        embedded
                        profile={profile.data}
                        start={profileStart}
                        end={profileEnd}
                        onStartChange={setProfileStart}
                        onEndChange={setProfileEnd}
                        via={profileVia}
                        onViaChange={setProfileVia}
                        nodeIds={nodeIdList}
                        onToOutfall={() => {
                          const r = graph && profileStart ? routeToOutfall(graph, profileStart) : null
                          if (r) {
                            setProfileVia([])
                            setProfileEnd(r.outfall)
                          } else toast({ title: 'No outfall downstream', description: `Nothing drains from ${profileStart} to an outfall.`, tone: 'danger' })
                        }}
                        pickMode={pickMode}
                        onPickMode={setPickMode}
                        loading={profile.isFetching && !profile.data}
                        error={profile.isError ? (profile.error as Error).message : null}
                        timeLabel={
                          periods.data && periods.data.period_count > 0 ? timeLabel : null
                        }
                        onSelect={setSelection}
                      />
                    </div>
                  )}
                  {activeDockTab === 'charts' && !selection && selectedTriangleIndex == null && pinned.length === 0 && (
                    <p className="mt-3 text-xs text-muted">Select a node, pipe or subcatchment on the map to see its hydrograph here.</p>
                  )}
                  {(activeDockTab === 'series' || activeDockTab === 'curves') && (
                    <div className="mt-2">
                      <InputDataPanel kind={activeDockTab} height={Math.max(160, bottomHeight - 150)} />
                    </div>
                  )}
                  {activeDockTab === 'charts' && selectedTriangleIndex != null && (
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
                  {activeDockTab === 'charts' && pinned.length > 0 && (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {pinned.map((p) => (
                        <PinnedChart
                          key={`${p.object_type}:${p.id}`}
                          kind={p.object_type}
                          id={p.id}
                          onUnpin={() => setPinned((l) => l.filter((x) => x !== p))}
                          onPopOut={() => {
                            openWindow({ key: `chart:${p.object_type}:${p.id}`, kind: 'chart', target: p })
                            setPinned((l) => l.filter((x) => x !== p))
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {activeDockTab === 'charts' && selection && mapMode === 'results' && (
                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fg/5 hover:text-fg"
                          onClick={() => setPinned((l) => (l.some((x) => x.object_type === selection.object_type && x.id === selection.id) ? l : [...l, selection].slice(-4)))}
                          title="Keep this chart while you select other elements"
                        >
                          <PinIcon className="h-3 w-3" /> Pin
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fg/5 hover:text-fg"
                          onClick={() => openWindow({ key: `chart:${selection.object_type}:${selection.id}`, kind: 'chart', target: selection })}
                          title="Open this chart in its own window"
                        >
                          <ExternalLink className="h-3 w-3" /> Pop out
                        </button>
                      </div>
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
              <div className="-mb-1 flex items-center gap-1">
                <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">Inspector</h2>
                <button
                  type="button"
                  aria-pressed={inspectorPinned}
                  aria-label={inspectorPinned ? 'Unpin the inspector' : 'Pin the inspector open'}
                  title={inspectorPinned ? 'Pinned: stays open with nothing selected' : 'Pin: keep open with nothing selected'}
                  className={cn('rounded p-1 hover:bg-fg/5', inspectorPinned ? 'text-accent-soft' : 'text-muted hover:text-fg')}
                  onClick={() => setPref('inspector-pinned', inspectorPinned ? '0' : '1')}
                >
                  <PinIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Close the inspector"
                  title="Close and clear the selection"
                  className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg"
                  onClick={() => {
                    setPref('inspector-pinned', '0')
                    selectItems([])
                    setSelectedTriangleIndex(null)
                    setSelectedBoundaryId(null)
                    setInspectorCollapsed(true)
                  }}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
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
                multiSel.length > 1 ? (
                  <MultiInspector
                    items={multiSel}
                    network={network.data}
                    readOnly={IS_VIEWER}
                    onClear={() => selectItems([])}
                    onDelete={(items) => setBulkDeleteItems(items)}
                  />
                ) : (
                  <ObjectInspector
                    selection={selection}
                    onSaved={invalidateNetwork}
                    onDeleteRequest={requestDelete}
                  />
                )
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

      {ctxMenu && <MapContextMenu x={ctxMenu.point.x} y={ctxMenu.point.y} items={contextItems()} onClose={() => setCtxMenu(null)} />}
      <AlertDialog
        open={Boolean(bulkDeleteItems)}
        onOpenChange={(o) => !o && setBulkDeleteItems(null)}
        title={`Delete ${bulkDeleteItems?.length ?? 0} objects?`}
        description="Links connected to deleted nodes are removed too, along with every reference to them in the model. You can undo this with Ctrl+Z."
        confirmLabel="Delete"
        danger
        confirming={bulkDelete.isPending}
        onConfirm={() => bulkDeleteItems && bulkDelete.mutate(bulkDeleteItems)}
      />
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

function TabTool({ active, icon, label, title, onClick, disabled, compact }: { active: boolean; icon: ReactNode; label: string; title?: string; onClick: () => void; disabled?: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      disabled={disabled}
      title={title ?? label}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors disabled:opacity-40',
        active ? 'bg-accent/15 font-medium text-accent-soft' : 'text-fg-soft hover:bg-fg/[0.06] hover:text-fg',
      )}
    >
      {icon}
      <span className={compact ? 'hidden 2xl:inline' : 'hidden lg:inline'}>{label}</span>
    </button>
  )
}
