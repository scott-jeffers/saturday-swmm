import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mountain, Trash2, Upload } from 'lucide-react'
import { ApiError, api, type GisLayer } from '../../api/client'
import { Button, Dialog, DialogContent, Switch, useToast } from '../ui'

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

export function BackgroundLayersPanel({ projectPath }: { projectPath: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [crsPrompt, setCrsPrompt] = useState<{
    kind: 'dem' | 'vector'
    source_path: string
    name: string
  } | null>(null)
  const [crsValue, setCrsValue] = useState('EPSG:25832')

  const layers = useQuery({
    queryKey: ['gis-layers', projectPath],
    queryFn: api.listGisLayers,
    enabled: Boolean(projectPath),
  })

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['gis-layers', projectPath] })

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
        setCrsValue('EPSG:25832')
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
        {list.map((layer: GisLayer) => (
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
              </div>
              <div className="flex items-center gap-1">
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
        ))}
      </ul>

      <Dialog open={Boolean(crsPrompt)} onOpenChange={(o) => !o && setCrsPrompt(null)}>
        <DialogContent
          title="CRS required"
          description="This file has no projection metadata. Enter the EPSG code of the source data."
        >
          <label className="block text-xs">
            <span className="mb-1 block text-muted">Source CRS</span>
            <input
              value={crsValue}
              onChange={(e) => setCrsValue(e.target.value)}
              className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm"
              placeholder="EPSG:25832"
            />
          </label>
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
