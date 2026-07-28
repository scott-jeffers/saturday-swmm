import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  RefreshCw,
  ServerCrash,
  Undo2,
} from 'lucide-react'
import { api, type SystemHealth } from '../api/client'
import { Badge, Button, useToast } from './ui'
import { cn } from '../lib/cn'

const GIS_KEYS: (keyof SystemHealth['gis'])[] = [
  'rasterio',
  'pyogrio',
  'shapely',
  'pyproj',
  'pillow',
  'geopandas',
]

function Row({
  label,
  ok,
  detail,
  warn,
}: {
  label: string
  ok: boolean
  detail: string
  warn?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span
        className={cn(
          'text-right text-xs leading-snug',
          ok && !warn ? 'text-fg-soft' : warn ? 'text-warning' : 'text-danger',
        )}
      >
        {detail}
      </span>
    </div>
  )
}

export function SystemStatusCard() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState('')

  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: false,
  })

  const engine = useQuery({
    queryKey: ['engine-status'],
    queryFn: api.getEngineStatus,
    enabled: !health.isError,
    retry: false,
  })

  const check = useMutation({
    mutationFn: api.checkEngineUpdates,
    onSuccess: (data) => {
      void queryClient.setQueryData(['engine-status'], data)
      if (data.latest) setSelectedVersion(data.latest)
      toast({
        title: data.update_available
          ? `Update available: OpenSWMM ${data.latest}`
          : 'OpenSWMM is up to date',
        description: data.installed_version
          ? `Installed ${data.installed_version}`
          : undefined,
        tone: data.update_available ? 'default' : 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Could not check PyPI',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const update = useMutation({
    mutationFn: (version?: string) => api.updateEngine(version),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['engine-status'] })
      void queryClient.invalidateQueries({ queryKey: ['system-health'] })
      toast({
        title: data.changed ? 'OpenSWMM updated' : 'No change',
        description: data.message,
        tone: data.restart_required ? 'default' : 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Update failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const rollback = useMutation({
    mutationFn: api.rollbackEngine,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['engine-status'] })
      void queryClient.invalidateQueries({ queryKey: ['system-health'] })
      toast({
        title: 'Rolled back OpenSWMM',
        description: data.message,
        tone: data.restart_required ? 'default' : 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Rollback failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const offline = health.isError
  const data = health.data
  const engineData = check.data ?? engine.data

  const missingGis = data ? GIS_KEYS.filter((k) => !data.gis[k]) : []
  const gisOk = missingGis.length === 0
  const engineOk = Boolean(data?.openswmm.import_ok)
  const busy = check.isPending || update.isPending || rollback.isPending

  let tone: 'success' | 'warning' | 'danger' | 'idle' = 'idle'
  let pill = 'Checking…'
  let Icon = CheckCircle2

  if (offline) {
    tone = 'danger'
    pill = 'Backend offline'
    Icon = ServerCrash
  } else if (data) {
    if (!engineOk) {
      tone = 'danger'
      pill = 'Degraded'
      Icon = CircleAlert
    } else if (!gisOk || engineData?.update_available) {
      tone = 'warning'
      pill = engineData?.update_available ? 'Ready · update available' : 'Ready (GIS incomplete)'
      Icon = AlertTriangle
    } else {
      tone = 'success'
      pill = 'Ready'
      Icon = CheckCircle2
    }
  }

  const versions = engineData?.versions ?? []
  const selectValue =
    selectedVersion ||
    engineData?.latest ||
    engineData?.installed_version ||
    ''

  return (
    <div className="mt-5 rounded-xl border border-border bg-surface/80 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <Icon
            className={cn(
              'h-4 w-4',
              tone === 'success' && 'text-success',
              tone === 'warning' && 'text-warning',
              tone === 'danger' && 'text-danger',
              tone === 'idle' && 'text-muted',
            )}
          />
          System status
        </div>
        <Badge tone={tone} className="normal-case">
          {pill}
        </Badge>
      </div>

      {offline ? (
        <p className="m-0 text-sm text-danger">
          Backend offline — start uvicorn on port 8000 (
          <code className="text-xs">cd backend; uvicorn app.main:app --reload --port 8000</code>
          ).
        </p>
      ) : health.isLoading && !data ? (
        <p className="m-0 text-sm text-muted">Checking local engine and dependencies…</p>
      ) : data ? (
        <div className="space-y-2">
          <Row label="Backend API" ok detail="Reachable" />
          <Row
            label="OpenSWMM"
            ok={engineOk}
            detail={
              engineOk
                ? `v${data.openswmm.version ?? 'unknown'}`
                : data.openswmm.error || 'Not importable — pip install openswmm'
            }
          />
          <Row
            label="GIS stack"
            ok={gisOk}
            warn={!gisOk}
            detail={
              gisOk
                ? 'All present (DEM / shapefile layers)'
                : `Missing: ${missingGis.join(', ')}`
            }
          />
          <Row
            label="App"
            ok
            detail={`v${data.app_version} · Python ${data.python_version}`}
          />
        </div>
      ) : null}

      {!offline && data && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 text-left text-sm font-medium text-fg-soft hover:text-fg"
            onClick={() => setUpdatesOpen((v) => !v)}
          >
            {updatesOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Updates
            {engineData?.update_available ? (
              <Badge tone="warning" className="ml-1 normal-case">
                OpenSWMM {engineData.latest}
              </Badge>
            ) : null}
          </button>

          {updatesOpen && (
            <div className="mt-3 space-y-3">
              <p className="m-0 text-xs text-muted">
                Optional. Checks PyPI for newer OpenSWMM builds. Never auto-updates. After
                changing the engine, restart the backend so the running process loads it.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setUpdatesOpen(true)
                    check.mutate()
                  }}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', check.isPending && 'animate-spin')} />
                  Check for updates
                </Button>
                {engineData?.can_rollback && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => rollback.mutate()}
                    title={
                      engineData.previous
                        ? `Roll back to OpenSWMM ${engineData.previous}`
                        : 'Roll back'
                    }
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Rollback
                    {engineData.previous ? ` (${engineData.previous})` : ''}
                  </Button>
                )}
              </div>

              {(versions.length > 0 || engineData?.latest) && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={selectValue}
                    onChange={(e) => setSelectedVersion(e.target.value)}
                    disabled={busy || versions.length === 0}
                    className="min-w-0 flex-1 rounded-lg border border-border-strong bg-elevated px-2 py-1.5 text-xs text-fg"
                  >
                    {versions.length === 0 && selectValue && (
                      <option value={selectValue}>{selectValue}</option>
                    )}
                    {versions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                        {v === engineData?.installed_version ? ' (installed)' : ''}
                        {v === engineData?.latest ? ' (latest)' : ''}
                        {v === engineData?.previous ? ' (previous)' : ''}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || !selectValue}
                    onClick={() => update.mutate(selectValue || undefined)}
                  >
                    Install selected
                  </Button>
                  {engineData?.update_available && engineData.latest && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => update.mutate(undefined)}
                    >
                      Update to latest
                    </Button>
                  )}
                </div>
              )}

              {engineData?.previous && (
                <p className="m-0 text-[11px] text-muted">
                  Previous recorded version: {engineData.previous}
                  {engineData.updated_at ? ` · last change ${engineData.updated_at}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
