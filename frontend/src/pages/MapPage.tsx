import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Mountain,
  Play,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  api,
  type ConflictDetail,
  type ModelNetwork,
  type ModelObjectResponse,
} from '../api/client'
import {
  NetworkMap,
  useMapSymbologyExtents,
  type BasemapMode,
  type Selection,
} from '../components/map/NetworkMap'
import { MapToolbar, type DrawMode, type LinkDrawKind } from '../components/map/MapToolbar'
import { MapLegend } from '../components/map/MapLegend'
import { BackgroundLayersPanel } from '../components/map/BackgroundLayersPanel'
import { ObjectInspector } from '../components/inspector/ObjectInspector'
import { RunPanel } from '../components/RunPanel'
import { TimeSlider } from '../components/results/TimeSlider'
import { TimeSeriesChart } from '../components/TimeSeriesChart'
import { ProfileViewer } from '../components/profile/ProfileViewer'
import { useRunStatus } from '../hooks/useRunStatus'
import { AlertDialog, Button, Panel, Switch, useToast } from '../components/ui'
import { wgs84ToProject } from '../lib/projection'
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
import type { Position } from 'geojson'
import { cn } from '../lib/cn'

interface MapPageProps {
  projectPath: string
  visible?: boolean
}

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
  const [showJunctions, setShowJunctions] = useState(true)
  const [showOutfalls, setShowOutfalls] = useState(true)
  const [showStorage, setShowStorage] = useState(true)
  const [layersOpen, setLayersOpen] = useState(true)
  /** Types = icons / link-kind colors; Results = depth/flow/runoff symbology */
  const [resultsSymbology, setResultsSymbology] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [period, setPeriod] = useState(0)
  const [profileStart, setProfileStart] = useState('')
  const [profileEnd, setProfileEnd] = useState('')
  const [pickMode, setPickMode] = useState<'start' | 'end' | null>(null)
  const [showProfile, setShowProfile] = useState(true)
  const [drawMode, setDrawMode] = useState<DrawMode>('select')
  const [linkDrawKind, setLinkDrawKind] = useState<LinkDrawKind>('conduit')
  const [pendingLinkFromId, setPendingLinkFromId] = useState<string | null>(null)
  const [polygonDraft, setPolygonDraft] = useState<Position[]>([])
  const [deleteTarget, setDeleteTarget] = useState<NonNullable<Selection> | null>(null)
  const [cascadeLinks, setCascadeLinks] = useState<string[]>([])
  const [forceCascade, setForceCascade] = useState(false)
  const [fitExtentNonce, setFitExtentNonce] = useState(0)
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])
  const undoingRef = useRef(false)
  const { data: runStatus } = useRunStatus()

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
  })

  const network = useQuery({
    queryKey: ['network', projectPath],
    queryFn: () => api.getNetwork('EPSG:25832'),
  })

  const networkKey = ['network', projectPath] as const

  // Fit extent once when this project's network first arrives
  const fittedPathRef = useRef<string | null>(null)
  useEffect(() => {
    fittedPathRef.current = null
  }, [projectPath])
  useEffect(() => {
    if (!visible || !network.data) return
    if (fittedPathRef.current === projectPath) return
    const has =
      (network.data.geojson?.features?.length ?? 0) > 0 || Boolean(network.data.bounds)
    if (!has) return
    fittedPathRef.current = projectPath
    setFitExtentNonce((n) => n + 1)
  }, [projectPath, network.data, visible])

  const periods = useQuery({
    queryKey: ['out-periods', project.data?.inp_path, project.data?.has_out, runStatus?.status],
    queryFn: api.getOutPeriods,
    enabled: Boolean(project.data),
    retry: false,
  })

  const snapshot = useQuery({
    queryKey: [
      'out-snapshot',
      period,
      project.data?.inp_path,
      runStatus?.status,
    ],
    queryFn: () => api.getOutSnapshot(period),
    enabled: Boolean(periods.data && periods.data.period_count > 0),
    retry: false,
  })

  const series = useQuery({
    queryKey: ['map-series', selection?.object_type, selection?.id],
    queryFn: () => {
      if (selection!.object_type === 'node') return api.getNodeSeries(selection!.id)
      if (selection!.object_type === 'link') return api.getLinkSeries(selection!.id)
      return api.getSubcatchmentSeries(selection!.id)
    },
    enabled: Boolean(selection),
    retry: false,
  })

  const profile = useQuery({
    queryKey: ['profile', profileStart, profileEnd, period, snapshot.data?.period],
    queryFn: () =>
      api.getProfile(
        profileStart,
        profileEnd,
        periods.data && periods.data.period_count > 0 ? period : undefined,
      ),
    enabled: Boolean(profileStart && profileEnd),
    retry: false,
  })

  const invalidateNetwork = () => {
    void queryClient.invalidateQueries({ queryKey: ['network'] })
    void queryClient.invalidateQueries({ queryKey: ['object'] })
    void queryClient.invalidateQueries({ queryKey: ['inp'] })
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
      toast({
        title: 'Deleted',
        description:
          res.cascaded_link_ids.length > 0
            ? `${res.id} (+ ${res.cascaded_link_ids.length} links)`
            : res.id,
        tone: 'success',
      })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      void queryClient.invalidateQueries({ queryKey: ['object'] })
      softRefreshNetwork()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const detail = err.detail as ConflictDetail
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
        setPickMode(null)
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
  }, [selection, drawMode, performUndo])

  const timeLabel = useMemo(() => {
    if (!periods.data?.times?.length) return snapshot.data?.time
    return periods.data.times[period] ?? snapshot.data?.time
  }, [periods.data, period, snapshot.data?.time])

  const symbology = useMapSymbologyExtents(snapshot.data)

  const gisLayers = useQuery({
    queryKey: ['gis-layers', projectPath],
    queryFn: api.listGisLayers,
    enabled: Boolean(projectPath),
  })

  useEffect(() => {
    if (!symbology.hasSnapshot && resultsSymbology) {
      setResultsSymbology(false)
    }
  }, [symbology.hasSnapshot, resultsSymbology])

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
            'flex shrink-0 flex-col gap-3 overflow-auto border-r border-border bg-elevated/40 p-3 transition-all',
            layersOpen ? 'w-64' : 'w-0 overflow-hidden border-0 p-0',
          )}
        >
          {layersOpen && (
            <>
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
                        disabled={!symbology.hasSnapshot}
                        title={
                          symbology.hasSnapshot
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
                  <label className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-0.5 w-3 rounded-full bg-blue-600" />
                      Links
                    </span>
                    <Switch checked={showLinks} onCheckedChange={setShowLinks} />
                  </label>
                  {showLinks && !resultsSymbology && (
                    <div className="ml-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-0.5 w-2.5 rounded-full bg-[#1d4ed8]" />
                        Conduit
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-0.5 w-2.5 rounded-full bg-[#db2777]" />
                        Pump
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-0.5 w-2.5 rounded-full bg-[#7c3aed]" />
                        Orifice
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-0.5 w-2.5 rounded-full bg-[#ca8a04]" />
                        Weir
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-0.5 w-2.5 rounded-full bg-[#ea580c]" />
                        Outlet
                      </span>
                    </div>
                  )}
                  {showLinks && resultsSymbology && (
                    <p className="ml-1 text-[11px] text-muted">
                      Links colored by flow magnitude
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
                      <span className="h-2.5 w-2.5 rotate-45 bg-emerald-400 ring-1 ring-black/80" />
                      Storage
                    </span>
                    <Switch checked={showStorage} onCheckedChange={setShowStorage} />
                  </label>
                  <BackgroundLayersPanel projectPath={projectPath} />
                </div>
              </Panel>
              <Panel title="Basemap">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={basemap === 'osm' ? 'primary' : 'outline'}
                    onClick={() => setBasemap('osm')}
                  >
                    OSM
                  </Button>
                  <Button
                    size="sm"
                    variant={basemap === 'projected' ? 'primary' : 'outline'}
                    onClick={() => setBasemap('projected')}
                  >
                    Grid
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted">CRS EPSG:25832</p>
              </Panel>
              <RunPanel compact />
              <Panel
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Mountain className="h-3.5 w-3.5" /> Profile
                  </span>
                }
              >
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span>Show under map</span>
                  <Switch checked={showProfile} onCheckedChange={setShowProfile} />
                </label>
                <p className="mt-2 text-[11px] text-muted">
                  Pick start/end on the map, then scrub time or hit Peak for water and HGL.
                </p>
              </Panel>
            </>
          )}
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col bg-surface">
          <div className="relative min-h-0 flex-1">
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
            {network.data && (
              <NetworkMap
                network={network.data}
                basemap={basemap}
                showSubcatchments={showSubcatchments}
                showLinks={showLinks}
                showJunctions={showJunctions}
                showOutfalls={showOutfalls}
                showStorage={showStorage}
                backgroundLayers={gisLayers.data?.layers ?? []}
                selection={selection}
                onSelect={setSelection}
                snapshot={snapshot.data}
                resultsSymbology={resultsSymbology && symbology.hasSnapshot}
                profileNodeIds={profile.data?.path_node_ids}
                profileLinkIds={profile.data?.path_link_ids}
                profilePickMode={pickMode}
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
              />
            )}
            <MapToolbar
              mode={drawMode}
              onModeChange={(m) => {
                setDrawMode(m)
                setPendingLinkFromId(null)
                setPolygonDraft([])
                if (m !== 'select') setPickMode(null)
              }}
              linkKind={linkDrawKind}
              onLinkKindChange={setLinkDrawKind}
              hint={drawHint(drawMode, pendingLinkFromId, polygonDraft.length, linkDrawKind)}
              onZoomExtent={() => setFitExtentNonce((n) => n + 1)}
              onUndo={() => void performUndo()}
              canUndo={undoStack.length > 0}
            />
            <MapLegend
              depthMax={symbology.depthMax}
              flowMax={symbology.flowMax}
              runoffMax={symbology.runoffMax}
              hasSnapshot={symbology.hasSnapshot}
              resultsSymbology={resultsSymbology && symbology.hasSnapshot}
            />
            <button
              type="button"
              className="absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-lg border border-l-0 border-border bg-elevated/90 p-1 text-muted hover:text-fg"
              onClick={() => setLayersOpen((v) => !v)}
              aria-label="Toggle layers"
            >
              {layersOpen ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="max-h-[46%] min-h-0 overflow-auto border-t border-border bg-elevated/80 p-3">
            {periods.isError && (
              <p className="mb-2 text-xs text-danger">
                Could not load results: {(periods.error as Error).message}
              </p>
            )}
            {project.data?.has_out && periods.isLoading && (
              <p className="mb-2 text-xs text-muted">Loading existing results…</p>
            )}
            <TimeSlider
              period={period}
              periodCount={periods.data?.period_count ?? 0}
              timeLabel={timeLabel}
              onChange={setPeriod}
              hasExistingOut={Boolean(project.data?.has_out)}
              peakPeriod={periods.data?.peak_depth_period ?? null}
              peakTime={periods.data?.peak_time ?? null}
              peakDepthMax={periods.data?.peak_depth_max ?? null}
            />
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
                />
              </div>
            )}
            {selection && (
              <div className="mt-2">
                <TimeSeriesChart
                  series={series.data}
                  yLabel={
                    selection.object_type === 'node'
                      ? 'Depth'
                      : selection.object_type === 'link'
                        ? 'Flow'
                        : 'Runoff'
                  }
                />
              </div>
            )}
          </div>
        </main>

        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-auto border-l border-border bg-elevated/30 p-3">
          <ObjectInspector
            selection={selection}
            onSaved={invalidateNetwork}
            onDeleteRequest={requestDelete}
          />
          {!runStatus || runStatus.status === 'idle' ? (
            <p className="px-1 text-xs text-muted">
              <Play className="mr-1 inline h-3 w-3" />
              Use the Simulation panel to run OpenSWMM locally.
            </p>
          ) : null}
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
