import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Compass, Maximize2, Mountain, Trash2, Upload } from 'lucide-react'
import { ApiError, api, type GisLayer } from '../../api/client'
import { CrsPicker } from '../CrsPicker'
import { Button, Dialog, DialogContent, Switch, useToast } from '../ui'
import { clearCamera } from '../../lib/mapViewStore'
import { ensureCrs } from '../../lib/projection'

function needsCrs(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false
  const d = err.detail
  return Boolean(
    d &&
      typeof d === 'object' &&
      'needs_crs' in d &&
      (d as { needs_crs?: boolean }).needs_crs,
  )
}

export function BackgroundLayersPanel({
  projectPath,
  projectCrs = 'EPSG:25832',
  onProjectCrsApplied,
  onZoomToLayer,
}: {
  projectPath: string
  projectCrs?: string
  /** Called after project CRS is updated from a layer (e.g. fit extent). */
  onProjectCrsApplied?: () => void
  onZoomToLayer?: (layer: GisLayer) => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [crsPrompt, setCrsPrompt] = useState<{
    kind: 'dem' | 'vector'
    source_path: string
    name: string
  } | null>(null)
  const [crsValue, setCrsValue] = useState(projectCrs)

  const layers = useQuery({
    queryKey: ['gis-layers', projectPath],
    queryFn: api.listGisLayers,
    enabled: Boolean(projectPath),
  })

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['gis-layers', projectPath] })

  const invalidateAfterCrs = () => {
    clearCamera(projectPath)
    void queryClient.invalidateQueries({ queryKey: ['project'] })
    void queryClient.invalidateQueries({ queryKey: ['network'] })
    void queryClient.invalidateQueries({ queryKey: ['2d-mesh'] })
    void queryClient.invalidateQueries({ queryKey: ['gis-layers'] })
    onProjectCrsApplied?.()
  }

  const ingest = useMutation({
    mutationFn: async (args: {
      kind: 'dem' | 'vector'
      source_path: string
      name?: string
      source_crs?: string
    }) => {
      if (args.kind === 'dem') {
        return api.ingestGisDem({
          source_path: args.source_path,
          name: args.name,
          source_crs: args.source_crs,
        })
      }
      return api.ingestGisVector({
        source_path: args.source_path,
        name: args.name,
        source_crs: args.source_crs,
      })
    },
    onSuccess: (layer) => {
      invalidate()
      setCrsPrompt(null)
      toast({
        title: 'Layer added',
        description: layer.name,
        tone: 'success',
      })
    },
    onError: (err, vars) => {
      if (needsCrs(err)) {
        setCrsPrompt({
          kind: vars.kind,
          source_path: vars.source_path,
          name: vars.name ?? '',
        })
        setCrsValue(projectCrs)
        return
      }
      toast({
        title: 'Ingest failed',
        description: (err as Error).message,
        tone: 'danger',
      })
    },
  })

  const patch = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      visible?: boolean
      opacity?: number
    }) => api.patchGisLayer(id, body),
    onSuccess: invalidate,
    onError: (err) =>
      toast({ title: 'Update failed', description: (err as Error).message, tone: 'danger' }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGisLayer(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Layer removed', tone: 'success' })
    },
    onError: (err) =>
      toast({ title: 'Delete failed', description: (err as Error).message, tone: 'danger' }),
  })

  const setFromLayer = useMutation({
    mutationFn: (crs: string) => api.setProjectCrs(crs),
    onSuccess: (info) => {
      ensureCrs(info.crs ?? 'EPSG:25832', info.crs_proj4)
      invalidateAfterCrs()
      toast({
        title: 'Project CRS updated',
        description: info.crs,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'CRS update failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const pickAndIngest = async (kind: 'dem' | 'vector') => {
    const filetypes =
      kind === 'dem' ? ['*.tif', '*.tiff', '*.TIF', '*.TIFF'] : ['*.zip', '*.shp']
    const title = kind === 'dem' ? 'Select DEM GeoTIFF' : 'Select shapefile (.zip or .shp)'
    try {
      const picked = await api.browseFile(title, filetypes)
      if (picked.cancelled || !picked.path) return
      const name = picked.path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? undefined
      ingest.mutate({ kind, source_path: picked.path, name })
    } catch (err) {
      toast({
        title: 'File picker failed',
        description: (err as Error).message,
        tone: 'danger',
      })
    }
  }

  const list = layers.data?.layers ?? []

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
          <Mountain className="h-3.5 w-3.5" />
          Background GIS
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={ingest.isPending}
          onClick={() => void pickAndIngest('dem')}
        >
          <Upload className="h-3.5 w-3.5" />
          DEM
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={ingest.isPending}
          onClick={() => void pickAndIngest('vector')}
        >
          <Upload className="h-3.5 w-3.5" />
          Shapefile
        </Button>
      </div>
      {ingest.isPending && (
        <p className="text-[11px] text-muted">Importing & reprojecting…</p>
      )}
      {layers.isError && (
        <p className="text-[11px] text-danger">{(layers.error as Error).message}</p>
      )}
      {list.length === 0 && !layers.isLoading && (
        <p className="text-[11px] text-muted">
          Add a DEM (GeoTIFF) or shapefile zip. Full files stay on disk; the map shows a light
          preview.
        </p>
      )}
      <ul className="m-0 space-y-2 p-0 list-none">
        {list.map((layer: GisLayer) => {
          const src = layer.source_crs?.trim() || null
          const already = Boolean(src && src === projectCrs)
          return (
            <li
              key={layer.id}
              className="rounded-lg border border-border/80 bg-surface/40 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-fg">{layer.name}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted">
                    {layer.type}
                    {layer.feature_count != null ? ` · ${layer.feature_count} feats` : ''}
                  </div>
                  {src ? (
                    <div className="mt-0.5 truncate text-[10px] text-muted">
                      Source {src}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[10px] text-muted">No source CRS recorded</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!layer.bounds || !onZoomToLayer}
                    title={
                      layer.bounds
                        ? 'Zoom map to this layer'
                        : 'No bounds available for this layer'
                    }
                    aria-label={`Zoom to ${layer.name}`}
                    onClick={() => onZoomToLayer?.(layer)}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                  <Switch
                    checked={layer.visible}
                    onCheckedChange={(v) => patch.mutate({ id: layer.id, visible: v })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => remove.mutate(layer.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {src && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1.5 w-full"
                  disabled={already || setFromLayer.isPending}
                  title={
                    already
                      ? 'Already the project CRS'
                      : `Set project CRS to ${src}`
                  }
                  onClick={() => setFromLayer.mutate(src)}
                >
                  <Compass className="h-3.5 w-3.5" />
                  {already ? 'Project CRS' : 'Use as project CRS'}
                </Button>
              )}
              {layer.visible && (
                <label className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                  Opacity
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(layer.opacity * 100)}
                    onChange={(e) =>
                      patch.mutate({
                        id: layer.id,
                        opacity: Number(e.target.value) / 100,
                      })
                    }
                    className="min-w-0 flex-1"
                  />
                </label>
              )}
              {layer.warning && (
                <p className="mt-1 text-[10px] text-amber-400">{layer.warning}</p>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={Boolean(crsPrompt)} onOpenChange={(o) => !o && setCrsPrompt(null)}>
        <DialogContent
          title="CRS required"
          description="This file has no projection metadata. Search or enter the EPSG code of the source data."
        >
          <div className="text-xs">
            <span className="mb-1 block text-muted">Source CRS</span>
            <CrsPicker compact value={crsValue} onChange={setCrsValue} />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setCrsPrompt(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!crsValue.trim() || ingest.isPending}
              onClick={() => {
                if (!crsPrompt) return
                ingest.mutate({
                  kind: crsPrompt.kind,
                  source_path: crsPrompt.source_path,
                  name: crsPrompt.name || undefined,
                  source_crs: crsValue.trim(),
                })
              }}
            >
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
