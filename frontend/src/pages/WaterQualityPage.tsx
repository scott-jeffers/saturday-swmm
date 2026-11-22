/**
 * Water quality: pollutants, land uses with their buildup and washoff, and
 * how much of each subcatchment is each land use. A guided editor for
 * [POLLUTANTS], [LANDUSES], [BUILDUP], [WASHOFF] and [COVERAGES]; everything
 * else about quality (treatment, loadings) stays in INP text.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Plus, Save, Search, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { Button, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '../components/ui'
import { ManualLink } from '../components/ManualLink'
import { MANUAL } from '../lib/manual'
import { cn } from '../lib/cn'
import { parsePasteGrid } from '../lib/tableFilter'
import {
  BUILDUP_FNS,
  WASHOFF_FNS,
  coverageTotal,
  parseBuildup,
  parseCoverages,
  parseLandUses,
  parsePollutants,
  parseWashoff,
  renameEverywhere,
  serializeBuildup,
  serializeCoverages,
  serializeLandUses,
  serializePollutants,
  serializeWashoff,
  type Buildup,
  type Coverage,
  type LandUse,
  type Pollutant,
  type Washoff,
} from '../lib/waterQuality'

const SECTIONS = ['POLLUTANTS', 'LANDUSES', 'BUILDUP', 'WASHOFF', 'COVERAGES', 'SUBCATCHMENTS'] as const
const cell = 'field h-8 w-full text-[12.5px] tabular-nums'
const newPollutant = (name: string, units = 'MG/L'): Pollutant => ({
  name, units, rain: '0', gw: '0', rdii: '0', decay: '0', snowOnly: 'NO', coPoll: '*', coFrac: '0', dwf: '0', init: '0',
})

export function WaterQualityPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const results = useQueries({ queries: SECTIONS.map((s) => ({ queryKey: ['section', s], queryFn: () => api.getSection(s), retry: false })) })
  const q = Object.fromEntries(SECTIONS.map((s, i) => [s, results[i]!])) as Record<(typeof SECTIONS)[number], (typeof results)[number]>
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const loading = SECTIONS.some((s) => q[s].isLoading)

  const [pollutants, setPollutants] = useState<Pollutant[]>([])
  const [landuses, setLanduses] = useState<LandUse[]>([])
  const [buildup, setBuildup] = useState<Buildup[]>([])
  const [washoff, setWashoff] = useState<Washoff[]>([])
  const [coverage, setCoverage] = useState<Coverage>({})
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState('pollutants')
  const [selLu, setSelLu] = useState<string | null>(null)
  const [covFilter, setCovFilter] = useState('')

  const subs = useMemo(() => (q.SUBCATCHMENTS.data?.rows ?? []).map((r) => r.values[0]?.trim() ?? '').filter(Boolean), [q.SUBCATCHMENTS.data])
  const reset = () => {
    setPollutants(parsePollutants(q.POLLUTANTS.data?.rows ?? []))
    setLanduses(parseLandUses(q.LANDUSES.data?.rows ?? []))
    setBuildup(parseBuildup(q.BUILDUP.data?.rows ?? []))
    setWashoff(parseWashoff(q.WASHOFF.data?.rows ?? []))
    setCoverage(parseCoverages(q.COVERAGES.data?.rows ?? []))
    setDirty(false)
  }
  useEffect(() => {
    if (!loading && !dirty) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, q.POLLUTANTS.data, q.LANDUSES.data, q.BUILDUP.data, q.WASHOFF.data, q.COVERAGES.data])
  const lu = landuses.find((l) => l.name === selLu) ?? landuses[0]

  const save = useMutation({
    mutationFn: async () => {
      // Pollutants and land uses first: buildup, washoff and coverage refer to them.
      await api.putSection('POLLUTANTS', { rows: serializePollutants(pollutants) })
      await api.putSection('LANDUSES', { rows: serializeLandUses(landuses) })
      await api.putSection('BUILDUP', { rows: serializeBuildup(buildup) })
      await api.putSection('WASHOFF', { rows: serializeWashoff(washoff) })
      await api.putSection('COVERAGES', { rows: serializeCoverages(coverage, subs) })
    },
    onSuccess: () => {
      setDirty(false)
      for (const k of ['section', 'network', 'inp', 'model-check']) void qc.invalidateQueries({ queryKey: [k] })
      toast({ title: 'Saved water quality', description: 'Run the model to see pollutant results.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save water quality', description: e.message, tone: 'danger' }),
  })

  const touch = () => setDirty(true)
  const editPollutant = (i: number, patch: Partial<Pollutant>) => {
    const old = pollutants[i]!
    let next = pollutants.map((p, j) => (j === i ? { ...p, ...patch } : p))
    if (patch.name !== undefined && patch.name !== old.name && old.name) {
      const r = renameEverywhere('pollutant', old.name, patch.name, { pollutants: next, buildup, washoff, coverage })
      next = r.pollutants
      setBuildup(r.buildup)
      setWashoff(r.washoff)
    }
    setPollutants(next)
    touch()
  }
  const addPollutant = (name: string, units?: string) => {
    let n = name
    for (let k = 2; pollutants.some((p) => p.name === n); k++) n = `${name}${k}`
    setPollutants([...pollutants, newPollutant(n, units)])
    touch()
  }
  const removePollutant = (i: number) => {
    const name = pollutants[i]!.name
    setPollutants(pollutants.filter((_, j) => j !== i).map((p) => (p.coPoll === name ? { ...p, coPoll: '*', coFrac: '0' } : p)))
    setBuildup(buildup.filter((b) => b.pollutant !== name))
    setWashoff(washoff.filter((w) => w.pollutant !== name))
    touch()
  }
  const editLandUse = (patch: Partial<LandUse>) => {
    if (!lu) return
    if (patch.name !== undefined && patch.name !== lu.name) {
      if (!patch.name.trim() || landuses.some((l) => l.name === patch.name)) return
      const r = renameEverywhere('landuse', lu.name, patch.name, { pollutants, buildup, washoff, coverage })
      setBuildup(r.buildup)
      setWashoff(r.washoff)
      setCoverage(r.coverage)
      setSelLu(patch.name)
    }
    setLanduses(landuses.map((l) => (l.name === lu.name ? { ...l, ...patch } : l)))
    touch()
  }
  const addLandUse = () => {
    let n = 'Residential'
    const names = ['Residential', 'Commercial', 'Industrial', 'Open space', 'Roads']
    n = names.find((x) => !landuses.some((l) => l.name === x.replace(/\s/g, '_'))) ?? `Landuse${landuses.length + 1}`
    n = n.replace(/\s/g, '_')
    setLanduses([...landuses, { name: n, sweepInterval: '0', availability: '0', lastSwept: '0' }])
    setSelLu(n)
    touch()
  }
  const removeLandUse = () => {
    if (!lu) return
    setLanduses(landuses.filter((l) => l.name !== lu.name))
    setBuildup(buildup.filter((b) => b.landuse !== lu.name))
    setWashoff(washoff.filter((w) => w.landuse !== lu.name))
    setCoverage(Object.fromEntries(Object.entries(coverage).map(([s, m]) => [s, Object.fromEntries(Object.entries(m).filter(([k]) => k !== lu.name))])))
    setSelLu(null)
    touch()
  }
  const getB = (p: string): Buildup =>
    buildup.find((b) => b.landuse === lu?.name && b.pollutant === p) ?? { landuse: lu?.name ?? '', pollutant: p, fn: 'NONE', c1: '0', c2: '0', c3: '0', perUnit: 'AREA' }
  const getW = (p: string): Washoff =>
    washoff.find((w) => w.landuse === lu?.name && w.pollutant === p) ?? { landuse: lu?.name ?? '', pollutant: p, fn: 'NONE', c1: '0', c2: '0', sweep: '0', bmp: '0' }
  const setB = (p: string, patch: Partial<Buildup>) => {
    const cur = { ...getB(p), ...patch }
    setBuildup([...buildup.filter((b) => !(b.landuse === cur.landuse && b.pollutant === p)), cur])
    touch()
  }
  const setW = (p: string, patch: Partial<Washoff>) => {
    const cur = { ...getW(p), ...patch }
    setWashoff([...washoff.filter((w) => !(w.landuse === cur.landuse && w.pollutant === p)), cur])
    touch()
  }
  const setCov = (sub: string, landuse: string, value: string) => {
    setCoverage((c) => ({ ...c, [sub]: { ...(c[sub] ?? {}), [landuse]: value } }))
    touch()
  }
  const shownSubs = subs.filter((s) => s.toLowerCase().includes(covFilter.trim().toLowerCase()))
  const onCovPaste = (e: React.ClipboardEvent, sub: string, landuse: string) => {
    const grid = parsePasteGrid(e.clipboardData.getData('text/plain'))
    if (!grid) return
    e.preventDefault()
    const r0 = shownSubs.indexOf(sub)
    const c0 = landuses.findIndex((l) => l.name === landuse)
    setCoverage((c) => {
      const next = { ...c }
      grid.forEach((row, ri) => {
        const s = shownSubs[r0 + ri]
        if (!s) return
        row.forEach((val, ci) => {
          const l = landuses[c0 + ci]
          if (l) next[s] = { ...(next[s] ?? {}), [l.name]: val.trim() }
        })
      })
      return next
    })
    touch()
  }
  const overFull = subs.filter((s) => coverageTotal(coverage[s]) > 100.0001)
  const massUnit = (perUnit: string) => `${us ? 'lb' : 'kg'} per ${perUnit === 'CURB' ? (us ? 'ft of curb' : 'm of curb') : us ? 'acre' : 'hectare'}`

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Water quality"
          description="What the runoff carries: pollutants, how they build up on each land use and wash off in storms, and which land uses make up each subcatchment."
          actions={
            <>
              <ManualLink href={MANUAL.inputFormat}>Quality sections in the manual</ManualLink>
              {dirty && (
                <Button variant="ghost" size="sm" onClick={reset}>
                  <Undo2 className="h-3.5 w-3.5" /> Discard
                </Button>
              )}
              <Button variant="primary" size="sm" disabled={!dirty || save.isPending || overFull.length > 0} onClick={() => save.mutate()}>
                <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        />

        {!loading && pollutants.length === 0 && landuses.length === 0 ? (
          <section className="mt-6 rounded-[var(--radius-panel)] border border-dashed border-border bg-elevated px-8 py-10 text-center">
            <FlaskConical className="mx-auto h-8 w-8 text-ic-water" />
            <h2 className="mb-1 mt-3 text-[15px] font-semibold text-fg">This model doesn’t track any pollutants yet</h2>
            <p className="mx-auto mb-5 mt-0 max-w-xl text-[13px] text-fg-soft">
              Add a pollutant, then the land uses it builds up on. Total suspended solids (TSS) is the usual place to start.
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="primary" onClick={() => addPollutant('TSS', 'MG/L')}>
                <Plus className="h-3.5 w-3.5" /> Add TSS
              </Button>
              <Button variant="outline" onClick={() => addPollutant('Pollutant')}>
                <Plus className="h-3.5 w-3.5" /> Add a pollutant
              </Button>
            </div>
          </section>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mt-2">
              <TabsTrigger value="pollutants">Pollutants <span className="text-[11px] text-muted">{pollutants.length}</span></TabsTrigger>
              <TabsTrigger value="landuses">Land uses <span className="text-[11px] text-muted">{landuses.length}</span></TabsTrigger>
              <TabsTrigger value="coverage">
                Coverage {overFull.length > 0 && <span className="text-[11px] text-danger">{overFull.length} over 100 %</span>}
              </TabsTrigger>
            </TabsList>

            {/* ------------------------------------------------ pollutants */}
            <TabsContent value="pollutants" className="mt-4">
              <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-border bg-elevated">
                <table className="w-full min-w-[980px] border-collapse text-left text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-[11.5px] text-muted">
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-1 py-2 font-medium">Units</th>
                      <th className="px-1 py-2 font-medium" title="Concentration in rainfall">In rain</th>
                      <th className="px-1 py-2 font-medium" title="Concentration in groundwater">In groundwater</th>
                      <th className="px-1 py-2 font-medium" title="Concentration in rainfall-derived infiltration and inflow">In RDII</th>
                      <th className="px-1 py-2 font-medium" title="Concentration in dry-weather flow">In dry-weather flow</th>
                      <th className="px-1 py-2 font-medium" title="Concentration in the system at the start of the run">At start</th>
                      <th className="px-1 py-2 font-medium" title="First-order decay coefficient">Decay (1/day)</th>
                      <th className="px-1 py-2 font-medium" title="Builds up only during snowfall">Snow only</th>
                      <th className="px-1 py-2 font-medium" title="Another pollutant whose runoff concentration adds to this one">Co-pollutant</th>
                      <th className="px-1 py-2 font-medium" title="Fraction of the co-pollutant's concentration added">Fraction</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {pollutants.map((p, i) => (
                      <tr key={i} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-1">
                          <input className={cn(cell, 'font-medium')} value={p.name} aria-label="Name" onChange={(e) => editPollutant(i, { name: e.target.value.replace(/\s/g, '_') })} />
                        </td>
                        <td className="px-1 py-1">
                          <select className={cell} value={p.units} aria-label="Units" onChange={(e) => editPollutant(i, { units: e.target.value })}>
                            <option value="MG/L">mg/L</option>
                            <option value="UG/L">µg/L</option>
                            <option value="#/L">count/L</option>
                          </select>
                        </td>
                        {(['rain', 'gw', 'rdii', 'dwf', 'init', 'decay'] as const).map((k) => (
                          <td key={k} className="px-1 py-1">
                            <input className={cn(cell, 'text-right')} value={p[k]} aria-label={k} onChange={(e) => editPollutant(i, { [k]: e.target.value })} />
                          </td>
                        ))}
                        <td className="px-1 py-1">
                          <select className={cell} value={p.snowOnly} aria-label="Snow only" onChange={(e) => editPollutant(i, { snowOnly: e.target.value })}>
                            <option value="NO">No</option>
                            <option value="YES">Yes</option>
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select className={cell} value={p.coPoll} aria-label="Co-pollutant" onChange={(e) => editPollutant(i, { coPoll: e.target.value })}>
                            <option value="*">None</option>
                            {pollutants.filter((o) => o.name !== p.name).map((o) => (
                              <option key={o.name} value={o.name}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input className={cn(cell, 'text-right')} disabled={p.coPoll === '*'} value={p.coFrac} aria-label="Co-pollutant fraction" onChange={(e) => editPollutant(i, { coFrac: e.target.value })} />
                        </td>
                        <td className="px-1 py-1 text-right">
                          <button type="button" aria-label={`Remove ${p.name}`} onClick={() => removePollutant(i)} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => addPollutant('Pollutant')}>
                  <Plus className="h-3.5 w-3.5" /> Add pollutant
                </Button>
                <p className="m-0 self-center text-[12px] text-muted">Concentrations are in each pollutant’s units. Removing one also removes its buildup and washoff.</p>
              </div>
            </TabsContent>

            {/* ------------------------------------------------ land uses */}
            <TabsContent value="landuses" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div className="flex flex-col gap-1.5">
                  {landuses.map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      onClick={() => setSelLu(l.name)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left text-[13px]',
                        lu?.name === l.name ? 'border-accent/60 bg-accent/10 font-medium text-fg' : 'border-border bg-elevated text-fg-soft hover:border-border-strong',
                      )}
                    >
                      {l.name.replace(/_/g, ' ')}
                      <span className="block text-[11px] font-normal text-muted">
                        {subs.filter((s) => Number(coverage[s]?.[l.name]) > 0).length} subcatchments
                      </span>
                    </button>
                  ))}
                  <Button size="sm" variant="outline" onClick={addLandUse}>
                    <Plus className="h-3.5 w-3.5" /> New land use
                  </Button>
                </div>
                {lu ? (
                  <div className="space-y-4">
                    <section className="rounded-[var(--radius-panel)] border border-border bg-elevated p-4">
                      <div className="flex items-start gap-3">
                        <label className="block flex-1 text-[12px] font-medium text-fg-soft">
                          Name
                          <input className="field mt-1 w-full" value={lu.name} onChange={(e) => editLandUse({ name: e.target.value.replace(/\s/g, '_') })} />
                        </label>
                        <Button size="sm" variant="ghost" className="mt-5 text-danger hover:text-danger" onClick={removeLandUse}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                      <h3 className="mb-2 mt-4 text-[12.5px] font-semibold text-fg">Street sweeping</h3>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {([
                          ['sweepInterval', 'Every (days)', '0 = no sweeping'],
                          ['availability', 'Share sweepable', 'Fraction of buildup a sweeper can reach'],
                          ['lastSwept', 'Days since last swept', 'At the start of the run'],
                        ] as const).map(([k, label, hint]) => (
                          <label key={k} className="block text-[12px] font-medium text-fg-soft">
                            {label}
                            <input className="field mt-1 w-full text-right tabular-nums" value={lu[k]} onChange={(e) => editLandUse({ [k]: e.target.value })} />
                            <span className="mt-0.5 block text-[11px] font-normal text-muted">{hint}</span>
                          </label>
                        ))}
                      </div>
                    </section>
                    {pollutants.length === 0 ? (
                      <p className="text-[13px] text-muted">Add a pollutant on the Pollutants tab to set how it builds up and washes off here.</p>
                    ) : (
                      pollutants.map((p) => {
                        const b = getB(p.name)
                        const w = getW(p.name)
                        const bf = BUILDUP_FNS.find((f) => f.key === b.fn) ?? BUILDUP_FNS[0]!
                        const wf = WASHOFF_FNS.find((f) => f.key === w.fn) ?? WASHOFF_FNS[0]!
                        return (
                          <section key={p.name} className="rounded-[var(--radius-panel)] border border-border bg-elevated p-4">
                            <h3 className="m-0 text-[13px] font-semibold text-fg">
                              {p.name} <span className="font-normal text-muted">on {lu.name.replace(/_/g, ' ')}</span>
                            </h3>
                            <div className="mt-3 grid gap-4 lg:grid-cols-2">
                              <div>
                                <label className="block text-[12px] font-medium text-fg-soft">
                                  Buildup between storms
                                  <select className="field mt-1 w-full" value={b.fn} onChange={(e) => setB(p.name, { fn: e.target.value })}>
                                    {BUILDUP_FNS.map((f) => (
                                      <option key={f.key} value={f.key}>
                                        {f.label}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="mt-0.5 block text-[11px] font-normal text-muted">{bf.help}</span>
                                </label>
                                {b.fn !== 'NONE' && (
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    {(['c1', 'c2', 'c3'] as const).map((k, i) =>
                                      bf.coeffs[i] ? (
                                        <label key={k} className="block text-[11.5px] text-fg-soft">
                                          {bf.coeffs[i]}
                                          {i === 0 && <span className="text-muted"> ({massUnit(b.perUnit)})</span>}
                                          <input className={cn(cell, 'mt-0.5', i < 2 || b.fn !== 'EXT' ? 'text-right' : '')} value={b[k]} onChange={(e) => setB(p.name, { [k]: e.target.value })} />
                                        </label>
                                      ) : null,
                                    )}
                                    <label className="block text-[11.5px] text-fg-soft">
                                      Per
                                      <select className={cn(cell, 'mt-0.5')} value={b.perUnit} onChange={(e) => setB(p.name, { perUnit: e.target.value })}>
                                        <option value="AREA">{us ? 'acre' : 'hectare'} of land</option>
                                        <option value="CURB">length of curb</option>
                                      </select>
                                    </label>
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="block text-[12px] font-medium text-fg-soft">
                                  Washoff in storms
                                  <select className="field mt-1 w-full" value={w.fn} onChange={(e) => setW(p.name, { fn: e.target.value })}>
                                    {WASHOFF_FNS.map((f) => (
                                      <option key={f.key} value={f.key}>
                                        {f.label}
                                      </option>
                                    ))}
                                  </select>
                                  <span className="mt-0.5 block text-[11px] font-normal text-muted">{wf.help}</span>
                                </label>
                                {w.fn !== 'NONE' && (
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    {(['c1', 'c2'] as const).map((k, i) =>
                                      wf.coeffs[i] ? (
                                        <label key={k} className="block text-[11.5px] text-fg-soft">
                                          {wf.coeffs[i]}
                                          {w.fn === 'EMC' && <span className="text-muted"> ({p.units === 'UG/L' ? 'µg/L' : p.units === '#/L' ? 'count/L' : 'mg/L'})</span>}
                                          <input className={cn(cell, 'mt-0.5 text-right')} value={w[k]} onChange={(e) => setW(p.name, { [k]: e.target.value })} />
                                        </label>
                                      ) : null,
                                    )}
                                    <label className="block text-[11.5px] text-fg-soft">
                                      Removed by sweeping (%)
                                      <input className={cn(cell, 'mt-0.5 text-right')} value={w.sweep} onChange={(e) => setW(p.name, { sweep: e.target.value })} />
                                    </label>
                                    <label className="block text-[11.5px] text-fg-soft">
                                      Removed by BMPs (%)
                                      <input className={cn(cell, 'mt-0.5 text-right')} value={w.bmp} onChange={(e) => setW(p.name, { bmp: e.target.value })} />
                                    </label>
                                  </div>
                                )}
                              </div>
                            </div>
                          </section>
                        )
                      })
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">Add a land use (residential, commercial, roads…) to say how pollutants build up and wash off on it.</p>
                )}
              </div>
            </TabsContent>

            {/* ------------------------------------------------ coverage */}
            <TabsContent value="coverage" className="mt-4">
              {landuses.length === 0 ? (
                <p className="text-[13px] text-muted">Add land uses first; then set how much of each subcatchment they cover.</p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <label className="relative block w-56">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                      <input className="field h-8 w-full pl-8" placeholder="Filter subcatchments" value={covFilter} onChange={(e) => setCovFilter(e.target.value)} />
                    </label>
                    <p className="m-0 text-[12px] text-muted">
                      Percent of each subcatchment’s area. Paste a block from Excel into any cell.
                      {overFull.length > 0 && <span className="text-danger"> {overFull.length} add up to more than 100 %; fix them to save.</span>}
                    </p>
                  </div>
                  <div className="max-h-[calc(100vh-280px)] overflow-auto rounded-[var(--radius-panel)] border border-border bg-elevated">
                    <table className="w-full border-collapse text-left text-[12.5px]">
                      <thead className="sticky top-0 z-10 bg-elevated">
                        <tr className="border-b border-border text-[11.5px] text-muted">
                          <th className="px-3 py-2 font-medium">Subcatchment</th>
                          {landuses.map((l) => (
                            <th key={l.name} className="w-32 px-1 py-2 text-right font-medium">
                              {l.name.replace(/_/g, ' ')} %
                            </th>
                          ))}
                          <th className="w-24 px-3 py-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownSubs.map((s) => {
                          const total = coverageTotal(coverage[s])
                          return (
                            <tr key={s} className="border-b border-border/60 last:border-0">
                              <td className="px-3 py-0.5 font-medium text-fg">{s}</td>
                              {landuses.map((l) => (
                                <td key={l.name} className="w-32 px-1 py-0.5">
                                  <input
                                    className="h-7 w-full min-w-[4.5rem] rounded border border-transparent bg-transparent px-2 text-right tabular-nums text-fg hover:border-border focus:border-accent focus:bg-surface focus:outline-none"
                                    value={coverage[s]?.[l.name] ?? ''}
                                    placeholder="0"
                                    aria-label={`${s} ${l.name} percent`}
                                    onChange={(e) => setCov(s, l.name, e.target.value)}
                                    onPaste={(e) => onCovPaste(e, s, l.name)}
                                  />
                                </td>
                              ))}
                              <td className={cn('px-3 py-0.5 text-right tabular-nums', total > 100.0001 ? 'font-medium text-danger' : total === 0 ? 'text-muted' : 'text-fg-soft')}>
                                {total ? `${+total.toFixed(2)} %` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
