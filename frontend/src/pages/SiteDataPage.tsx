/** US site data for the model's area: USGS 3DEP elevation, NLCD impervious cover, SSURGO soils. */
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Mountain, Layers, Sprout } from 'lucide-react'
import { api, type SiteImpervious, type SiteSoils } from '../api/client'
import { Button, PageHeader, Panel, useToast } from '../components/ui'
import { refreshAfterEdit } from '../components/UndoRedo'

const PARAM_LABEL: Record<string, string> = {
  suction: 'Suction head',
  ksat: 'Ksat',
  imd: 'Initial deficit',
  max_rate: 'Max rate',
  min_rate: 'Min rate',
  decay: 'Decay (1/h)',
  dry_time: 'Dry time (d)',
  max_infil: 'Max volume',
  cn: 'Curve number',
}

function Source({ children }: { children: ReactNode }) {
  return <p className="mb-3 mt-0 text-[12px] text-muted">{children}</p>
}

export function SiteDataPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const [res, setRes] = useState(3)
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, tone: 'danger' })

  const dem = useMutation({
    mutationFn: () => api.siteDem(res),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['gis-layers'] })
      toast({ title: 'DEM added to the map layers', description: `${r.file} · ${r.width}×${r.height} cells, elevations in ${r.vertical_unit}${r.note ? `. ${r.note}` : ''}`, tone: 'success' })
    },
    onError: fail('Couldn’t get the DEM'),
  })

  const imp = useQuery<SiteImpervious>({ queryKey: ['site-impervious', project.data?.path], queryFn: () => api.siteImpervious(false), retry: false })
  const impDl = useMutation({ mutationFn: () => api.siteImpervious(true), onSuccess: (d) => qc.setQueryData(['site-impervious', project.data?.path], d), onError: fail('Couldn’t get impervious cover') })
  const impApply = useMutation({
    mutationFn: (ids?: string[]) => api.siteImperviousApply(ids),
    onSuccess: (r) => {
      refreshAfterEdit(qc)
      void qc.invalidateQueries({ queryKey: ['site-impervious'] })
      toast({ title: `Updated % impervious for ${r.changed.length} subcatchments`, description: 'Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: fail('Couldn’t update the model'),
  })

  const soils = useQuery<SiteSoils>({ queryKey: ['site-soils', project.data?.path], queryFn: () => api.siteSoils(false), retry: false })
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
      toast({ title: `Updated infiltration for ${r.changed.length} subcatchments`, description: 'Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: fail('Couldn’t update the model'),
  })

  const impRows = imp.data?.subcatchments ?? []
  const soilRows = soils.data?.subcatchments ?? []
  const params = soilRows[0] ? Object.keys(soilRows[0].params) : []

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader
          title="Site data"
          description="Download elevation, impervious cover and soils for the model's area from US federal sources, then use them to fill the model. Files are saved in the project's site-data folder. United States only."
        />

        <Panel title={<span className="inline-flex items-center gap-2"><Mountain className="h-4 w-4 text-muted" />Elevation: USGS 3DEP</span>}>
          <Source>
            The best elevation USGS has for each spot, lidar-based 1 m where it has been flown, from the National Map. The DEM covers the model plus a margin, comes in the model's
            coordinate system, is converted to the model's length unit, and is added to the map layers for 2D meshing, flow paths and rim elevations. NOAA's Digital Coast
            viewer has similar coastal lidar but works by emailed orders, so 3DEP is used here.
          </Source>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-[12px] font-medium text-fg-soft">
              Cell size
              <select className="field mt-1 w-40" value={res} onChange={(e) => setRes(Number(e.target.value))}>
                {[1, 2, 3, 5, 10, 30].map((r) => (
                  <option key={r} value={r}>
                    {r} m{r === 1 ? ' (lidar areas)' : r === 10 ? ' (1/3 arc-second)' : r === 30 ? ' (1 arc-second)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" disabled={dem.isPending} onClick={() => dem.mutate()}>
              <Download className="h-3.5 w-3.5" /> {dem.isPending ? 'Downloading…' : 'Download DEM'}
            </Button>
          </div>
        </Panel>

        <Panel title={<span className="inline-flex items-center gap-2"><Layers className="h-4 w-4 text-muted" />Impervious cover: NLCD 2021</span>}>
          <Source>
            Percent impervious surface at 30 m from the National Land Cover Database (MRLC), lower 48 states. The average over each subcatchment is shown next to the value in the
            model; apply all of them or only the ones you choose.
          </Source>
          <div className="mb-3 flex gap-2">
            <Button variant={impRows.length ? 'outline' : 'primary'} disabled={impDl.isPending} onClick={() => impDl.mutate()}>
              <Download className="h-3.5 w-3.5" /> {impDl.isPending ? 'Downloading…' : impRows.length ? 'Download again' : 'Download NLCD impervious'}
            </Button>
            {impRows.length > 0 && (
              <Button variant="primary" disabled={impApply.isPending} onClick={() => impApply.mutate(undefined)}>
                Use NLCD values for all {impRows.length}
              </Button>
            )}
          </div>
          {impRows.length > 0 && (
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 pr-3 font-medium">Subcatchment</th>
                  <th className="py-1 pr-3 text-right font-medium">In the model (%)</th>
                  <th className="py-1 pr-3 text-right font-medium">NLCD 2021 (%)</th>
                  <th className="py-1 pr-3 text-right font-medium">Difference</th>
                  <th className="py-1 pr-3 text-right font-medium">30 m cells</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {impRows.map((r) => {
                  const d = r.current == null ? null : r.nlcd - r.current
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-1 pr-3 font-medium text-fg">{r.id}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.current ?? '—'}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.nlcd}</td>
                      <td className={`py-1 pr-3 text-right tabular-nums ${d != null && Math.abs(d) >= 10 ? 'text-warning' : 'text-muted'}`}>{d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-muted">{r.cells}</td>
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
          )}
          {impRows.some((r) => r.cells < 4) && <p className="mb-0 mt-2 text-[11px] text-warning">Some subcatchments cover only a few 30 m cells, so their NLCD value is rough.</p>}
        </Panel>

        <Panel title={<span className="inline-flex items-center gap-2"><Sprout className="h-4 w-4 text-muted" />Soils: USDA SSURGO</span>}>
          <Source>
            Soil map units with hydrologic soil group and surface Ksat from NRCS Soil Data Access, added to the map layers. For each subcatchment the soils are area-weighted into
            parameters for the model's infiltration method ({soils.data?.method ?? 'from the model options'}): Green-Ampt suction and deficit after Rawls et al. (1983), Horton rates
            from the SWMM manual, or open-space curve numbers (TR-55). Dual groups such as B/D use the undrained group.
          </Source>
          <div className="mb-3 flex gap-2">
            <Button variant={soilRows.length ? 'outline' : 'primary'} disabled={soilsDl.isPending} onClick={() => soilsDl.mutate()}>
              <Download className="h-3.5 w-3.5" /> {soilsDl.isPending ? 'Downloading…' : soilRows.length ? 'Download again' : 'Download SSURGO soils'}
            </Button>
            {soilRows.length > 0 && (
              <Button variant="primary" disabled={soilsApply.isPending} onClick={() => soilsApply.mutate(undefined)}>
                Use for all {soilRows.length} subcatchments
              </Button>
            )}
          </div>
          {soilRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1 pr-3 font-medium">Subcatchment</th>
                    <th className="py-1 pr-3 font-medium">Soil groups</th>
                    {params.map((p) => (
                      <th key={p} className="py-1 pr-3 text-right font-medium">
                        {PARAM_LABEL[p] ?? p}
                      </th>
                    ))}
                    <th className="py-1 pr-3 text-right font-medium">Covered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {soilRows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-1 pr-3 font-medium text-fg">{r.id}</td>
                      <td className="py-1 pr-3 text-fg-soft">
                        {Object.entries(r.hsg_share)
                          .map(([g, p]) => `${g} ${p}%`)
                          .join(', ')}
                      </td>
                      {params.map((p) => (
                        <td key={p} className="py-1 pr-3 text-right tabular-nums">
                          {r.params[p] ?? '—'}
                        </td>
                      ))}
                      <td className={`py-1 pr-3 text-right tabular-nums ${r.covered_pct < 90 ? 'text-warning' : 'text-muted'}`}>{r.covered_pct}%</td>
                      <td className="py-1 text-right">
                        <button type="button" className="text-accent-soft hover:underline" onClick={() => soilsApply.mutate([r.id])}>
                          Use
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mb-0 mt-2 text-[11px] text-muted">Units: {soils.data?.units}. “Covered” is how much of the subcatchment has a mapped soil group; urban land often has none.</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
