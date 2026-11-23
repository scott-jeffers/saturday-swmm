import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  Box,
  Pin as PinIcon,
  PinOff,
  X as XIcon,
  ExternalLink,
  Clock,
  ChartLine,
  Map as MapIcon,
  Mountain,
  Play,
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
  Globe,
  Columns2,
  Rows2,
  ListFilter,
  Printer,
} from 'lucide-react'
import {
  useMutation,
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
  type GisLayer,
  type Delineation,
} from '../api/client'
import {
  NetworkMap,
  type BasemapMode,
  type Selection,
  type ThematicStyle,
} from '../components/map/NetworkMap'
import { takeEditNext } from '../lib/newModel'
import { PlaceSearch } from '../components/map/PlaceSearch'
import { MapToolbar, SHORTCUT as DRAW_SHORTCUT, type DrawMode, type LinkDrawKind } from '../components/map/MapToolbar'
import { MapLegend } from '../components/map/MapLegend'
import { RunSummaryCard } from '../components/RunSummaryCard'
import { subscribeMapFocus, takeMapFocus } from '../lib/mapFocus'
import { FindObject } from '../components/map/FindObject'
import { ReviewPanel, SelectByAttribute } from '../components/map/ReviewPanel'
import { PrintMapDialog } from '../components/map/PrintMapDialog'
import { ElementChart } from '../components/results/PinnedChart'
import { FloatingWindow } from '../components/FloatingWindow'
import { getPref, setPref, usePref } from '../lib/prefs'
import { useT } from '../lib/i18n'
import { recordMap, type MapRecording } from '../lib/mapRecorder'
import { refreshAfterEdit, useEditHistory } from '../components/UndoRedo'
import { MultiInspector } from '../components/inspector/MultiInspector'
import { MapContextMenu, type MenuItem } from '../components/map/MapContextMenu'
import { ChangeLegend } from '../components/CompareBar'
import { changeSnapshot, useCompare, useCompareSnapshot } from '../lib/compare'
import { useMapSymbologyExtents } from '../components/map/NetworkMap'
import { isPhoneNow, useIsPhone } from '../lib/useMedia'
import { buildGraph, routeToOutfall, topOfBranch, trace } from '../lib/networkTrace'
import { IS_VIEWER } from '../lib/mode'
import { GettingStarted } from '../components/map/GettingStarted'
import { LayersButton } from '../components/map/LayersButton'
import { subscribeGraphRequests } from '../lib/graphRequest'
import { FillFromMapMenu } from '../components/map/FillFromMapMenu'
import type { MeasureMode, MeasureResult } from '../components/map/MeasureTool'
import { useMapStyle, type StyleKey } from '../lib/mapStyle'
import { ProjectCrsControls } from '../components/ProjectCrsControls'
import { GisPanel } from '../components/map/GisPanel'
import { ObjectInspector } from '../components/inspector/ObjectInspector'
import { BoundaryInspector } from '../components/inspector/BoundaryInspector'
import { TriangleInspector } from '../components/inspector/TriangleInspector'
import { TimeSlider } from '../components/results/TimeSlider'
import { TimeSeriesChart } from '../components/TimeSeriesChart'
import { ProfileViewer } from '../components/profile/ProfileViewer'
import { InputDataPanel } from '../components/results/InputDataPanel'
import { GraphsView } from '../components/results/GraphsView'

type WorkspaceView = 'map' | 'profile' | 'charts' | 'curves'
const WORKSPACE_VIEWS: WorkspaceView[] = ['map', 'profile', 'charts', 'curves']
const WORKSPACE_LABEL: Record<WorkspaceView, string> = {
  map: 'Map',
  profile: 'Profile',
  charts: 'Graphs',
  curves: 'Curves',
}
const WORKSPACE_TONE: Record<WorkspaceView, string> = {
  map: 'text-ic-land',
  profile: 'text-ic-results',
  charts: 'text-ic-water',
  curves: 'text-ic-scen',
}
const WORKSPACE_ICON: Record<WorkspaceView, typeof MapIcon> = {
  map: MapIcon,
  profile: Mountain,
  charts: ChartLine,
  curves: Spline,
}
import { useRunStatus } from '../hooks/useRunStatus'
import { useTriangleSeries } from '../hooks/useTriangleSeries'
import { useResultsPlayback } from '../hooks/useResultsPlayback'
import { AlertDialog, Button, Dialog, DialogContent, Tooltip, useToast } from '../components/ui'
import { wgs84ToProject, ensureCrs, DEFAULT_CRS, projectToWgs84 } from '../lib/projection'
import { meshResponseToCompactWgs, meshResponseToWgsGeoJson } from '../lib/meshGeoJson'
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

const INSPECTOR_DEFAULT_W = 320
const PANEL_MIN_W = 180
const PANEL_MAX_W = 640
const BOTTOM_DEFAULT_H = 320
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
  const [basemap, setBasemapState] = useState<BasemapMode>(() => (getPref('basemap', 'osm') as BasemapMode) || 'osm')
  const setBasemap = useCallback((b: BasemapMode) => {
    setBasemapState(b)
    setPref('basemap', b)
  }, [])
  const showLabels = usePref('map-labels', '0') === '1'
  const meshOpacity = Number(usePref('mesh-opacity', '1')) || 1
  const show3DBuildings = usePref('map-buildings', '0') === '1'
  const [measureMode, setMeasureMode] = useState<MeasureMode | null>(null)
  const [measure, setMeasure] = useState<MeasureResult | null>(null)
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
  const meshPreview = mesh.preview
  // Map first: on smaller screens the layers panel starts hidden.
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
  const phone = useIsPhone()
  const [bottomHeight, setBottomHeight] = useState(BOTTOM_DEFAULT_H)
  const [bottomCollapsed, setBottomCollapsed] = useState(false)
  // Workspace views as document tabs along the top, like PCSWMM / ICM:
  // the map stays mounted underneath, so switching back is instant.
  const viewPref = usePref('workspace-view', 'map') as WorkspaceView
  // 'series' was its own tab until 0.16; it now lives inside Graphs.
  const view: WorkspaceView = (viewPref as string) === 'series' ? 'charts' : WORKSPACE_VIEWS.includes(viewPref) ? viewPref : 'map'
  const [graphChecked, setGraphChecked] = useState<string[]>([])
  const setView = (v: WorkspaceView) => setPref('workspace-view', v)
  const [viewHeight, setViewHeight] = useState(600)
  const [viewWidth, setViewWidth] = useState(1200)
  // Split view: Profile, Graphs and Curves sit beside or below the map
  // instead of covering it, so a selection shows in all of them at once.
  const splitPref = usePref('workspace-split', '')
  const split: '' | 'right' | 'below' = splitPref === 'right' || splitPref === 'below' ? splitPref : ''
  const paneSizePref = Number(usePref(`workspace-split-${split || 'right'}`, '')) || 0
  const paneOpen = Boolean(split) && !phone && view !== 'map'
  // Default: a fair share of the space; never so big the map disappears.
  const paneSize = Math.min(
    paneSizePref || (split === 'below' ? Math.round(viewHeight * 0.42) : Math.min(640, Math.round(viewWidth * 0.45))),
    split === 'below' ? Math.max(180, viewHeight - 160) : Math.max(320, viewWidth - 320),
  )
  const setSplit = (next: '' | 'right' | 'below') => {
    setPref('workspace-split', next)
    // Turning it on from the map: open the profile beside it.
    if (next && view === 'map') {
      setShowProfile(true)
      setView('profile')
    }
  }
  /** Drag the pane's edge; the size is kept per layout. */
  const startPaneResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const box = mainRef.current?.getBoundingClientRect()
    if (!box) return
    const move = (ev: PointerEvent) => {
      const raw = split === 'below' ? box.bottom - ev.clientY : box.right - ev.clientX
      const max = (split === 'below' ? box.height - 160 : box.width - 320)
      setPref(`workspace-split-${split}`, String(Math.round(Math.max(split === 'below' ? 180 : 320, Math.min(max, raw)))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const mainRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const el = mainRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      setViewHeight(el.clientHeight - 36)
      setViewWidth(el.clientWidth)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const panelResizeRef = useRef<{
    side: 'inspector' | 'bottom'
    startX: number
    startY: number
    startSize: number
  } | null>(null)
  /** Types = icons / link-kind colors; Results = depth/flow/runoff symbology */
  const [resultsSymbology, setResultsSymbology] = useState(false)
  type MapMode = 'edit' | 'results' | 'review'
  const [mapMode, setMapModeState] = useState<MapMode>(() =>
    takeEditNext() ? 'edit' : IS_VIEWER ? 'results' : ((['edit', 'results', 'review'].includes(getPref('map-mode')) ? getPref('map-mode') : 'edit') as MapMode),
  )
  const canShowResultsRef = useRef(false)
  const [thematic, setThematic] = useState<(ThematicStyle & { legend: { label: string; color: string }[]; title: string }) | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  /** Everything selected (Shift/Ctrl-click, box select); includes `selection`. */
  const [multiSel, setMultiSel] = useState<NonNullable<Selection>[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ target: Selection; lngLat: [number, number]; xy: [number, number]; point: { x: number; y: number } } | null>(null)
  const [bulkDeleteItems, setBulkDeleteItems] = useState<NonNullable<Selection>[] | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [selectByOpen, setSelectByOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const changeDrawMode = (m: DrawMode) => {
    setDrawMode(m)
    setPendingLinkFromId(null)
    setPolygonDraft([])
    if (m === 'draw-mesh-aoi') clearMeshAoi()
    if (m !== 'select') setPickMode(null)
  }
  // Edit tools by key: V select, J junction, O outfall, S storage, L link,
  // A subcatchment, M 2D area, D delete (shown in the dock's tooltips).
  const changeDrawModeRef = useRef(changeDrawMode)
  changeDrawModeRef.current = changeDrawMode
  useEffect(() => {
    if (mapMode !== 'edit' || !visible) return
    const byKey = Object.fromEntries(Object.entries(DRAW_SHORTCUT).map(([m, k]) => [k.toLowerCase(), m as DrawMode]))
    const on = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      const t = ev.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      const m = byKey[ev.key.toLowerCase()]
      if (!m) return
      ev.preventDefault()
      changeDrawModeRef.current(m)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [mapMode, visible])
  // Comparing started from the header's "vs …": the map shows results only in Results mode.
  useEffect(() => {
    const on = () => setMapMode('results')
    window.addEventListener('saturday-swmm-compare-started', on)
    return () => window.removeEventListener('saturday-swmm-compare-started', on)
  })
  // Delineation from the DEM: right-click → "Delineate the area draining here".
  const [delin, setDelin] = useState<(Delineation & { id: string; outletNode: string }) | null>(null)
  const [delinBusy, setDelinBusy] = useState(false)
  // Search (Ctrl K) → "Select by property" opens it here.
  useEffect(() => {
    const on = () => setSelectByOpen(true)
    window.addEventListener('saturday-swmm-select-by', on)
    return () => window.removeEventListener('saturday-swmm-select-by', on)
  }, [])
  const [pinned] = useState<NonNullable<Selection>[]>([])
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
  const [drawMode, setDrawMode] = useState<DrawMode>('select')
  const [linkDrawKind, setLinkDrawKind] = useState<LinkDrawKind>('conduit')
  const [pendingLinkFromId, setPendingLinkFromId] = useState<string | null>(null)
  const [polygonDraft, setPolygonDraft] = useState<Position[]>([])
  const [deleteTarget, setDeleteTarget] = useState<NonNullable<Selection> | null>(null)
  const [cascadeLinks, setCascadeLinks] = useState<string[]>([])
  const [forceCascade, setForceCascade] = useState(false)
  const [fitExtentNonce, setFitExtentNonce] = useState(0)
  const [placeSearchDone, setPlaceSearchDone] = useState(false)
  useEffect(() => setPlaceSearchDone(false), [projectPath])
  /** Fit on open or after a CRS change: goes to the saved start view if there is one. */
  const [autoFitNonce, setAutoFitNonce] = useState(0)
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
    const on = (e: Event) => {
      takeEditNext()
      setMapModeRef.current((e as CustomEvent).detail as MapMode)
    }
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
      // Phones: keep the map in view; the summary is one tap away (Run summary).
      setSummaryOpen(!isPhoneNow())
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
      // Results loaded from files: keep the map clear; the summary is one click away (Run summary).
      // A run that just finished in this browser opens it (above).
      jumpToPeakRef.current = true
    }
    prevOut.current = out
  }, [runStatus?.status, runStatus?.out_path])
  const liveActive =
    liveRenderingPref &&
    runStatus?.status === 'running' &&
    Boolean(runStatus?.live_rendering)

  // "Show in Graphs" from the element panel (inflows, DWF profile…).
  useEffect(
    () =>
      subscribeGraphRequests((keys) => {
        setGraphChecked((cur) => [...new Set([...cur, ...keys])])
        setView('charts')
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
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
    if (crsUnconfirmed) setBasemapState('projected')
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
        setView('map')
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
  const mapStyle = useMapStyle(projectPath)
  const usUnits = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const layerCounts = useMemo(() => {
    const c: Partial<Record<StyleKey, number>> = {}
    for (const f of network.data?.geojson?.features ?? []) {
      const pr = f.properties ?? {}
      const k = (pr.object_type === 'node' ? pr.node_kind ?? 'junction' : pr.object_type === 'link' ? pr.link_kind ?? 'conduit' : pr.object_type === 'subcatchment' ? 'subcatchment' : null) as StyleKey | null
      if (k) c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [network.data])
  const layerVisible: Record<StyleKey, boolean> = {
    junction: showJunctions,
    outfall: showOutfalls,
    storage: showStorage,
    conduit: showLinks && visibleLinkKinds.conduit,
    pump: showLinks && visibleLinkKinds.pump,
    orifice: showLinks && visibleLinkKinds.orifice,
    weir: showLinks && visibleLinkKinds.weir,
    outlet: showLinks && visibleLinkKinds.outlet,
    subcatchment: showSubcatchments,
  }
  const toggleLayer = (k: StyleKey) => {
    if (k === 'junction') setShowJunctions((v) => !v)
    else if (k === 'outfall') setShowOutfalls((v) => !v)
    else if (k === 'storage') setShowStorage((v) => !v)
    else if (k === 'subcatchment') setShowSubcatchments((v) => !v)
    else if (!showLinks) {
      setShowLinks(true)
      setVisibleLinkKinds((prev) => ({ ...prev, [k]: true }))
    } else toggleLinkKind(k)
  }


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
    setAutoFitNonce((n) => n + 1)
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

  // Comparing with another scenario / result set (shared with Graphs and Profile).
  const cmp = useCompare(`${runStatus?.status ?? ''}-${runStatus?.out_path ?? ''}`)
  const comparing = Boolean(cmp.target) && !liveActive
  const cmpSnap = useCompareSnapshot(comparing ? cmp.target!.id : null, displaySnapshot?.period ?? null, showAllPeaks)
  const cmpPeaks = useCompareSnapshot(comparing ? cmp.target!.id : null, null, true)
  const cmpMapMode = comparing ? cmp.mapMode : 'current'
  const changeSnap = useMemo(() => (cmpMapMode === 'change' ? changeSnapshot(displaySnapshot, cmpSnap.data) : null), [cmpMapMode, displaySnapshot, cmpSnap.data])
  const mapSnapshot = cmpMapMode === 'other' ? (cmpSnap.data ?? displaySnapshot) : cmpMapMode === 'change' ? (changeSnap ?? displaySnapshot) : displaySnapshot
  const changeExtents = useMapSymbologyExtents(changeSnap)

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

  // 2D velocities for the surface-flow animation (current period only).
  const velPeriod = displayTwodBinary && displayTwodBinary.period >= 0 && !showAllPeaks ? displayTwodBinary.period : null
  const surfaceFlowWanted = Boolean(showFlowAnim && show2dDepthActive && velPeriod != null && compactMeshWgs)
  const velocity = useQuery({
    queryKey: ['2d-velocity', projectPath, project.data?.inp_path, runStatus?.status, velPeriod],
    queryFn: async () => {
      const [x, y] = await Promise.all([api.fetchTwoDSnapshotBinary(velPeriod!, 'vx'), api.fetchTwoDSnapshotBinary(velPeriod!, 'vy')])
      return { vx: x.values, vy: y.values }
    },
    enabled: surfaceFlowWanted,
    staleTime: Infinity,
    retry: false,
    placeholderData: (prev) => prev,
  })
  const surfaceFlow = useMemo(
    () =>
      surfaceFlowWanted && velocity.data && displayTwodBinary?.values && velocity.data.vx.length === displayTwodBinary.values.length
        ? { vx: velocity.data.vx, vy: velocity.data.vy, depth: displayTwodBinary.values }
        : null,
    [surfaceFlowWanted, velocity.data, displayTwodBinary],
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


  // The compared run's water levels along the profile: invert + its depth.
  const profileCompare = useMemo(() => {
    if (!comparing || !profile.data || !cmp.target) return null
    const depthOf = (snap: typeof cmpSnap.data) => {
      const m = new Map<string, number>()
      snap?.node_ids.forEach((id, i) => m.set(id, snap.node_depths[i]))
      return m
    }
    const now = depthOf(showAllPeaks ? undefined : cmpSnap.data)
    const peak = depthOf(cmpPeaks.data)
    const levels = new Map<string, { hgl: number | null; max: number | null }>()
    for (const n of profile.data.nodes) {
      const d = now.get(n.id)
      const p = peak.get(n.id)
      levels.set(n.id, { hgl: d != null ? n.elevation + d : null, max: p != null ? n.elevation + p : null })
    }
    return { label: cmp.target.label, currentLabel: cmp.current?.label, levels }
  }, [comparing, profile.data, cmp.target, cmp.current, cmpSnap.data, cmpPeaks.data, showAllPeaks])

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
      if (!typingInField && ev.key === 'Home' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        ev.preventDefault()
        setFitExtentNonce((n) => n + 1)
        return
      }
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
        !typingInField
      ) {
        ev.preventDefault()
        setBulkDeleteItems(multiSel)
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
  }, [visible, selection, multiSel, drawMode, meshAoiDraft, network.data])

  // The model's extent in lon/lat, padded, for loading web features around it.
  const modelExtentWgs = useMemo((): [number, number, number, number] | null => {
    const b = network.data?.bounds
    if (!b || !projectCrs || !Number.isFinite(b.minx) || !Number.isFinite(b.maxx)) return null
    try {
      const padX = (b.maxx - b.minx) * 0.25
      const padY = (b.maxy - b.miny) * 0.25
      const [w, s] = projectToWgs84(b.minx - padX, b.miny - padY, projectCrs)
      const [e, n] = projectToWgs84(b.maxx + padX, b.maxy + padY, projectCrs)
      return [w, s, e, n].every(Number.isFinite) ? [w, s, e, n] : null
    } catch {
      return null
    }
  }, [network.data?.bounds, projectCrs])
  const gisLayerPanelProps = {
    projectPath: projectPath ?? '',
    projectCrs,
    modelExtent: modelExtentWgs,
    onProjectCrsApplied: () => setFitExtentNonce((n) => n + 1),
    onZoomToLayer: (layer: GisLayer) => {
      const b = layer.bounds
      if (!b) {
        toast({ title: 'No bounds', description: `${layer.name} has no extent to zoom to`, tone: 'danger' })
        return
      }
      setFitWgsBoundsRequest({ nonce: Date.now(), west: b.west, south: b.south, east: b.east, north: b.north })
    },
  }
  const gisOpen = usePref('gis-panel') === '1'

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
      // Results reloading (e.g. switching scenario): colour again once they're back.
      if (mapMode === 'results') wantResultsColoursRef.current = true
    }
  }, [canShowResults, resultsSymbology, mapMode])

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
    side: 'inspector' | 'bottom',
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const startSize =
      side === 'inspector' ? inspectorWidth : bottomHeight
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
      if (drag.side === 'inspector') {
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

  // First visit to Graphs: start from what is selected on the map (and any
  // charts pinned before 0.16), so the tab isn't empty.
  useEffect(() => {
    if (view !== 'charts' || graphChecked.length) return
    const seed = [...(multiSel.length ? multiSel : selection ? [selection] : []), ...pinned]
      .filter((x) => x.object_type === 'node' || x.object_type === 'link' || x.object_type === 'subcatchment')
      .map((x) => `${x.object_type}:${x.id}`)
    if (seed.length) setGraphChecked([...new Set(seed)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  // Opening the Profile tab (also after a reload) turns the profile on.
  useEffect(() => {
    if (view === 'profile') setShowProfile(true)
  }, [view])
  // ...and never opens empty: with nothing picked, show the network's longest
  // run to an outfall (the main line), until something is selected.
  useEffect(() => {
    if (view !== 'profile' || profileStart || !network.data) return
    const g = buildGraph(network.data)
    const heads = [...g.nodeKind.keys()].filter((n) => !(g.up.get(n)?.length)).slice(0, 400)
    let best: { start: string; outfall: string; n: number } | null = null
    for (const h of heads) {
      const r = routeToOutfall(g, h)
      if (r && (!best || r.nodes.length > best.n)) best = { start: h, outfall: r.outfall, n: r.nodes.length }
    }
    if (best && best.n >= 2) {
      setProfileVia([])
      setProfileStart(best.start)
      setProfileEnd(best.outfall)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, network.data])
  // "Pick on map" from the Profile tab: go to the map, then come back
  // once both ends are picked.
  const pickReturnRef = useRef(false)
  useEffect(() => {
    if (pickMode && view === 'profile' && !paneOpen) {
      pickReturnRef.current = true
      setView('map')
    } else if (!pickMode && pickReturnRef.current) {
      pickReturnRef.current = false
      setView('profile')
    }
  }, [pickMode, view, paneOpen])
  const graph = useMemo(() => (network.data ? buildGraph(network.data) : null), [network.data])
  const nodeIdList = useMemo(
    () => (network.data?.geojson.features ?? []).filter((f) => f.properties?.object_type === 'node').map((f) => String(f.properties?.id)),
    [network.data],
  )
  const showProfileBetween = (start: string, end: string) => {
    setProfileVia([])
    setProfileStart(start)
    setProfileEnd(end)
    setShowProfile(true)
    setPickMode(null)
    setView('profile')
  }
  // Split view: the pane follows the map selection. A node or pipe shows its
  // profile down to the outfall; Graphs plots what is selected.
  useEffect(() => {
    if (!paneOpen || !graph || pickMode) return
    const sel = multiSel.length > 1 ? multiSel : selection ? [selection] : []
    if (!sel.length) return
    if (view === 'profile') {
      const first = sel[0]!
      const start = first.object_type === 'node' ? first.id : first.object_type === 'link' ? graph.linkEnds.get(first.id)?.[0] : undefined
      const route = start ? routeToOutfall(graph, start) : null
      if (!start || !route) return
      setProfileVia([])
      setProfileStart(start)
      setProfileEnd(route.outfall)
      setShowProfile(true)
    } else if (view === 'charts') {
      const keys = sel
        .filter((x) => x.object_type === 'node' || x.object_type === 'link' || x.object_type === 'subcatchment')
        .map((x) => `${x.object_type}:${x.id}`)
      if (keys.length) setGraphChecked(keys)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.object_type, selection?.id, multiSel.length, paneOpen, view, graph])
  const runDelineate = async (x: number, y: number) => {
    setDelinBusy(true)
    try {
      const r = await api.delineate({ x, y })
      // Drains to the nearest node to where the flow leaves the area.
      let best = ''
      let bd = Infinity
      for (const f of network.data?.geojson.features ?? []) {
        const p = f.properties ?? {}
        if (p.object_type !== 'node') continue
        const d = (Number(p.x) - r.outlet[0]) ** 2 + (Number(p.y) - r.outlet[1]) ** 2
        if (d < bd) {
          bd = d
          best = String(p.id)
        }
      }
      const taken = new Set((network.data?.geojson.features ?? []).filter((f) => f.properties?.object_type === 'subcatchment').map((f) => String(f.properties?.id)))
      let n = taken.size + 1
      while (taken.has(`S${n}`)) n++
      setDelin({ ...r, id: `S${n}`, outletNode: best })
    } catch (e) {
      toast({ title: 'Couldn’t delineate here', description: (e as Error).message, tone: 'danger' })
    } finally {
      setDelinBusy(false)
    }
  }
  const createDelineated = useMutation({
    mutationFn: (d: NonNullable<typeof delin>) =>
      api.createSubcatchment({
        id: d.id,
        outlet: d.outletNode,
        area: d.area,
        width: d.width ?? undefined,
        slope: Math.max(0.01, d.slope_pct),
        pct_imperv: d.pct_imperv ?? 50,
        polygon: d.polygon,
      }),
    onSuccess: (obj) => {
      refreshAfterEdit(queryClient)
      setDelin(null)
      selectItems([{ object_type: 'subcatchment', id: obj.id }])
      setInspectorCollapsed(false)
      toast({ title: `Added subcatchment ${obj.id}`, description: 'Check its values in the inspector; Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t add the subcatchment', description: e.message, tone: 'danger' }),
  })
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
      if (selLinks.length) {
        items.push({ kind: 'separator' })
        items.push({ label: `Reverse ${selLinks.length} link${selLinks.length === 1 ? '' : 's'}`, icon: <ArrowLeftRight className="h-3.5 w-3.5" />, onSelect: () => void runTool('reverse', { links: selLinks }, () => `Reversed ${selLinks.length} links`) })
        items.push({ label: `Set ${selLinks.length} length${selLinks.length === 1 ? '' : 's'} from the map`, icon: <Ruler className="h-3.5 w-3.5" />, onSelect: () => void runTool('lengths', { links: selLinks }, (r) => `Updated ${(r.changed as unknown[]).length} lengths`) })
      }
      items.push({ kind: 'separator' }, { label: `Delete ${multiSel.length} objects`, icon: <Trash2 className="h-3.5 w-3.5" />, hint: 'Del', danger: true, onSelect: () => setBulkDeleteItems(multiSel) })
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
      if (t.object_type === 'node' || t.object_type === 'link' || t.object_type === 'subcatchment') {
        // Right-click on part of a multi-selection: graph the whole selection.
        const group = multiSel.some((m) => m.object_type === t.object_type && m.id === t.id) ? multiSel : [t]
        const keys = group
          .filter((g) => g.object_type === 'node' || g.object_type === 'link' || g.object_type === 'subcatchment')
          .map((g) => `${g.object_type}:${g.id}`)
        items.push({
          label: keys.length > 1 ? `Show ${keys.length} in Graphs` : 'Show in Graphs',
          icon: <ChartLine className="h-3.5 w-3.5" />,
          onSelect: () => {
            setGraphChecked((cur) => [...new Set([...cur, ...keys])])
            setView('charts')
          },
        })
      }
      if (t.object_type === 'node' && graph) {
        const route = routeToOutfall(graph, t.id)
        items.push({ kind: 'separator' })
        items.push({
          label: route ? `Profile to outfall ${route.outfall}` : 'Profile to outfall',
          icon: <Mountain className="h-3.5 w-3.5" />,
          disabled: !route,
          onSelect: () => route && showProfileBetween(t.id, route.outfall),
        })
        items.push({ label: 'Profile from top of branch', icon: <Mountain className="h-3.5 w-3.5" />, onSelect: () => showProfileBetween(topOfBranch(graph, t.id), t.id) })
        items.push({
          label: 'Profile from here to…',
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
            label: `Grade inverts along the profile (${path.path_node_ids[0]} → ${path.path_node_ids[path.path_node_ids.length - 1]})`,
            icon: <TrendingDown className="h-3.5 w-3.5" />,
            onSelect: () => void runTool('interpolate', { nodes: path.path_node_ids, links: path.path_link_ids }, (r) => `Re-graded ${(r.changed as unknown[]).length} junction inverts`),
          })
      }
      if (t.object_type === 'link' && graph) {
        const ends = graph.linkEnds.get(t.id)
        if (ends) {
          const route = routeToOutfall(graph, ends[1])
          items.push({ kind: 'separator' })
          items.push({ label: 'Profile along this link', icon: <Mountain className="h-3.5 w-3.5" />, onSelect: () => showProfileBetween(ends[0], ends[1]) })
          items.push({
            label: 'Profile from here to outfall',
            icon: <Mountain className="h-3.5 w-3.5" />,
            disabled: !route,
            onSelect: () => route && showProfileBetween(ends[0], route.outfall),
          })
          items.push({ kind: 'separator' })
          items.push({ label: 'Select everything upstream', icon: <ArrowUpFromLine className="h-3.5 w-3.5" />, onSelect: () => traceSelect(ends[0], 'up') })
          items.push({ label: 'Select everything downstream', icon: <ArrowDownToLine className="h-3.5 w-3.5" />, onSelect: () => traceSelect(ends[1], 'down') })
          items.push({ label: `Go to upstream node ${ends[0]}`, onSelect: () => zoomTo({ object_type: 'node', id: ends[0] }) })
          items.push({ label: `Go to downstream node ${ends[1]}`, onSelect: () => zoomTo({ object_type: 'node', id: ends[1] }) })
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
      if (t.object_type === 'subcatchment' && props.outlet) {
        const out = String(props.outlet)
        const isSub = network.data?.geojson.features.some((f) => f.properties?.object_type === 'subcatchment' && String(f.properties?.id) === out)
        items.push({ kind: 'separator' })
        items.push({ label: `Go to outlet ${out}`, onSelect: () => zoomTo({ object_type: isSub ? 'subcatchment' : 'node', id: out }) })
      }
      items.push({ kind: 'separator' })
      items.push({ label: 'Copy ID', icon: <Copy className="h-3.5 w-3.5" />, hint: 'Ctrl+C', onSelect: () => copy(t.id, t.id) })
      items.push({ label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, hint: 'Del', danger: true, onSelect: () => requestDelete(t) })
      return items
    }
    const [x, y] = ctxMenu.xy
    const fmtXY = `${x.toFixed(2)}, ${y.toFixed(2)}`
    items.push({ kind: 'header', label: `X ${x.toFixed(1)} · Y ${y.toFixed(1)}` })
    for (const [k, label, icon] of [
      ['junction', 'Add junction here', <Circle key="j" className="h-3.5 w-3.5" />],
      ['outfall', 'Add outfall here', <Triangle key="o" className="h-3.5 w-3.5" />],
      ['storage', 'Add storage unit here', <Hexagon key="s" className="h-3.5 w-3.5" />],
    ] as const)
      items.push({ label, icon, onSelect: () => createNode.mutate({ node_kind: k, x, y, elevation: 0, max_depth: 0 }) })
    if (!IS_VIEWER) {
      items.push({ kind: 'separator' })
      items.push({
        label: 'Delineate the area draining here',
        icon: <Mountain className="h-3.5 w-3.5" />,
        hint: 'DEM',
        onSelect: () => void runDelineate(x, y),
      })
    }
    items.push({ kind: 'separator' })
    items.push({ label: 'Copy coordinates', icon: <Copy className="h-3.5 w-3.5" />, onSelect: () => copy(fmtXY, fmtXY) })
    items.push({ label: 'Zoom to model extent', icon: <Maximize2 className="h-3.5 w-3.5" />, hint: 'Home', onSelect: () => setFitExtentNonce((n) => n + 1) })
    if (multiSel.length || selection) items.push({ label: 'Clear selection', hint: 'Esc', onSelect: () => selectItems([]) })
    if (editHistory.undo.length) {
      items.push({ kind: 'separator' })
      items.push({ label: `Undo ${editHistory.undo[0]}`, icon: <Undo2 className="h-3.5 w-3.5" />, hint: 'Ctrl+Z', onSelect: () => void editHistory.run('undo') })
    }
    return items
  }

  // Under the map: only the time bar. Views live in the tabs along the top.
  const profilePopped = windows.some((w) => w.kind === 'profile')
  const dockHasContent = mapMode === 'results' || liveActive
  const dockNeedsRoom = false
  const dockHidden = bottomCollapsed || !dockHasContent


  const workspaceSlider = (
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
                    />
  )
  // Room left in a full-size tab after the time bar and the view's own toolbar.
  // The room a view has: the whole workspace, or the pane in split view.
  const paneBelow = paneOpen && split === 'below'
  const viewRoom = (paneBelow ? paneSize : viewHeight) - (project.data?.has_out && hasResultPeriods && !(paneOpen && !dockHidden) ? 50 : 0) - 24
  const graphsStacked = paneOpen && split === 'right' && paneSize < 760
  const profileView = (
    <div>
                      <div className="mb-1 flex justify-end">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fg/5 hover:text-fg"
                          title="Open the profile in its own window"
                          onClick={() => openWindow({ key: 'profile', kind: 'profile' })}
                        >
                          <ExternalLink className="h-3 w-3" /> Pop out
                        </button>
                      </div>
                      <ProfileViewer
      fillHeight={viewRoom - 150}
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
                        compare={profileCompare}
                        timeLabel={
                          periods.data && periods.data.period_count > 0 ? timeLabel : null
                        }
                        onSelect={setSelection}
                      />
                    </div>
  )
  const chartsView = network.data ? (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {selectedTriangleIndex != null && (
        <TimeSeriesChart
          series={triangleSeries.series.data}
          yLabel={triangleSeries.yLabel}
          variables={triangleSeries.variables}
          variable={triangleSeries.variable}
          onVariableChange={triangleSeries.setVariable}
          height={200}
        />
      )}
      <div className="min-h-0 flex-1">
        <GraphsView
          network={network.data}
          checked={graphChecked}
          onCheckedChange={setGraphChecked}
          mapSelection={multiSel.length ? multiSel : selection ? [selection] : []}
          hasResults={Boolean(project.data?.has_out)}
          runStamp={`${runStatus?.status ?? ''}-${runStatus?.out_path ?? ''}`}
          onShowOnMap={(it) => {
            selectItems([it])
            setInspectorCollapsed(false)
            if (!paneOpen) setView('map')
            setZoomNonce((n) => n + 1)
          }}
          height={Math.round((viewRoom - (selectedTriangleIndex != null ? 270 : 0)) * (graphsStacked ? 0.62 : 1))}
          stacked={graphsStacked}
        />
      </div>
    </div>
  ) : null

  // Map / Profile / Graphs / Curves, and the split-view buttons: on the map's
  // tool row, or atop a Profile/Graphs view (full or split) so you can switch back.
  const viewSwitcher = (
    <div className="flex shrink-0 items-center gap-1">
      <div role="tablist" aria-label="Views" className="flex items-center gap-0.5 rounded-md bg-fg/[0.05] p-0.5">
        {WORKSPACE_VIEWS.map((v) => {
          const Icon = WORKSPACE_ICON[v]
          const on = view === v
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={WORKSPACE_LABEL[v]}
              title={WORKSPACE_LABEL[v]}
              onClick={() => {
                if (v === 'profile') setShowProfile(true)
                setView(v)
              }}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded px-2 text-[12.5px] transition-colors',
                on ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', WORKSPACE_TONE[v])} />
              <span className={on ? '' : 'hidden 2xl:inline'}>{WORKSPACE_LABEL[v]}</span>
            </button>
          )
        })}
      </div>
      {!phone && (
        <div role="group" aria-label="Split view" className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {([
            ['right', 'Profile and graphs beside the map', Columns2],
            ['below', 'Profile and graphs below the map', Rows2],
          ] as const).map(([k, tip, Icon]) => (
            <Tooltip key={k} content={split === k ? 'Back to one view at a time' : tip}>
              <button
                type="button"
                aria-label={tip}
                aria-pressed={split === k}
                onClick={() => setSplit(split === k ? '' : k)}
                className={cn(
                  'inline-flex h-6 w-7 items-center justify-center rounded text-muted hover:bg-fg/[0.06] hover:text-fg',
                  split === k && 'bg-accent/15 text-accent-soft',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  )
  // While comparing (picked in the header's "vs …"), what the map colours by:
  // this run, the other one, or the change between them.
  /** Drop the trailing parts two run labels share (" · Model rainfall"). */
  const shortLabel = (label: string, other: string) => {
    const a = label.split(' · ')
    const b = other.split(' · ')
    while (a.length > 1 && b.length > 1 && a[a.length - 1] === b[b.length - 1]) {
      a.pop()
      b.pop()
    }
    return a.join(' · ')
  }
  const compareShow = cmp.target ? (
    <div role="group" aria-label="The map shows" className="flex shrink-0 items-center gap-0.5 rounded-md bg-fg/[0.05] p-0.5">
      {(
        [
          ['current', `Map shows ${shortLabel(cmp.current?.label ?? 'this run', cmp.target.label)} (solid lines)`],
          ['other', `Map shows ${shortLabel(cmp.target.label, cmp.current?.label ?? '')} (dashed lines)`],
          ['change', `Map shows the change: blue where ${shortLabel(cmp.current?.label ?? 'this run', cmp.target.label)} is lower, red where higher`],
        ] as const
      ).map(([k, title]) => (
        <Tooltip key={k} content={title}>
          <button
            type="button"
            aria-pressed={cmp.mapMode === k}
            aria-label={title}
            onClick={() => {
              cmp.setMapMode(k)
              // The change that matters most is in the peaks.
              if (k === 'change') setShowAllPeaks(true)
            }}
            className={cn(
              'inline-flex h-6 w-8 items-center justify-center rounded',
              cmp.mapMode === k ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {k === 'change' ? (
              <span className="text-[13px] font-semibold leading-none">Δ</span>
            ) : (
              <svg width="16" height="4" className={k === 'other' ? 'text-ic-scen' : ''} aria-hidden>
                <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2.2" strokeDasharray={k === 'other' ? '4 3' : undefined} />
              </svg>
            )}
          </button>
        </Tooltip>
      ))}
    </div>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1">

        <main ref={mainRef} className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
          <div
            className="relative flex min-h-0 flex-1 flex-col"
            style={paneOpen && split === 'right' ? { marginRight: paneSize } : undefined}
          >
          {network.data && (
            <div className="relative z-40 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-elevated pl-1 pr-2 max-md:overflow-x-auto max-md:scrollbar-none">
              {(view === 'map' || paneOpen) && (
                <>
                  {viewSwitcher}
                  <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
                </>
              )}
              <div role="tablist" aria-label="Map mode" className="flex h-full shrink-0 items-stretch">
                {(['edit', 'results', 'review'] as const).map((m) => (
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
                  <FillFromMapMenu
                    selectedLinks={multiSel.filter((m) => m.object_type === 'link').map((m) => m.id)}
                    selectedNodes={multiSel.filter((m) => m.object_type === 'node').map((m) => m.id)}
                    hasDem={(gisLayers.data?.layers ?? []).some((l) => l.type === 'dem')}
                    usUnits={usUnits}
                    onLengths={(links) =>
                      void runTool('lengths', { links }, (r) => {
                        const n = (r.changed as unknown[]).length
                        return `Set ${n} pipe length${n === 1 ? '' : 's'} from the map`
                      })
                    }
                    onRims={(nodes, dem_unit) =>
                      void runTool('rims-from-dem', { nodes, dem_unit }, (r) => {
                        const n = (r.changed as unknown[]).length
                        const k = (r.skipped as unknown[]).length
                        return `Set ${n} rim${n === 1 ? '' : 's'} from the DEM${k ? ` · ${k} skipped` : ''}`
                      })
                    }
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
                    {compareShow && (
                      <>
                        <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                        {compareShow}
                      </>
                    )}
                  </>
                )}
                <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
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
              {mapMode !== 'review' && (
                <TabTool
                  active={selectByOpen}
                  icon={<ListFilter className="h-3.5 w-3.5" />}
                  label="Select by…"
                  compact={mapMode === 'edit'}
                  title="Select elements by property or result, e.g. diameter < 12 in and slope < 0.5 %"
                  onClick={() => setSelectByOpen((v) => !v)}
                />
              )}
              <TabTool
                active={printOpen}
                icon={<Printer className="h-3.5 w-3.5" />}
                label="Print"
                compact={mapMode === 'edit' || mapMode === 'review'}
                title="Print the map or save it as a PDF or PNG, with a title, legend and scale bar"
                onClick={() => setPrintOpen(true)}
              />
              <TabTool
                active={measureMode != null}
                icon={<Ruler className="h-3.5 w-3.5" />}
                label="Measure" compact={mapMode === 'edit'}
                title="Measure distance or area"
                onClick={() => {
                  setMeasure(null)
                  setMeasureMode((m) => (m ? null : 'distance'))
                }}
              />
              <LayersButton
                toolbar
                compact={mapMode === 'edit'}
                basemap={basemap}
                onBasemap={setBasemap}
                customTiles={customTilesUrl}
                onCustomTiles={(u) => {
                  setPref('custom-tiles-url', u)
                }}
                hasCrs={!crsUnconfirmed}
                visible={layerVisible}
                counts={layerCounts}
                onToggle={toggleLayer}
                style={mapStyle.style}
                onStyle={mapStyle.update}
                showLabels={showLabels}
                onShowLabels={(v) => setPref('map-labels', v ? '1' : '0')}
                show3DBuildings={show3DBuildings}
                onShow3DBuildings={(v) => setPref('map-buildings', v ? '1' : '0')}
                resultsMode={resultsSymbology && canShowResults}
                surface={
                  twodInfo.data?.has_mesh
                    ? {
                        triangles: twodInfo.data.triangle_count,
                        mesh: show2dMesh,
                        onMesh: setShow2dMesh,
                        depth: show2dDepth,
                        onDepth: setShow2dDepth,
                        hasResults: Boolean(hasTwoDResults),
                        opacity: meshOpacity,
                        boundaries: show2dBoundaries,
                        onBoundaries: (v: boolean) => {
                          setShow2dBoundaries(v)
                          if (!v) setSelectedBoundaryId(null)
                        },
                        onOpacity: (v) => setPref('mesh-opacity', String(v)),
                      }
                    : null
                }
                floodplain={
                  IS_VIEWER
                    ? null
                    : {
                        on: showFlowAccum,
                        onToggle: setShowFlowAccum,
                        available: Boolean(flowAccum.data?.available),
                        note: flowAccum.data?.polygon_count ? `${flowAccum.data.polygon_count.toLocaleString()} polygons` : undefined,
                      }
                }
              />
              <TabTool
                active={gisOpen}
                icon={<Globe className="h-3.5 w-3.5" />}
                label="GIS" compact={mapMode === 'edit'}
                title="Background layers, and elevation, impervious cover and soils data"
                onClick={() => setPref('gis-panel', gisOpen ? '0' : '1')}
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
          <div className="relative flex min-h-[18%] flex-1 overflow-hidden">
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
          <div
            className="relative min-w-0 flex-1 overflow-hidden"
            style={mapMode === 'edit' && network.data ? ({ '--map-dock-h': '5.25rem' } as React.CSSProperties) : undefined}
          >
            {(delin || delinBusy) && (
              <section aria-label="Delineated area" className="absolute left-3 top-14 z-30 w-[300px] rounded-xl border border-border bg-elevated p-3 text-[12px] shadow-[var(--shadow-panel)]">
                {delinBusy && !delin ? (
                  <p className="m-0 text-fg-soft">Tracing the area that drains here…</p>
                ) : delin ? (
                  <>
                    <h2 className="m-0 text-[13px] font-semibold text-fg">Drains here: {delin.area.toLocaleString('en-US', { maximumFractionDigits: 2 })} {delin.area_units}</h2>
                    <p className="mb-2 mt-0.5 text-muted">
                      From the DEM ({delin.cell_size} {delin.area_units === 'ac' ? 'ft' : 'm'} cells){delin.snapped ? ', snapped to the nearest flow path' : ''}.
                    </p>
                    <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
                      <dt className="text-muted">Mean slope</dt>
                      <dd className="m-0 text-right tabular-nums">{delin.slope_pct} %</dd>
                      <dt className="text-muted">Longest flow path</dt>
                      <dd className="m-0 text-right tabular-nums">{delin.flow_length.toLocaleString('en-US')} {delin.area_units === 'ac' ? 'ft' : 'm'}</dd>
                      <dt className="text-muted">Width (area ÷ path)</dt>
                      <dd className="m-0 text-right tabular-nums">{delin.width ?? '—'} {delin.area_units === 'ac' ? 'ft' : 'm'}</dd>
                      <dt className="text-muted">Impervious</dt>
                      <dd className="m-0 text-right tabular-nums" title={delin.pct_imperv == null ? 'Download NLCD impervious data in GIS → Site data to fill this in' : 'Mean of NLCD 2021 impervious cover'}>
                        {delin.pct_imperv == null ? '50 % (assumed)' : `${delin.pct_imperv} %`}
                      </dd>
                    </dl>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <label className="block text-muted">
                        Name
                        <input className="field mt-0.5 h-7 w-full text-[12px]" value={delin.id} onChange={(e) => setDelin({ ...delin, id: e.target.value.replace(/\s/g, '_') })} />
                      </label>
                      <label className="block text-muted">
                        Drains to
                        <input className="field mt-0.5 h-7 w-full text-[12px]" value={delin.outletNode} onChange={(e) => setDelin({ ...delin, outletNode: e.target.value })} />
                      </label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="primary" disabled={!delin.id || !delin.outletNode || createDelineated.isPending} onClick={() => createDelineated.mutate(delin)}>
                        Create subcatchment
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDelin(null)}>
                        Discard
                      </Button>
                    </div>
                  </>
                ) : null}
              </section>
            )}
            {network.data && selectByOpen && mapMode !== 'review' && (
              <SelectByAttribute
                network={network.data}
                onSelectMany={(items) => {
                  selectItems(items)
                  setInspectorCollapsed(false)
                  setZoomNonce((n) => n + 1)
                }}
                onClose={() => setSelectByOpen(false)}
              />
            )}
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
            {!crsUnconfirmed && basemap !== 'projected' && network.data && !(network.data.geojson?.features?.length) && !placeSearchDone && (
              <PlaceSearch
                onClose={() => setPlaceSearchDone(true)}
                onPick={(b) => {
                  setPlaceSearchDone(true)
                  setFitWgsBoundsRequest({ nonce: Date.now(), ...b })
                }}
              />
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
            <PrintMapDialog
              open={printOpen}
              onOpenChange={setPrintOpen}
              us={['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())}
              defaultTitle={(project.data?.inp_name ?? 'Map').replace(/\.inp$/i, '')}
              defaultSubtitle={[
                project.data?.scenario_name && `${project.data.scenario_name} scenario`,
                project.data?.storm_name,
                mapMode === 'results' && project.data?.has_out ? (timeLabel ? `Results at ${String(timeLabel).replace('T', ' ').replace(/:\d\d$/, '')}` : 'Results') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
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
                layerStyle={mapStyle.style}
                meshOpacity={meshOpacity}
                surfaceFlow={surfaceFlow}
                showLabels={showLabels}
                show3DBuildings={show3DBuildings && !crsUnconfirmed}
                measureMode={measureMode}
                onMeasureChange={setMeasure}
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
                snapshot={mapSnapshot}
                resultsSymbology={resultsSymbology && canShowResults}
                symbologyExtents={cmpMapMode === 'change' && changeSnap ? { ...symbology, depthMax: changeExtents.depthMax, flowMax: changeExtents.flowMax, runoffMax: changeExtents.runoffMax } : symbology}
                changeMode={cmpMapMode === 'change' && Boolean(changeSnap)}
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
                meshPreviewGeoJson={
                  meshPreview?.geojson ??
                  (delin
                    ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...delin.polygon, delin.polygon[0]!]] } }] }
                    : null)
                }
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
                profilePickedIds={pickMode === 'end' && profileStart ? [profileStart, ...profileVia] : []}
                showFlowAnim={showFlowAnim && cmpMapMode !== 'change'}
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
                editing={mapMode === 'edit'}
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
                autoFitNonce={autoFitNonce}
                fitWgsBoundsRequest={fitWgsBoundsRequest}
                zoomToSelectionNonce={zoomNonce}
              />
            )}
            {mapMode === 'edit' && network.data && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
                <MapToolbar dock mode={drawMode} onModeChange={changeDrawMode} linkKind={linkDrawKind} onLinkKindChange={setLinkDrawKind} />
              </div>
            )}
            {mapMode === 'edit' && drawMode !== 'select' && (
              <div className="map-overlay pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 px-2.5 py-1 text-xs text-fg-soft">
                {drawHint(drawMode, pendingLinkFromId, drawMode === 'draw-mesh-aoi' ? meshAoiDraft.length : polygonDraft.length, linkDrawKind)}
              </div>
            )}
            {windows.map((w, i) => (
              <FloatingWindow
                key={w.key}
                title={w.kind === 'profile' ? `Profile ${profileStart ?? ''} → ${profileEnd ?? ''}` : `${w.target?.id} · ${w.target?.object_type}`}
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
                    compare={profileCompare}
                  />
                ) : w.target ? (
                  <ElementChart kind={w.target.object_type} id={w.target.id} />
                ) : null}
              </FloatingWindow>
            ))}
            {network.data && !summaryOpen && !phone && (
              <GettingStarted
                raised={mapMode === 'edit'}
                viewer={IS_VIEWER}
                selected={everSelected}
                ran={runStatus?.status === 'completed'}
                hasScenarios={IS_VIEWER ? (viewerRuns.data?.runs.length ?? 0) > 1 : (scenarioList.data?.scenarios.length ?? 0) > 1}
              />
            )}
            {measureMode && (
              <div className="map-overlay pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-3 px-2 py-1.5 text-[12px]">
                <div className="flex rounded-md bg-fg/[0.06] p-0.5" role="tablist" aria-label="Measure">
                  {(['distance', 'area'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={measureMode === m}
                      onClick={() => {
                        setMeasure(null)
                        setMeasureMode(m)
                      }}
                      className={cn('rounded px-2 py-0.5 capitalize', measureMode === m ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg')}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <span className="min-w-[9rem] tabular-nums text-fg">
                  {!measure || measure.points === 0
                    ? 'Click on the map to start'
                    : measureMode === 'area'
                      ? measure.points < 3 && !measure.done
                        ? `${formatLength(measure.distance_m, usUnits)} · add points`
                        : `${formatArea(measure.area_m2, usUnits)} · perimeter ${formatLength(measure.distance_m, usUnits)}`
                      : formatLength(measure.distance_m, usUnits)}
                </span>
                <span className="hidden text-[11px] text-muted md:inline">Double-click to finish · Esc to clear</span>
                <button type="button" onClick={() => setMeasureMode(null)} className="rounded px-1.5 text-muted hover:bg-fg/[0.06] hover:text-fg" aria-label="Stop measuring">
                  Done
                </button>
              </div>
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
            ) : cmpMapMode === 'change' && changeSnap && resultsSymbology && canShowResults ? (
              <ChangeLegend
                currentLabel={cmp.current?.label ?? 'This run'}
                otherLabel={cmp.target?.label ?? ''}
                peaks={showAllPeaks}
                depthMax={changeExtents.depthMax}
                flowMax={changeExtents.flowMax}
                units={{
                  len: ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase()) ? 'ft' : 'm',
                  flow: String(project.data?.flow_units ?? 'CFS').toLowerCase().replace('cms', 'm³/s').replace('lps', 'L/s').replace('mld', 'ML/d'),
                }}
              />
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
          </div>

          <div
            className={cn(
              'relative z-20 shrink-0',
              dockHidden && 'h-0',
            )}
            style={paneOpen && split === 'below' ? { marginBottom: paneSize } : undefined}
          >
            <div
              className={cn(
                'relative min-h-0 border-t border-border bg-elevated',
                dockHidden
                  ? 'h-0 max-h-0 overflow-hidden border-0 p-0'
                  : 'overflow-y-auto overflow-x-hidden py-2.5 pl-4 pr-9 scrollbar-none',
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
                  <button
                    type="button"
                    aria-label="Hide the time bar"
                    title="Hide the time bar (reopen with Time bar in the tab bar)"
                    className="absolute right-2 top-2 z-10 rounded p-0.5 text-muted hover:bg-fg/5 hover:text-fg"
                    onClick={() => setBottomCollapsed(true)}
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
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
                    />
                  )}
                </>
              )}
            </div>
          </div>
          </div>
          {view !== 'map' && (
            <section
              className={cn(
                'absolute z-40 flex min-h-0 flex-col overflow-hidden bg-surface',
                !paneOpen && 'inset-0',
                paneOpen && split === 'right' && 'bottom-0 right-0 top-0 border-l border-border',
                paneOpen && split === 'below' && 'inset-x-0 bottom-0 border-t border-border',
              )}
              style={paneOpen ? (split === 'right' ? { width: paneSize } : { height: paneSize }) : undefined}
              aria-label={WORKSPACE_LABEL[view]}
            >
              {paneOpen && (
                <div
                  role="separator"
                  aria-orientation={split === 'right' ? 'vertical' : 'horizontal'}
                  aria-label="Resize"
                  onPointerDown={startPaneResize}
                  className={cn(
                    'absolute z-10 bg-transparent transition-colors hover:bg-accent/40',
                    split === 'right' ? 'inset-y-0 left-0 w-1.5 cursor-col-resize' : 'inset-x-0 top-0 h-1.5 cursor-row-resize',
                  )}
                />
              )}
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-elevated pl-1 pr-2">
                {/* Split view: the tabs stay on the map's tool row, so they don't jump across. */}
                {paneOpen ? (
                  <span className="inline-flex items-center gap-1.5 pl-2 text-[13px] font-medium text-fg">
                    {(() => {
                      const Icon = WORKSPACE_ICON[view]
                      return <Icon className={cn('h-3.5 w-3.5', WORKSPACE_TONE[view])} />
                    })()}
                    {WORKSPACE_LABEL[view]}
                  </span>
                ) : (
                  viewSwitcher
                )}

              </div>
              {/* In split view the time bar under the map drives the pane too. */}
              {(view === 'profile' || view === 'charts') && project.data?.has_out && hasResultPeriods && (!paneOpen || dockHidden) && (
                <div className="shrink-0 border-b border-border bg-elevated px-4 py-2">{workspaceSlider}</div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {view === 'profile' && (profilePopped ? (
                  <p className="text-sm text-muted">The profile is open in its own window.</p>
                ) : profileView)}
                {view === 'charts' && <div className="h-full">{chartsView}</div>}
                {view === 'curves' && (
                  <div className="h-full">
                    <InputDataPanel kind="curves" height={Math.max(240, viewHeight - 120)} />
                  </div>
                )}
              </div>
            </section>
          )}
        </main>

        {gisOpen && projectPath ? (
          <aside
            aria-label="GIS"
            className={cn(
              'relative flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-border bg-elevated/30 p-3',
              phone && 'fixed inset-x-0 bottom-0 z-40 max-h-[62vh] w-auto rounded-t-2xl border-l-0 border-t bg-elevated shadow-[0_-8px_30px_rgba(0,0,0,0.25)]',
            )}
          >
            <GisPanel
              layers={gisLayerPanelProps}
              onClose={() => setPref('gis-panel', '0')}
              onSelectSubcatchment={(id) => {
                selectItems([{ object_type: 'subcatchment', id }])
                setZoomNonce((n) => n + 1)
              }}
            />
          </aside>
        ) : null}

        <aside
          className={cn(
            'relative flex shrink-0 flex-col gap-3 overflow-y-auto overflow-x-hidden border-l border-border bg-elevated/30 p-3 scrollbar-none',
            inspectorCollapsed && 'w-0 overflow-hidden border-0 p-0',
            // Phones: a sheet over the bottom of the map.
            phone && !inspectorCollapsed && 'fixed inset-x-0 bottom-0 z-40 max-h-[58vh] rounded-t-2xl border-l-0 border-t bg-elevated shadow-[0_-8px_30px_rgba(0,0,0,0.25)]',
          )}
          style={inspectorCollapsed || phone ? undefined : { width: inspectorWidth }}
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
                  Set the dates and time steps in Simulation options, then press Run.
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

function formatLength(m: number, us: boolean): string {
  if (us) {
    const ft = m / 0.3048
    return ft >= 5280 ? `${(ft / 5280).toFixed(2)} mi` : `${ft.toFixed(ft < 100 ? 1 : 0)} ft`
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(m < 100 ? 1 : 0)} m`
}

function formatArea(m2: number, us: boolean): string {
  if (us) {
    const ft2 = m2 / 0.09290304
    return ft2 >= 43560 ? `${(ft2 / 43560).toFixed(2)} ac` : `${Math.round(ft2).toLocaleString('en-US')} ft²`
  }
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2).toLocaleString('en-US')} m²`
}
