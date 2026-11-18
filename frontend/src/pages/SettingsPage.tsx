import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Map as MapIcon, Settings2 } from 'lucide-react'
import { api, type TwoDBoundaryItem } from '../api/client'
import { EnginePanel } from '../components/EnginePanel'
import { setPref, usePref } from '../lib/prefs'
import { Button, Panel, Switch, useToast } from '../components/ui'
import {
  clearMeshAoi,
  getMeshSettings,
  patchMeshSettings,
  subscribeMeshSettings,
} from '../lib/meshSettingsStore'
import {
  getLiveRendering,
  setLiveRendering,
  subscribeLiveRendering,
} from '../lib/liveRenderingStore'

function toLocalInput(date?: string | null, time?: string | null): string {
  if (!date) return ''
  const dp = date.replace(/-/g, '/').split('/')
  let y = 0
  let m = 0
  let d = 0
  if (dp.length === 3) {
    if (dp[0].length === 4) {
      y = Number(dp[0])
      m = Number(dp[1])
      d = Number(dp[2])
    } else {
      m = Number(dp[0])
      d = Number(dp[1])
      y = Number(dp[2])
    }
  }
  if (!y || !m || !d) return ''
  const tp = (time || '00:00:00').split(':')
  const hh = String(Number(tp[0] || 0)).padStart(2, '0')
  const mi = String(Number(tp[1] || 0)).padStart(2, '0')
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${mi}`
}

function fromLocalInput(value: string): { date: string; time: string } | null {
  if (!value) return null
  const [datePart, timePart] = value.split('T')
  if (!datePart || !timePart) return null
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mi] = timePart.split(':').map(Number)
  if (!y || !m || !d) return null
  return {
    date: `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
    time: `${String(hh || 0).padStart(2, '0')}:${String(mi || 0).padStart(2, '0')}:00`,
  }
}

export function SettingsPage({ projectPath }: { projectPath: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const showAudio = usePref('show-broadcast-audio') === '1'
  const mesh = useSyncExternalStore(subscribeMeshSettings, getMeshSettings, getMeshSettings)
  const liveRendering = useSyncExternalStore(
    subscribeLiveRendering,
    getLiveRendering,
    getLiveRendering,
  )

  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [threads, setThreads] = useState(1)
  const [reportStep, setReportStep] = useState('00:05:00')
  const [routingStep, setRoutingStep] = useState('0:00:30')
  const [flowRouting, setFlowRouting] = useState('DYNWAVE')

  const [report2d, setReport2d] = useState(true)
  const [dryDepth, setDryDepth] = useState('0.001')
  const [maxTs, setMaxTs] = useState('5')
  const [minTs, setMinTs] = useState('0.001')
  const [relTol, setRelTol] = useState('0.001')
  const [absTol, setAbsTol] = useState('0.00001')
  /** Optional bed slope for NORMAL_FLOW BCs (blank = engine auto from mesh). */
  const [normalBcSlope, setNormalBcSlope] = useState('')
  const [pendingNormalBcItems, setPendingNormalBcItems] = useState<TwoDBoundaryItem[] | null>(
    null,
  )

  const windowQ = useQuery({
    queryKey: ['simulation-window'],
    queryFn: api.getSimulationWindow,
  })

  const twodOpts = useQuery({
    queryKey: ['2d-options'],
    queryFn: api.getTwoDOptions,
  })

  const twodInfo = useQuery({
    queryKey: ['2d-info', projectPath],
    queryFn: api.getTwoDInfo,
    retry: false,
  })

  const twodBoundaries = useQuery({
    queryKey: ['2d-boundaries', projectPath],
    queryFn: () => api.getTwoDBoundaries(),
    enabled: Boolean(twodInfo.data?.has_mesh),
    retry: false,
  })

  const gisLayers = useQuery({
    queryKey: ['gis-layers', projectPath],
    queryFn: api.listGisLayers,
  })

  const demLayers = useMemo(
    () => (gisLayers.data?.layers ?? []).filter((l) => l.type === 'dem'),
    [gisLayers.data?.layers],
  )

  const cpuCount = Math.max(1, windowQ.data?.cpu_count ?? 1)

  useEffect(() => {
    if (!windowQ.data) return
    setStartLocal(toLocalInput(windowQ.data.start_date, windowQ.data.start_time))
    setEndLocal(toLocalInput(windowQ.data.end_date, windowQ.data.end_time))
    setThreads(typeof windowQ.data.threads === 'number' ? windowQ.data.threads : 1)
    setReportStep(windowQ.data.report_step || '00:05:00')
    setRoutingStep(windowQ.data.routing_step || '0:00:30')
    setFlowRouting((windowQ.data.flow_routing || 'DYNWAVE').toUpperCase())
  }, [windowQ.data])

  useEffect(() => {
    if (!twodOpts.data) return
    const d = twodOpts.data.defaults
    setReport2d(Boolean(twodOpts.data.report_2d))
    setDryDepth(String(twodOpts.data.dry_depth ?? d?.dry_depth ?? 0.001))
    setMaxTs(String(twodOpts.data.max_timestep ?? d?.max_timestep ?? 10))
    setMinTs(String(twodOpts.data.min_timestep ?? d?.min_timestep ?? 0.001))
    setRelTol(String(twodOpts.data.rel_tolerance ?? d?.rel_tolerance ?? 0.005))
    setAbsTol(String(twodOpts.data.abs_tolerance ?? d?.abs_tolerance ?? 0.0001))
  }, [twodOpts.data])

  useEffect(() => {
    if (!mesh.demId && demLayers.length > 0) {
      patchMeshSettings({ demId: demLayers[0].id })
    }
  }, [demLayers, mesh.demId])

  const saveSwmm = useMutation({
    mutationFn: async () => {
      const s = fromLocalInput(startLocal)
      const e = fromLocalInput(endLocal)
      if (!s || !e) throw new Error('Enter valid start and end date/time')
      return api.setSimulationWindow({
        start_date: s.date,
        start_time: s.time,
        end_date: e.date,
        end_time: e.time,
        sync_report_start: true,
        threads,
        report_step: reportStep.trim(),
        routing_step: routingStep.trim(),
        flow_routing: flowRouting,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      toast({ title: 'SWMM options saved', tone: 'success' })
    },
    onError: (err) =>
      toast({ title: 'Save failed', description: (err as Error).message, tone: 'danger' }),
  })

  const save2d = useMutation({
    mutationFn: () =>
      api.setTwoDOptions({
        report_2d: report2d,
        dry_depth: Number(dryDepth),
        max_timestep: Number(maxTs),
        min_timestep: Number(minTs),
        rel_tolerance: Number(relTol),
        abs_tolerance: Number(absTol),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['2d-options'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      toast({ title: '2D solver options saved', tone: 'success' })
    },
    onError: (err) =>
      toast({ title: 'Save failed', description: (err as Error).message, tone: 'danger' }),
  })

  const saveBoundaries = useMutation({
    mutationFn: (items: TwoDBoundaryItem[]) =>
      api.writeTwoDBoundaries({ items, write_defaults: false }),
    onSuccess: (_res, items) => {
      setPendingNormalBcItems(null)
      void queryClient.invalidateQueries({ queryKey: ['2d-boundaries'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      toast({
        title: 'Boundary conditions saved',
        description: `${items.length.toLocaleString()} edges written as Normal flow`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Could not save boundaries',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const buildAllNormalFlowItems = (): TwoDBoundaryItem[] => {
    const features = twodBoundaries.data?.geojson?.features
    if (!features?.length) {
      throw new Error('No open mesh boundary edges found. Generate a 2D mesh first.')
    }
    const slopeRaw = normalBcSlope.trim()
    let param1: number | null = null
    if (slopeRaw !== '') {
      const n = Number(slopeRaw)
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('Bed slope must be a non-negative number (or leave blank for auto).')
      }
      param1 = n
    }
    return features.map((f) => {
      const p = f.properties ?? {}
      return {
        triangle_index: Number(p.triangle_index),
        edge: Number(p.edge),
        bc_type: 'NORMAL_FLOW',
        param1,
        param2: null,
        group: null,
      }
    })
  }

  const meshEstimate = useMemo(() => {
    const poly = mesh.aoiPolygon
    if (!poly || poly.length < 3 || mesh.cellSize <= 0) return null
    const xs = poly.map((p) => p[0])
    const ys = poly.map((p) => p[1])
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    if (w <= 0 || h <= 0) return null
    const nx = Math.floor(w / mesh.cellSize) + 1
    const ny = Math.floor(h / mesh.cellSize) + 1
    if (nx < 2 || ny < 2) return { nx, ny, triangles: 0, tooSmall: true as const }
    return {
      nx,
      ny,
      triangles: (nx - 1) * (ny - 1) * 2,
      tooSmall: false as const,
    }
  }, [mesh.aoiPolygon, mesh.cellSize])

  const previewMesh = useMutation({
    mutationFn: () => {
      if (!mesh.aoiPolygon || mesh.aoiPolygon.length < 3) {
        throw new Error('Draw a polygon AOI on the Map first (grid tool)')
      }
      return api.previewTwoDMesh({
        polygon: mesh.aoiPolygon,
        cell_size: mesh.cellSize,
        dem_layer_id: mesh.demId || null,
        mannings_n: mesh.mannings,
      })
    },
    onSuccess: (data) => {
      patchMeshSettings({ preview: data })
      toast({
        title: 'Mesh preview',
        description: `${data.counts.triangles.toLocaleString()} triangles`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({ title: 'Preview failed', description: (err as Error).message, tone: 'danger' }),
  })

  const generateMesh = useMutation({
    mutationFn: () => {
      if (!mesh.aoiPolygon || mesh.aoiPolygon.length < 3) {
        throw new Error('Draw a polygon AOI on the Map first (grid tool)')
      }
      return api.generateTwoDMesh({
        polygon: mesh.aoiPolygon,
        cell_size: mesh.cellSize,
        dem_layer_id: mesh.demId || null,
        mannings_n: mesh.mannings,
        replace: true,
      })
    },
    onSuccess: (data) => {
      patchMeshSettings({ preview: null })
      void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-mesh'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-options'] })
      void queryClient.invalidateQueries({ queryKey: ['network'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      toast({
        title: '2D mesh written to INP',
        description: `${Number(data.info.triangle_count).toLocaleString()} triangles`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({ title: 'Generate failed', description: (err as Error).message, tone: 'danger' }),
  })

  const threadOptions: { value: number; label: string }[] = [
    { value: 0, label: `All cores (${cpuCount})` },
    { value: 1, label: '1 (serial)' },
    ...Array.from({ length: Math.max(0, cpuCount - 1) }, (_, i) => {
      const n = i + 2
      return { value: n, label: String(n) }
    }),
  ]
  if (threads > cpuCount) {
    threadOptions.push({ value: threads, label: `${threads} (from INP)` })
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h1 className="m-0 flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Settings2 className="h-5 w-5 text-slate-400" />
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted">
            Simulation engine, window, steps, threads, 2D solver, and meshing. Apply writes to
            the INP. Draw the mesh AOI on the{' '}
            <Link to="/map" className="text-accent-soft underline-offset-2 hover:underline">
              Map
            </Link>
            , then Run from the Map simulation panel.
          </p>
        </div>

        <EnginePanel projectPath={projectPath} />

        <Panel title="Extras">
          <label className="flex items-center justify-between gap-3 text-sm text-fg-soft">
            <span>
              Broadcast audio
              <span className="block text-xs text-muted">
                Adds a radio/music control to the sidebar, for presenting runs.
              </span>
            </span>
            <Switch
              checked={showAudio}
              onCheckedChange={(v) => setPref('show-broadcast-audio', v ? '1' : '0')}
            />
          </label>
        </Panel>

        <Panel title="SWMM options">
          <label className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span className="pr-2">
              Live rendering while running
              <span className="mt-0.5 block text-[11px] font-normal text-muted">
                Paint current solver state on the map during a run (1D always; 2D when the
                solver exposes surface depths). Off by default for performance. Applies on the
                next Run.
              </span>
            </span>
            <Switch checked={liveRendering} onCheckedChange={setLiveRendering} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              Start
              <input
                type="datetime-local"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted">
              End
              <input
                type="datetime-local"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={endLocal}
                onChange={(e) => setEndLocal(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted">
              Report step
              <input
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={reportStep}
                onChange={(e) => setReportStep(e.target.value)}
                placeholder="00:05:00"
                spellCheck={false}
              />
            </label>
            <label className="block text-xs text-muted">
              Routing step
              <input
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={routingStep}
                onChange={(e) => setRoutingStep(e.target.value)}
                placeholder="0:00:30"
                spellCheck={false}
              />
            </label>
            <label className="block text-xs text-muted">
              Flow routing
              <select
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={flowRouting}
                onChange={(e) => setFlowRouting(e.target.value)}
              >
                <option value="DYNWAVE">DYNWAVE</option>
                <option value="KINWAVE">KINWAVE</option>
                <option value="STEADY">STEADY</option>
              </select>
            </label>
            <label className="block text-xs text-muted">
              Threads
              <select
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={threads}
                onChange={(e) => setThreads(Number(e.target.value))}
              >
                {threadOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Machine reports {cpuCount} logical CPU{cpuCount === 1 ? '' : 's'}. THREADS 0 uses all
            cores (1D and 2D).
          </p>
          <Button
            size="sm"
            variant="primary"
            className="mt-3"
            disabled={saveSwmm.isPending}
            onClick={() => saveSwmm.mutate()}
          >
            {saveSwmm.isPending ? 'Saving…' : 'Apply to INP'}
          </Button>
        </Panel>

        <Panel title="2D solver options">
          <p className="mb-3 text-[11px] text-muted">
            Written to [2D_OPTIONS]. Does not rebuild the mesh.
            {twodOpts.data?.has_mesh
              ? ` Output: ${twodOpts.data.output_file ?? '—'}`
              : ' No mesh in INP yet.'}{' '}
            Length unit:{' '}
            <span className="text-fg-soft">
              {twodOpts.data?.length_unit ?? 'm'}
              {twodOpts.data?.flow_units ? ` (FLOW_UNITS ${twodOpts.data.flow_units})` : ''}
            </span>
            . Defaults favor faster runtimes.
          </p>
          <label className="mb-3 flex items-center justify-between gap-2 text-sm">
            <span>Report 2D (HDF5)</span>
            <Switch checked={report2d} onCheckedChange={setReport2d} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              Dry depth ({twodOpts.data?.length_unit ?? 'm'})
              <input
                type="number"
                step="any"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={dryDepth}
                onChange={(e) => setDryDepth(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted">
              Max timestep (s)
              <input
                type="number"
                step="any"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={maxTs}
                onChange={(e) => setMaxTs(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted">
              Min timestep (s)
              <input
                type="number"
                step="any"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={minTs}
                onChange={(e) => setMinTs(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted">
              Rel. tolerance
              <input
                type="number"
                step="any"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={relTol}
                onChange={(e) => setRelTol(e.target.value)}
              />
            </label>
            <label className="block text-xs text-muted">
              Abs. tolerance ({twodOpts.data?.length_unit ?? 'm'})
              <input
                type="number"
                step="any"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                value={absTol}
                onChange={(e) => setAbsTol(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={save2d.isPending}
              onClick={() => save2d.mutate()}
            >
              {save2d.isPending ? 'Saving…' : 'Apply to INP'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!twodOpts.data?.defaults || save2d.isPending}
              onClick={() => {
                const d = twodOpts.data?.defaults
                if (!d) return
                setReport2d(Boolean(d.report_2d))
                setDryDepth(String(d.dry_depth))
                setMaxTs(String(d.max_timestep))
                setMinTs(String(d.min_timestep))
                setRelTol(String(d.rel_tolerance))
                setAbsTol(String(d.abs_tolerance))
              }}
            >
              Reset to fast defaults
            </Button>
          </div>
        </Panel>

        <Panel title="2D boundary conditions">
          <p className="mb-3 text-[11px] text-muted">
            Set every open mesh edge to <span className="text-fg-soft">Normal flow</span> (water
            leaves following bed slope). OpenSWMM does <span className="text-fg-soft">not</span>{' '}
            take Manning&apos;s n on the boundary — n lives on mesh triangles. Param1 is optional
            bed slope; leave blank to auto-compute from the mesh DEM/geometry.
            {twodInfo.data?.has_mesh
              ? ` ${(
                  twodBoundaries.data?.count ??
                  twodInfo.data.boundary_edge_count ??
                  0
                ).toLocaleString()} open edges.`
              : ' No mesh yet — generate one under 2D meshing first.'}
          </p>
          <label className="mb-3 block text-xs text-muted">
            Bed slope for Normal flow (optional)
            <input
              type="number"
              step="any"
              min={0}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
              value={normalBcSlope}
              onChange={(e) => setNormalBcSlope(e.target.value)}
              placeholder="blank = auto from mesh"
              disabled={!twodInfo.data?.has_mesh}
            />
          </label>
          {pendingNormalBcItems && (
            <p className="mb-2 text-[11px] text-accent-soft">
              Ready to save: {pendingNormalBcItems.length.toLocaleString()} edges → Normal flow
              {normalBcSlope.trim()
                ? ` (slope ${normalBcSlope.trim()})`
                : ' (auto slope)'}
              . Click Save to write the INP.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={
                !twodInfo.data?.has_mesh ||
                twodBoundaries.isLoading ||
                !(twodBoundaries.data?.geojson?.features?.length)
              }
              onClick={() => {
                try {
                  const items = buildAllNormalFlowItems()
                  setPendingNormalBcItems(items)
                  toast({
                    title: 'All edges set to Normal flow',
                    description: `${items.length.toLocaleString()} edges staged — click Save to write the INP.`,
                    tone: 'success',
                  })
                } catch (err) {
                  toast({
                    title: 'Could not set boundaries',
                    description: (err as Error).message,
                    tone: 'danger',
                  })
                }
              }}
            >
              Set all to Normal flow
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!pendingNormalBcItems?.length || saveBoundaries.isPending}
              onClick={() => {
                if (!pendingNormalBcItems?.length) return
                saveBoundaries.mutate(pendingNormalBcItems)
              }}
            >
              {saveBoundaries.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Panel>

        <Panel title="2D meshing">
          <p className="mb-3 text-[11px] text-muted">
            <MapIcon className="mr-1 inline h-3 w-3" />
            Use the map grid tool to draw an AOI, then Preview / Apply here.
            {mesh.aoiPolygon
              ? ` AOI ready (${mesh.aoiPolygon.length} vertices).`
              : ' No AOI yet.'}
          </p>
          {demLayers.length === 0 ? (
            <p className="text-[11px] text-muted">
              Add a DEM under Map → Background GIS before generating a mesh.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <label className="block text-[11px] text-muted">
                DEM
                <select
                  className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg"
                  value={mesh.demId}
                  onChange={(e) => patchMeshSettings({ demId: e.target.value })}
                >
                  {demLayers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] text-muted">
                Cell size
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg"
                  value={mesh.cellSize}
                  onChange={(e) =>
                    patchMeshSettings({ cellSize: Number(e.target.value) || 1 })
                  }
                />
              </label>
              <label className="block text-[11px] text-muted">
                Manning&apos;s n
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-xs text-fg"
                  value={mesh.mannings}
                  onChange={(e) =>
                    patchMeshSettings({ mannings: Number(e.target.value) || 0.03 })
                  }
                />
              </label>
              {meshEstimate && (
                <p className="text-[11px] text-muted">
                  {meshEstimate.tooSmall
                    ? 'AOI too small for this cell size'
                    : `≤${meshEstimate.triangles.toLocaleString()} triangles before clip (${meshEstimate.nx}×${meshEstimate.ny} verts)`}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!mesh.aoiPolygon || previewMesh.isPending}
                  onClick={() => previewMesh.mutate()}
                >
                  Preview
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  className="flex-1"
                  disabled={
                    !mesh.aoiPolygon ||
                    generateMesh.isPending ||
                    Boolean(meshEstimate?.tooSmall) ||
                    (meshEstimate != null && meshEstimate.triangles > 100_000)
                  }
                  onClick={() => {
                    if (twodInfo.data?.has_mesh) {
                      const ok = window.confirm(
                        'Replace the existing 2D mesh in the INP file?',
                      )
                      if (!ok) return
                    }
                    generateMesh.mutate()
                  }}
                >
                  Apply
                </Button>
              </div>
              {(mesh.preview || mesh.aoiPolygon || mesh.aoiDraft.length > 0) && (
                <Button size="sm" variant="outline" className="w-full" onClick={() => clearMeshAoi()}>
                  Clear preview / AOI
                </Button>
              )}
              {mesh.preview?.warnings?.length ? (
                <p className="text-[10px] text-amber-700 dark:text-amber-400">
                  {mesh.preview.warnings.join(' · ')}
                </p>
              ) : null}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
