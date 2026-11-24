/**
 * US site data for the model's area, sized for the map's GIS panel:
 * USGS 3DEP elevation, NLCD impervious cover and USDA SSURGO soils.
 * Downloads go to the project's site-data folder; the DEM and soils also
 * become map layers. Clicking a subcatchment in a table selects it on the map.
 */
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Download, Layers, Mountain, Sprout } from 'lucide-react'
import { api, type SiteImpervious, type SiteSoils } from '../../api/client'
import { Button, useToast } from '../ui'
import { refreshAfterEdit } from '../UndoRedo'
import { cn } from '../../lib/cn'

const PARAM_LABEL: Record<string, string> = {
  suction: 'Suction',
  ksat: 'Ksat',
  imd: 'IMD',
  max_rate: 'Max rate',
  min_rate: 'Min rate',
  decay: 'Decay',
  dry_time: 'Dry (d)',
  max_infil: 'Max vol.',
  cn: 'CN',
}

function Section({ id, icon, title, summary, children }: { id: string; icon: ReactNode; title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(id === 'imp')
  return (
    <section className="rounded-lg border border-border">
      <button type="button" className="flex w-full items-center gap-2 px-2.5 py-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-fg">{title}</span>
          {summary ? <span className="block truncate text-[11px] text-muted">{summary}</span> : null}
        </span>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
      </button>
      {open ? <div className="space-y-2 border-t border-border px-2.5 py-2.5 text-[12px]">{children}</div> : null}
    </section>
  )
}

const note = 'm-0 text-[11.5px] leading-relaxed text-muted'

export function SiteDataSections({ onSelectSubcatchment }: { onSelectSubcatchment?: (id: string) => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const [res, setRes] = useState(3)
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, tone: 'danger' })

  const dem = useMutation({
    mutationFn: () => api.siteDem(res),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['gis-layers'] })
      toast({ title: 'DEM added to the GIS layers', description: `${r.file} · ${r.width}×${r.height} cells, elevations in ${r.vertical_unit}${r.note ? `. ${r.note}` : ''}`, tone: 'success' })
    },
    onError: fail('Couldn’t get the DEM'),
  })

  const imp = useQuery<SiteImpervious | null>({ queryKey: ['site-impervious', project.data?.path], queryFn: () => api.siteImpervious(false).then((d) => ((d as { available?: boolean }).available === false ? null : d)), retry: false })
  const impDl = useMutation({ mutationFn: () => api.siteImpervious(true), onSuccess: (d) => qc.setQueryData(['site-impervious', project.data?.path], d), onError: fail('Couldn’t get impervious cover') })
  const impApply = useMutation({
    mutationFn: (ids?: string[]) => api.siteImperviousApply(ids),
    onSuccess: (r) => {
      refreshAfterEdit(qc)
      void qc.invalidateQueries({ queryKey: ['site-impervious'] })
      toast({ title: `Updated % impervious for ${r.changed.length} subcatchment${r.changed.length === 1 ? '' : 's'}`, description: 'Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: fail('Couldn’t update the model'),
  })

  const soils = useQuery<SiteSoils | null>({ queryKey: ['site-soils', project.data?.path], queryFn: () => api.siteSoils(false).then((d) => ((d as { available?: boolean }).available === false ? null : d)), retry: false })
  const soilsDl = useMutation({
    mutationFn: () => api.siteSoils(true),
    onSuccess: (d) => {
      qc.setQueryData(['site-soils', project.data?.path], d)
      void qc.invalidateQueries({ queryKey: ['gis-layers'] })
    },
    onError: fail('Couldn’t get SSURGO soils'),
  })
  const soilsApply = useMutation({
    mutationFn: (ids?: string[]) => api.siteSoilsApply(ids),
    onSuccess: (r) => {
      refreshAfterEdit(qc)
      toast({ title: `Updated infiltration for ${r.changed.length} subcatchment${r.changed.length === 1 ? '' : 's'}`, description: 'Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: fail('Couldn’t update the model'),
  })

  const impRows = imp.data?.subcatchments ?? []
  const soilRows = soils.data?.subcatchments ?? []
  const params = soilRows[0] ? Object.keys(soilRows[0].params) : []
  const bigDiffs = impRows.filter((r) => r.current != null && Math.abs(r.nlcd - r.current) >= 10).length
  const idCell = (id: string) =>
    onSelectSubcatchment ? (
      <button type="button" className="font-medium text-fg hover:text-accent-soft hover:underline" title="Select on the map" onClick={() => onSelectSubcatchment(id)}>
        {id}
      </button>
    ) : (
      <span className="font-medium text-fg">{id}</span>
    )

  return (
    <div className="space-y-2">
      <p className={note}>Download data for the model’s area from US federal sources and use it to fill the model. United States only; files go in the project’s site-data folder.</p>

      <Section id="dem" icon={<Mountain className="h-4 w-4" />} title="Elevation" summary="USGS 3DEP, 1 m lidar where flown">
        <p className={note}>Covers the model plus a margin, in the model’s coordinate system and length unit. It’s added to the GIS layers, for 2D meshes, flow paths and rim elevations.</p>
        <div className="flex items-end gap-2">
          <label className="block min-w-0 flex-1 text-[11.5px] font-medium text-fg-soft">
            Cell size
            <select className="field mt-1 w-full" value={res} onChange={(e) => setRes(Number(e.target.value))}>
              {[1, 2, 3, 5, 10, 30].map((r) => (
                <option key={r} value={r}>
                  {r} m{r === 1 ? ' (lidar areas)' : r === 10 ? ' (1/3 arc-second)' : r === 30 ? ' (1 arc-second)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={dem.isPending} onClick={() => dem.mutate()}>
            <Download className="h-3.5 w-3.5" /> {dem.isPending ? 'Downloading…' : 'Get DEM'}
          </Button>
        </div>
      </Section>

      <Section
        id="imp"
        icon={<Layers className="h-4 w-4" />}
        title="Impervious cover"
        summary={impRows.length ? `NLCD 2021 · ${impRows.length} subcatchments${bigDiffs ? ` · ${bigDiffs} differ by 10+ points` : ''}` : 'NLCD 2021, 30 m'}
      >
        <p className={note}>Percent impervious from the National Land Cover Database, averaged over each subcatchment and shown beside the model’s value.</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={impRows.length ? 'outline' : 'primary'} disabled={impDl.isPending} onClick={() => impDl.mutate()}>
            <Download className="h-3.5 w-3.5" /> {impDl.isPending ? 'Downloading…' : impRows.length ? 'Download again' : 'Download NLCD'}
          </Button>
          {impRows.length > 0 && (
            <Button size="sm" variant="primary" disabled={impApply.isPending} onClick={() => impApply.mutate(undefined)}>
              Use for all {impRows.length}
            </Button>
          )}
        </div>
        {impRows.length > 0 && (
          <div className="max-h-[42vh] overflow-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 bg-elevated">
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 pr-2 font-medium">Subcatch.</th>
                  <th className="py-1 pr-2 text-right font-medium">Model %</th>
                  <th className="py-1 pr-2 text-right font-medium">NLCD %</th>
                  <th className="py-1 pr-2 text-right font-medium">Diff.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {impRows.map((r) => {
                  const d = r.current == null ? null : r.nlcd - r.current
                  return (
                    <tr key={r.id} className="border-b border-border/60" title={`${r.cells} cells of 30 m`}>
                      <td className="py-1 pr-2">{idCell(r.id)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.current ?? '—'}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{r.nlcd}</td>
                      <td className={cn('py-1 pr-2 text-right tabular-nums', d != null && Math.abs(d) >= 10 ? 'text-warning' : 'text-muted')}>{d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`}</td>
                      <td className="py-1 text-right">
                        <button type="button" className="text-accent-soft hover:underline" onClick={() => impApply.mutate([r.id])}>
                          Use
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {impRows.some((r) => r.cells < 4) && <p className="m-0 text-[11px] text-warning">Some subcatchments cover only a few 30 m cells, so their NLCD value is rough.</p>}
      </Section>

      <Section
        id="soils"
        icon={<Sprout className="h-4 w-4" />}
        title="Soils"
        summary={soilRows.length ? `SSURGO · ${soils.data?.method ?? ''} parameters for ${soilRows.length} subcatchments` : 'USDA SSURGO, hydrologic soil groups'}
      >
        <p className={note}>
          Soil groups and surface Ksat from NRCS Soil Data Access, added to the GIS layers and area-weighted into {soils.data?.method ?? 'the model’s infiltration'} parameters (Rawls et al. 1983,
          the SWMM manual, or TR-55 curve numbers). Dual groups such as B/D use the undrained group.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={soilRows.length ? 'outline' : 'primary'} disabled={soilsDl.isPending} onClick={() => soilsDl.mutate()}>
            <Download className="h-3.5 w-3.5" /> {soilsDl.isPending ? 'Downloading…' : soilRows.length ? 'Download again' : 'Download SSURGO'}
          </Button>
          {soilRows.length > 0 && (
            <Button size="sm" variant="primary" disabled={soilsApply.isPending} onClick={() => soilsApply.mutate(undefined)}>
              Use for all {soilRows.length}
            </Button>
          )}
        </div>
        {soilRows.length > 0 && (
          <div className="max-h-[42vh] overflow-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 bg-elevated">
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 pr-2 font-medium">Subcatch.</th>
                  <th className="py-1 pr-2 font-medium">Groups</th>
                  {params.map((p) => (
                    <th key={p} className="whitespace-nowrap py-1 pr-2 text-right font-medium">
                      {PARAM_LABEL[p] ?? p}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {soilRows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60" title={`${r.covered_pct}% has a mapped soil group`}>
                    <td className="py-1 pr-2">{idCell(r.id)}</td>
                    <td className={cn('whitespace-nowrap py-1 pr-2', r.covered_pct < 90 ? 'text-warning' : 'text-fg-soft')}>
                      {Object.entries(r.hsg_share)
                        .map(([g, p]) => `${g} ${p}%`)
                        .join(', ')}
                    </td>
                    {params.map((p) => (
                      <td key={p} className="py-1 pr-2 text-right tabular-nums">
                        {r.params[p] ?? '—'}
                      </td>
                    ))}
                    <td className="py-1 text-right">
                      <button type="button" className="text-accent-soft hover:underline" onClick={() => soilsApply.mutate([r.id])}>
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-1.5 text-[11px] text-muted">Units: {soils.data?.units}. Groups in amber cover under 90 % of the subcatchment; urban land often has no mapped group.</p>
          </div>
        )}
      </Section>
    </div>
  )
}
