/**
 * Background GIS layers, in the map's Layers panel: add files and web
 * services, show or hide them, restyle, reorder and remove them.
 *
 * In the desktop app files are read by the backend (shapefiles, GeoPackage,
 * GeoJSON, KML, FlatGeobuf, GML, GeoTIFF DEMs). In the browser viewer they're
 * read here (GeoJSON, zipped shapefiles, KML/KMZ) and kept with the model.
 */

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Compass, Globe, Maximize2, Mountain, Plus, Trash2, Upload } from 'lucide-react'
import { ApiError, api, type GisLayer, type GisLayerStyle, type GisWebSource } from '../../api/client'
import { CrsPicker } from '../CrsPicker'
import { Button, Dialog, DialogContent, Switch, useToast } from '../ui'
import { clearCamera } from '../../lib/mapViewStore'
import { ensureCrs } from '../../lib/projection'
import { IS_VIEWER } from '../../lib/mode'
import { DesktopOnly } from '../DesktopOnly'
import { cn } from '../../lib/cn'
import {
  fetchArcgisFeatures,
  guessWebKind,
  isArcgisFeatureLayer,
  LAYER_COLORS,
  layerNameFromUrl,
  readVectorFile,
} from '../../lib/gisSources'
import { layerColor } from './layers/GisBackgroundLayer'

function needsCrs(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false
  const d = err.detail
  return Boolean(d && typeof d === 'object' && 'needs_crs' in d && (d as { needs_crs?: boolean }).needs_crs)
}

const DESKTOP_VECTOR_TYPES = ['*.shp', '*.zip', '*.geojson', '*.json', '*.gpkg', '*.kml', '*.kmz', '*.fgb', '*.gml', '*.dxf', '*.gpx', '*.tab', '*.mif']

const KIND_LABEL: Record<GisWebSource['kind'], string> = { xyz: 'Tiles (XYZ)', wms: 'WMS', arcgis: 'ArcGIS REST' }

function describe(layer: GisLayer) {
  if (layer.type === 'dem') return 'Elevation (DEM)'
  if (layer.type === 'tiles') return layer.web ? KIND_LABEL[layer.web.kind] : 'Web layer'
  const n = layer.feature_count ?? 0
  const kind = (layer.geometry_types ?? []).some((g) => /Polygon/.test(g))
    ? 'polygons'
    : (layer.geometry_types ?? []).some((g) => /Line/.test(g))
      ? 'lines'
      : (layer.geometry_types ?? []).some((g) => /Point/.test(g))
        ? 'points'
        : 'features'
  return `${n.toLocaleString()} ${n === 1 ? kind.replace(/s$/, '') : kind}`
}

export function BackgroundLayersPanel({
  projectPath,
  projectCrs = 'EPSG:25832',
  modelExtent,
  onProjectCrsApplied,
  onZoomToLayer,
  bare,
}: {
  /** In a panel of its own: no top rule. */
  bare?: boolean
  projectPath: string
  projectCrs?: string
  /** The model's extent in lon/lat (west, south, east, north), for feature service queries. */
  modelExtent?: [number, number, number, number] | null
  /** Called after project CRS is updated from a layer (e.g. fit extent). */
  onProjectCrsApplied?: () => void
  onZoomToLayer?: (layer: GisLayer) => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const [crsPrompt, setCrsPrompt] = useState<{ kind: 'dem' | 'vector'; source_path: string; name: string } | null>(null)
  const [crsValue, setCrsValue] = useState(projectCrs)
  const [webOpen, setWebOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const layers = useQuery({ queryKey: ['gis-layers', projectPath], queryFn: api.listGisLayers, enabled: Boolean(projectPath) })
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['gis-layers', projectPath] })

  const ingest = useMutation({
    mutationFn: async (args: { kind: 'dem' | 'vector'; source_path: string; name?: string; source_crs?: string }) =>
      args.kind === 'dem'
        ? api.ingestGisDem({ source_path: args.source_path, name: args.name, source_crs: args.source_crs })
        : api.ingestGisVector({ source_path: args.source_path, name: args.name, source_crs: args.source_crs }),
    onSuccess: (layer) => {
      invalidate()
      setCrsPrompt(null)
      toast({ title: 'Layer added', description: layer.name, tone: 'success' })
    },
    onError: (err, vars) => {
      if (needsCrs(err)) {
        setCrsPrompt({ kind: vars.kind, source_path: vars.source_path, name: vars.name ?? '' })
        setCrsValue(projectCrs)
        return
      }
      toast({ title: 'Couldn’t add the layer', description: (err as Error).message, tone: 'danger' })
    },
  })

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; visible?: boolean; opacity?: number; z_order?: number; style?: GisLayerStyle }) =>
      api.patchGisLayer(id, body),
    onMutate: async ({ id, ...body }) => {
      // update the list straight away so sliders and swatches feel live
      const key = ['gis-layers', projectPath]
      const prev = queryClient.getQueryData<{ layers: GisLayer[]; project_crs: string }>(key)
      if (prev)
        queryClient.setQueryData(key, {
          ...prev,
          layers: prev.layers.map((l) => (l.id === id ? { ...l, ...body, style: body.style ? { ...(l.style ?? {}), ...body.style } : l.style } : l)),
        })
    },
    onSettled: invalidate,
    onError: (err) => toast({ title: 'Couldn’t update the layer', description: (err as Error).message, tone: 'danger' }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGisLayer(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Layer removed', tone: 'success' })
    },
    onError: (err) => toast({ title: 'Couldn’t remove the layer', description: (err as Error).message, tone: 'danger' }),
  })

  const setFromLayer = useMutation({
    mutationFn: (crs: string) => api.setProjectCrs(crs),
    onSuccess: (info) => {
      ensureCrs(info.crs ?? 'EPSG:25832', info.crs_proj4)
      clearCamera(projectPath)
      for (const k of ['project', 'network', '2d-mesh', 'gis-layers']) void queryClient.invalidateQueries({ queryKey: [k] })
      onProjectCrsApplied?.()
      toast({ title: 'Project coordinate system updated', description: info.crs, tone: 'success' })
    },
    onError: (err) => toast({ title: 'Couldn’t set the coordinate system', description: (err as Error).message, tone: 'danger' }),
  })

  const pickDesktop = async (kind: 'dem' | 'vector') => {
    setAddOpen(false)
    try {
      const picked = await api.browseFile(
        kind === 'dem' ? 'Choose a DEM (GeoTIFF)' : 'Choose a GIS file',
        kind === 'dem' ? ['*.tif', '*.tiff', '*.TIF', '*.TIFF'] : DESKTOP_VECTOR_TYPES,
      )
      if (picked.cancelled || !picked.path) return
      const name = picked.path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? undefined
      ingest.mutate({ kind, source_path: picked.path, name })
    } catch (err) {
      toast({ title: 'File picker failed', description: (err as Error).message, tone: 'danger' })
    }
  }

  const readBrowserFiles = async (files: File[]) => {
    setBusy('Reading…')
    try {
      for (const f of files) {
        try {
          for (const part of await readVectorFile(f, projectCrs)) {
            await api.addGisGeoJsonLayer({ name: part.name, geojson: part.fc })
            if (part.note) toast({ title: part.name, description: part.note })
          }
        } catch (e) {
          toast({ title: `Couldn’t read ${f.name}`, description: (e as Error).message, tone: 'danger' })
        }
      }
      invalidate()
    } finally {
      setBusy(null)
    }
  }

  const list = [...(layers.data?.layers ?? [])].sort((a, b) => b.z_order - a.z_order) // top of the list = drawn on top
  const move = (layer: GisLayer, dir: 1 | -1) => {
    const i = list.findIndex((l) => l.id === layer.id)
    const other = list[i - dir]
    if (!other) return
    patch.mutate({ id: layer.id, z_order: other.z_order })
    patch.mutate({ id: other.id, z_order: layer.z_order })
  }

  return (
    <div className={cn('space-y-2', !bare && 'border-t border-border pt-3')}>
      <div className="relative flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-soft">
          <Globe className="h-3.5 w-3.5 text-muted" />
          {bare ? 'Background layers' : 'GIS layers'}
        </span>
        <Button size="sm" variant="outline" disabled={ingest.isPending || Boolean(busy)} onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
        {addOpen ? (
          <div className="absolute right-0 top-9 z-10 w-56 rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]" role="menu">
            <MenuItem
              icon={<Upload className="h-3.5 w-3.5" />}
              label="File…"
              hint={IS_VIEWER ? 'GeoJSON, zipped shapefile, KML/KMZ, GPX, CAD (DXF)' : 'Shapefile, GeoPackage, GeoJSON, KML, CAD (DXF), GPX, MapInfo…'}
              onClick={() => (IS_VIEWER ? (setAddOpen(false), fileInput.current?.click()) : void pickDesktop('vector'))}
            />
            <MenuItem
              icon={<Globe className="h-3.5 w-3.5" />}
              label="Web layer…"
              hint="Tiles, WMS or ArcGIS service"
              onClick={() => {
                setAddOpen(false)
                setWebOpen(true)
              }}
            />
            {!IS_VIEWER ? (
              <MenuItem icon={<Mountain className="h-3.5 w-3.5" />} label="DEM…" hint="GeoTIFF elevation" onClick={() => void pickDesktop('dem')} />
            ) : (
              <DesktopOnly what="DEMs" className="w-full">
                <MenuItem icon={<Mountain className="h-3.5 w-3.5" />} label="DEM…" hint="GeoTIFF elevation" onClick={() => undefined} />
              </DesktopOnly>
            )}
          </div>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".geojson,.json,.zip,.kml,.kmz,.gpx,.dxf"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void readBrowserFiles(files)
          }}
        />
      </div>
      {ingest.isPending || busy ? <p className="text-[11px] text-muted">{busy ?? 'Importing and reprojecting…'}</p> : null}
      {layers.isError ? <p className="text-[11px] text-danger">{(layers.error as Error).message}</p> : null}
      {list.length === 0 && !layers.isLoading ? (
        <p className="text-[11px] leading-relaxed text-muted">
          Add parcels, buildings, inlets or aerial imagery behind the model, from a file or a web map service. Click a feature on the map to see its attributes.
        </p>
      ) : null}

      <ul className="m-0 list-none space-y-1 p-0">
        {list.map((layer, i) => {
          const src = layer.source_crs?.trim() || null
          const color = layerColor(layer)
          const open = editing === layer.id
          return (
            <li key={layer.id} className={cn('rounded-lg border px-2 py-1.5', open ? 'border-border-strong bg-fg/[0.03]' : 'border-transparent hover:border-border')}>
              <div className="flex items-center gap-2">
                <Switch checked={layer.visible} onCheckedChange={(v) => patch.mutate({ id: layer.id, visible: v })} aria-label={`Show ${layer.name}`} />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setEditing(open ? null : layer.id)}
                  aria-expanded={open}
                  title="Style and options"
                >
                  {layer.type === 'vector' ? (
                    <span className="h-3 w-3 shrink-0 rounded-sm border" style={{ background: `${color}55`, borderColor: color }} aria-hidden />
                  ) : layer.type === 'dem' ? (
                    <Mountain className="h-3 w-3 shrink-0 text-muted" aria-hidden />
                  ) : (
                    <Globe className="h-3 w-3 shrink-0 text-muted" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[12px] font-medium', layer.visible ? 'text-fg' : 'text-muted')}>{layer.name}</span>
                    <span className="block truncate text-[10px] text-muted">{describe(layer)}</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center">
                  <IconBtn label={`Move ${layer.name} up`} disabled={i === 0} onClick={() => move(layer, 1)}>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn label={`Move ${layer.name} down`} disabled={i === list.length - 1} onClick={() => move(layer, -1)}>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
              </div>

              {open ? (
                <div className="mt-2 space-y-2 border-t border-border pt-2 text-[11px] text-muted">
                  {layer.type === 'vector' ? (
                    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Colour">
                      {LAYER_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={color === c}
                          aria-label={c}
                          onClick={() => patch.mutate({ id: layer.id, style: { color: c } })}
                          className={cn('h-5 w-5 rounded-full border-2', color === c ? 'border-fg' : 'border-transparent')}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  ) : null}
                  <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch.mutate({ id: layer.id, opacity: v })} />
                  {layer.type === 'vector' && (layer.geometry_types ?? []).some((g) => /Polygon/.test(g)) ? (
                    <Slider label="Fill" value={layer.style?.fill_opacity ?? 0.25} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch.mutate({ id: layer.id, style: { fill_opacity: v } })} />
                  ) : null}
                  {layer.type === 'vector' && (layer.geometry_types ?? []).some((g) => /Polygon|Line/.test(g)) ? (
                    <Slider label="Line" value={layer.style?.line_width ?? 1.5} min={0.5} max={6} step={0.5} fmt={(v) => `${v} px`} onChange={(v) => patch.mutate({ id: layer.id, style: { line_width: v } })} />
                  ) : null}
                  {layer.type === 'vector' && (layer.geometry_types ?? []).some((g) => /Point/.test(g)) ? (
                    <Slider label="Points" value={layer.style?.point_radius ?? 4} min={2} max={10} step={1} fmt={(v) => `${v} px`} onChange={(v) => patch.mutate({ id: layer.id, style: { point_radius: v } })} />
                  ) : null}
                  {layer.type === 'vector' && (layer.fields ?? []).length ? (
                    <label className="flex items-center gap-2">
                      <span className="w-12 shrink-0">Labels</span>
                      <select
                        className="field h-7 min-w-0 flex-1 py-0 text-[11px]"
                        value={layer.style?.label_field ?? ''}
                        onChange={(e) => patch.mutate({ id: layer.id, style: { label_field: e.target.value } })}
                      >
                        <option value="">None</option>
                        {(layer.fields ?? []).map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {layer.web ? <p className="m-0 truncate" title={layer.web.url}>{layer.web.url}</p> : null}
                  {layer.warning ? <p className="m-0 text-warning">{layer.warning}</p> : null}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {layer.bounds && onZoomToLayer ? (
                      <Button size="sm" variant="ghost" onClick={() => onZoomToLayer(layer)}>
                        <Maximize2 className="h-3.5 w-3.5" /> Zoom to
                      </Button>
                    ) : null}
                    {src && layer.type !== 'tiles' && src !== projectCrs && src !== 'EPSG:4326' ? (
                      <Button size="sm" variant="ghost" disabled={setFromLayer.isPending} title={`Set the model’s coordinate system to ${src}`} onClick={() => setFromLayer.mutate(src)}>
                        <Compass className="h-3.5 w-3.5" /> Use its CRS
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" className="ml-auto text-danger" onClick={() => remove.mutate(layer.id)}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <WebLayerDialog
        open={webOpen}
        onOpenChange={setWebOpen}
        modelExtent={modelExtent ?? null}
        onAdded={(name) => {
          invalidate()
          toast({ title: 'Layer added', description: name, tone: 'success' })
        }}
      />

      <Dialog open={Boolean(crsPrompt)} onOpenChange={(o) => !o && setCrsPrompt(null)}>
        <DialogContent title="Which coordinate system?" description="This file doesn’t say what coordinate system it uses. Search for it or enter its EPSG code.">
          <div className="text-xs">
            <span className="mb-1 block text-muted">Source coordinate system</span>
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
              onClick={() => crsPrompt && ingest.mutate({ ...crsPrompt, name: crsPrompt.name || undefined, source_crs: crsValue.trim() })}
            >
              Add layer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MenuItem({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fg/5">
      <span className="mt-0.5 text-muted">{icon}</span>
      <span>
        <span className="block text-[12px] text-fg">{label}</span>
        <span className="block text-[10px] text-muted">{hint}</span>
      </span>
    </button>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-fg/5 hover:text-fg disabled:opacity-30">
      {children}
    </button>
  )
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" />
      <span className="w-10 shrink-0 text-right tabular-nums">{fmt(value)}</span>
    </label>
  )
}

const EXAMPLES: { label: string; url: string }[] = [
  { label: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  { label: 'USGS topo (US)', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}' },
  { label: 'OpenTopoMap', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png' },
]

function WebLayerDialog({
  open,
  onOpenChange,
  modelExtent,
  onAdded,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  modelExtent: [number, number, number, number] | null
  onAdded: (name: string) => void
}) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<GisWebSource['kind']>('xyz')
  const [wmsLayers, setWmsLayers] = useState('')
  const [nearModel, setNearModel] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const features = kind === 'arcgis' && isArcgisFeatureLayer(url)

  const onUrl = (v: string) => {
    setUrl(v)
    setKind(guessWebKind(v))
    setError(null)
  }

  const add = async () => {
    setBusy(true)
    setError(null)
    const label = name.trim() || layerNameFromUrl(url)
    try {
      if (features) {
        const { fc, truncated } = await fetchArcgisFeatures(url, nearModel && modelExtent ? modelExtent : undefined)
        if (!fc.features.length) throw new Error('The service returned no features here')
        await api.addGisGeoJsonLayer({ name: label, geojson: fc, source: url.trim() })
        if (truncated) setError(`Loaded the first ${fc.features.length.toLocaleString()} features`)
      } else {
        await api.addGisWebLayer({ name: label, web: { kind, url: url.trim(), wms_layers: kind === 'wms' ? wmsLayers.trim() || undefined : undefined } })
      }
      onAdded(label)
      setUrl('')
      setName('')
      setWmsLayers('')
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add a web layer" description="Paste the address of a tile layer, a WMS server or an ArcGIS REST service.">
        <div className="space-y-3 text-[12px]">
          <label className="block">
            <span className="mb-1 block font-medium text-fg-soft">Address</span>
            <input className="field w-full" value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://…/{z}/{x}/{y}.png or …/MapServer" autoFocus />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button key={x.label} type="button" className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:text-fg" onClick={() => (onUrl(x.url), setName(x.label))}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block font-medium text-fg-soft">Type</span>
              <select className="field w-full" value={kind} onChange={(e) => setKind(e.target.value as GisWebSource['kind'])}>
                <option value="xyz">Tiles (XYZ)</option>
                <option value="wms">WMS</option>
                <option value="arcgis">ArcGIS REST</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-fg-soft">Name</span>
              <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={url ? layerNameFromUrl(url) : 'Layer name'} />
            </label>
          </div>
          {kind === 'wms' ? (
            <label className="block">
              <span className="mb-1 block font-medium text-fg-soft">WMS layers</span>
              <input className="field w-full" value={wmsLayers} onChange={(e) => setWmsLayers(e.target.value)} placeholder="Layer names, comma-separated" />
            </label>
          ) : null}
          {kind === 'arcgis' ? (
            <p className="m-0 text-muted">
              {features
                ? 'A feature layer: its features are loaded so you can style them and click them for attributes.'
                : 'A map or image service is drawn as images. For clickable features, use a layer address ending in /FeatureServer/0 or /MapServer/0.'}
            </p>
          ) : null}
          {features ? (
            <label className="flex items-center gap-2 text-fg-soft">
              <input type="checkbox" checked={nearModel} disabled={!modelExtent} onChange={(e) => setNearModel(e.target.checked)} />
              Only features around the model
            </label>
          ) : null}
          {error ? <p className="m-0 text-danger">{error}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!/^https?:\/\//i.test(url.trim()) || busy} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add layer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
