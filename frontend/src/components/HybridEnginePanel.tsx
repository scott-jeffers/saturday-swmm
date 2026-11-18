/**
 * Settings panel: pick OpenSWMM vs PySWMM+Basilisk, edit surface/coupling, build.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Link2, Mountain, Waves } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  type HybridCoupling,
  type HybridCouplingPoint,
  type HybridSurface,
  type SimulationEngine,
} from '../api/client'
import { Button, Panel, useToast } from './ui'

const DEFAULT_SURFACE: HybridSurface = {
  domain_polygon: [],
  mannings_n: 0.03,
  dry_depth: 0.001,
  max_level: 10,
  min_level: 5,
  eta_tolerance: 0.01,
  velocity_tolerance: 0.05,
  rainfall_mode: 'subcatchments',
}

export function HybridEnginePanel({ projectPath }: { projectPath: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const project = useQuery({
    queryKey: ['project', projectPath],
    queryFn: api.currentProject,
  })

  const caps = useQuery({
    queryKey: ['hybrid-capabilities'],
    queryFn: api.getHybridCapabilities,
  })

  const hybridInfo = useQuery({
    queryKey: ['hybrid-info', projectPath],
    queryFn: api.getHybridInfo,
  })

  const engine: SimulationEngine = project.data?.simulation_engine ?? 'openswmm'
  const [surface, setSurface] = useState<HybridSurface>(DEFAULT_SURFACE)
  const [coupling, setCoupling] = useState<HybridCoupling>({ points: [] })
  const [newNodeId, setNewNodeId] = useState('')
  const [newX, setNewX] = useState('')
  const [newY, setNewY] = useState('')
  const [polygonText, setPolygonText] = useState('')

  useEffect(() => {
    if (hybridInfo.data?.surface) setSurface(hybridInfo.data.surface)
    if (hybridInfo.data?.coupling) setCoupling(hybridInfo.data.coupling)
  }, [hybridInfo.data])

  useEffect(() => {
    const ring = surface.domain_polygon ?? []
    setPolygonText(ring.map((p) => `${p[0]},${p[1]}`).join('\n'))
  }, [surface.domain_polygon])

  const setEngineMut = useMutation({
    mutationFn: (eng: SimulationEngine) => api.setSimulationEngine(eng),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      toast({ title: 'Simulation engine updated', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: e.message, tone: 'danger' }),
  })

  const saveSurfaceMut = useMutation({
    mutationFn: () => {
      const ring: number[][] = []
      for (const line of polygonText.split('\n')) {
        const t = line.trim()
        if (!t) continue
        const parts = t.split(/[,;\s]+/).map(Number)
        if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
          ring.push([parts[0]!, parts[1]!])
        }
      }
      const body: HybridSurface = { ...surface, domain_polygon: ring }
      return api.setHybridSurface(body)
    },
    onSuccess: (s) => {
      setSurface(s)
      void queryClient.invalidateQueries({ queryKey: ['hybrid-info'] })
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      toast({ title: 'Hybrid surface saved', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: e.message, tone: 'danger' }),
  })

  const saveCouplingMut = useMutation({
    mutationFn: () => api.setHybridCoupling(coupling),
    onSuccess: (c) => {
      setCoupling(c)
      void queryClient.invalidateQueries({ queryKey: ['hybrid-info'] })
      toast({ title: 'Coupling saved', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: e.message, tone: 'danger' }),
  })

  const buildMut = useMutation({
    mutationFn: api.buildHybridBasilisk,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['hybrid-info'] })
      toast({
        title: r.ok ? (r.used_stub ? 'Stub ready (no qcc)' : 'Basilisk built') : 'Build failed',
        description: r.message,
        tone: r.ok ? 'success' : 'danger',
      })
    },
    onError: (e: Error) => toast({ title: e.message, tone: 'danger' }),
  })

  const bootstrapMut = useMutation({
    mutationFn: api.bootstrapHybrid,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['hybrid-info'] })
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      void queryClient.invalidateQueries({ queryKey: ['hybrid-mesh'] })
      void queryClient.invalidateQueries({ queryKey: ['hybrid-periods'] })
      toast({
        title: r.ok ? 'Hybrid model prepared' : 'Prepare failed',
        description: `${r.message}${r.used_stub ? ' (Python stub — qcc optional)' : ''}`,
        tone: r.ok ? 'success' : 'danger',
      })
    },
    onError: (e: Error) => toast({ title: e.message, tone: 'danger' }),
  })

  const addPoint = () => {
    const nid = newNodeId.trim()
    const x = Number(newX)
    const y = Number(newY)
    if (!nid || !Number.isFinite(x) || !Number.isFinite(y)) {
      toast({ title: 'Need node id and x,y', tone: 'danger' })
      return
    }
    if (coupling.points.some((p) => p.node_id === nid)) {
      toast({ title: `Already coupled: ${nid}`, tone: 'danger' })
      return
    }
    const pt: HybridCouplingPoint = { node_id: nid, x, y, cd: 0.67, exchange_area: 1 }
    setCoupling({ points: [...coupling.points, pt] })
    setNewNodeId('')
    setNewX('')
    setNewY('')
  }

  const removePoint = (nodeId: string) => {
    setCoupling({ points: coupling.points.filter((p) => p.node_id !== nodeId) })
  }

  const c = caps.data

  return (
    <>
      <Panel title="Simulation engine">
        <p className="mb-3 text-xs text-muted">
          OpenSWMM is the default (1D + built-in 2D). Hybrid uses EPA SWMM via PySWMM for
          hydrology and Basilisk for AMR overland flow at coupling points (Option B). DEM
          flow accumulation skips SWMM entirely and builds FEMA-style floodplain polygons
          from the project DEM (HAND).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={engine === 'openswmm' ? 'primary' : 'outline'}
            size="sm"
            disabled={setEngineMut.isPending}
            onClick={() => setEngineMut.mutate('openswmm')}
          >
            OpenSWMM
          </Button>
          <Button
            type="button"
            variant={engine === 'hybrid' ? 'primary' : 'outline'}
            size="sm"
            disabled={setEngineMut.isPending}
            onClick={() => setEngineMut.mutate('hybrid')}
          >
            <Box className="mr-1 h-3.5 w-3.5" />
            PySWMM + Basilisk
          </Button>
          <Button
            type="button"
            variant={engine === 'flow_accum' ? 'primary' : 'outline'}
            size="sm"
            disabled={setEngineMut.isPending}
            onClick={() => setEngineMut.mutate('flow_accum')}
          >
            <Waves className="mr-1 h-3.5 w-3.5" />
            DEM flow accumulation
          </Button>
        </div>
        {engine === 'flow_accum' && (
          <p className="mt-3 text-[11px] text-muted">
            Run fills the DEM, traces streams from flow accumulation, and floods valley
            floors with Height Above Nearest Drainage (HAND). Results are solid floodplain
            polygons you can use like a FEMA zone map. No SWMM or 2D solver. A DEM layer is
            required.
          </p>
        )}
        {c && engine === 'hybrid' && (
          <p className="mt-3 text-[11px] text-muted">
            {c.message}
            {c.wsl_recommended ? ' WSL2 recommended for Basilisk on Windows.' : ''}
          </p>
        )}
        {c && engine === 'openswmm' && (
          <p className="mt-3 text-[11px] text-muted">{c.message}</p>
        )}
      </Panel>

      {engine === 'hybrid' && (
        <>
          <Panel title="Quick prepare">
            <p className="mb-2 text-xs text-muted">
              One click builds a domain from the network bounding box (+10%), couples junctions
              and storage (up to 500), compiles the surface model (stub when{' '}
              <code className="text-[10px]">qcc</code> is missing), and sanitizes the INP. Run
              from the map header does the same automatically.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={bootstrapMut.isPending}
              onClick={() => bootstrapMut.mutate()}
            >
              <Box className="mr-1 h-3.5 w-3.5" />
              Prepare hybrid model
            </Button>
            {bootstrapMut.data && (
              <p className="mt-2 text-[11px] text-muted">
                {bootstrapMut.data.coupling_count} couplings
                {bootstrapMut.data.domain_auto ? ' · auto domain' : ''}
                {bootstrapMut.data.used_stub ? ' · stub 2D' : ' · Basilisk binary'}
              </p>
            )}
          </Panel>

          <Panel title="Surface (Basilisk)">
            <p className="mb-2 text-xs text-muted">
              Rain falls on SWMM{' '}
              <Link to="/storm" className="text-accent-soft underline-offset-2 hover:underline">
                subcatchments
              </Link>
              ; Basilisk handles street / floodplain exchange at coupled manholes. Optional:
              override the auto domain polygon (project CRS x,y per line).
            </p>
            <label className="mb-2 block text-xs text-muted">
              Domain polygon (x,y per line)
              <textarea
                className="mt-1 block h-28 w-full rounded-lg border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg"
                value={polygonText}
                onChange={(e) => setPolygonText(e.target.value)}
                placeholder={'1000,2000\n1200,2000\n1200,2200\n1000,2200'}
              />
            </label>
            <div className="mb-2 grid gap-2 sm:grid-cols-3">
              <label className="block text-xs text-muted">
                Manning n
                <input
                  type="number"
                  step="0.001"
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={surface.mannings_n}
                  onChange={(e) =>
                    setSurface((s) => ({ ...s, mannings_n: Number(e.target.value) || 0.03 }))
                  }
                />
              </label>
              <label className="block text-xs text-muted">
                Max AMR level
                <input
                  type="number"
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={surface.max_level}
                  onChange={(e) =>
                    setSurface((s) => ({ ...s, max_level: Number(e.target.value) || 10 }))
                  }
                />
              </label>
              <label className="block text-xs text-muted">
                Dry depth (m)
                <input
                  type="number"
                  step="0.0001"
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={surface.dry_depth}
                  onChange={(e) =>
                    setSurface((s) => ({ ...s, dry_depth: Number(e.target.value) || 0.001 }))
                  }
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saveSurfaceMut.isPending}
                onClick={() => saveSurfaceMut.mutate()}
              >
                <Mountain className="mr-1 h-3.5 w-3.5" />
                Save surface
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={buildMut.isPending}
                onClick={() => buildMut.mutate()}
              >
                Compile surface model
              </Button>
            </div>
            {hybridInfo.data?.build_log_tail && (
              <pre className="mt-2 max-h-24 overflow-auto rounded border border-border bg-elevated/50 p-2 text-[10px] text-muted">
                {hybridInfo.data.build_log_tail}
              </pre>
            )}
          </Panel>

          <Panel title="1D–2D coupling">
            <p className="mb-2 text-xs text-muted">
              Link junctions to the Basilisk surface (same idea as OpenSWMM vertex–node map).
              Coordinates are project CRS.
            </p>
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-muted">
                Node ID
                <input
                  className="mt-1 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={newNodeId}
                  onChange={(e) => setNewNodeId(e.target.value)}
                />
              </label>
              <label className="text-xs text-muted">
                X
                <input
                  className="mt-1 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={newX}
                  onChange={(e) => setNewX(e.target.value)}
                />
              </label>
              <label className="text-xs text-muted">
                Y
                <input
                  className="mt-1 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                  value={newY}
                  onChange={(e) => setNewY(e.target.value)}
                />
              </label>
              <Button type="button" size="sm" variant="outline" onClick={addPoint}>
                <Link2 className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {coupling.points.length === 0 ? (
              <p className="text-xs text-muted">No coupling points yet.</p>
            ) : (
              <ul className="mb-2 space-y-1 text-xs">
                {coupling.points.map((p) => (
                  <li
                    key={p.node_id}
                    className="flex items-center justify-between rounded border border-border px-2 py-1"
                  >
                    <span>
                      <span className="font-medium text-fg">{p.node_id}</span>
                      <span className="text-muted">
                        {' '}
                        · {p.x.toFixed(1)}, {p.y.toFixed(1)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-danger hover:underline"
                      onClick={() => removePoint(p.node_id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              size="sm"
              disabled={saveCouplingMut.isPending}
              onClick={() => saveCouplingMut.mutate()}
            >
              Save coupling
            </Button>
          </Panel>
        </>
      )}
    </>
  )
}
