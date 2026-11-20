/**
 * LID controls: each design as a cross-section of its layers with labelled
 * parameters, and where it is placed ([LID_USAGE]). Editable in the app,
 * read-only in the browser viewer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Button, PageHeader, useToast } from '../components/ui'
import { cn } from '../lib/cn'
import {
  LAYER_LABEL,
  LAYER_PARAMS,
  LID_TYPES,
  layerThickness,
  newDesign,
  parseLidControls,
  parseLidUsage,
  serializeLidControls,
  serializeLidUsage,
  unitLabel,
  type LidDesign,
  type LidLayer,
  type LidType,
  type LidUse,
} from '../lib/lid'
import { focusOnMap } from '../lib/mapFocus'
import { ManualLink } from '../components/ManualLink'
import { MANUAL } from '../lib/manual'
import { IS_VIEWER } from '../lib/mode'

const READ_ONLY = IS_VIEWER

export function LidPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const controls = useQuery({ queryKey: ['section', 'LID_CONTROLS'], queryFn: () => api.getSection('LID_CONTROLS'), retry: false })
  const usage = useQuery({ queryKey: ['section', 'LID_USAGE'], queryFn: () => api.getSection('LID_USAGE'), retry: false })
  const subsSec = useQuery({ queryKey: ['section', 'SUBCATCHMENTS'], queryFn: () => api.getSection('SUBCATCHMENTS'), retry: false })
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())

  const [designs, setDesigns] = useState<LidDesign[]>([])
  const [uses, setUses] = useState<LidUse[]>([])
  const [dirty, setDirty] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [layer, setLayer] = useState<LidLayer | null>(null)

  const reset = () => {
    const d = parseLidControls(controls.data?.rows ?? [])
    setDesigns(d)
    setUses(parseLidUsage(usage.data?.rows ?? []))
    setDirty(false)
    setSel((s) => (s && d.some((x) => x.name === s) ? s : d[0]?.name ?? null))
  }
  useEffect(reset, [controls.data, usage.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const subs = useMemo(
    () =>
      (subsSec.data?.rows ?? [])
        .map((r) => ({ id: r.values[0] ?? '', area: Number(r.values[3]) }))
        .filter((s) => s.id)
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    [subsSec.data],
  )
  const subArea = useMemo(() => new Map(subs.map((s) => [s.id, s.area])), [subs])

  const design = designs.find((d) => d.name === sel) ?? null
  const designUses = uses.map((u, i) => ({ u, i })).filter(({ u }) => u.lid === sel)

  const save = useMutation({
    mutationFn: async () => {
      await api.putSection('LID_CONTROLS', { rows: serializeLidControls(designs) })
      await api.putSection('LID_USAGE', { rows: serializeLidUsage(uses) })
    },
    onSuccess: () => {
      setDirty(false)
      for (const k of ['section', 'network', 'object', 'inp', 'model-check']) void qc.invalidateQueries({ queryKey: [k] })
      toast({ title: 'Saved LID controls', description: 'Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save LID controls', description: e.message, tone: 'danger' }),
  })

  const editDesign = (fn: (d: LidDesign) => LidDesign) => {
    if (!design) return
    setDesigns((all) => all.map((d) => (d.name === design.name ? fn(d) : d)))
    setDirty(true)
  }
  const editUse = (i: number, patch: Partial<LidUse>) => {
    setUses((all) => all.map((u, j) => (j === i ? { ...u, ...patch } : u)))
    setDirty(true)
  }

  const addDesign = (type: LidType) => {
    const base = LID_TYPES[type].label.replace(/[^A-Za-z]/g, '')
    let n = 1
    while (designs.some((d) => d.name === `${base}${n}`)) n++
    const d = newDesign(`${base}${n}`, type, us)
    setDesigns((all) => [...all, d])
    setSel(d.name)
    setLayer(null)
    setDirty(true)
  }

  const renameDesign = (to: string) => {
    if (!design || !to || to === design.name || /\s/.test(to) || designs.some((d) => d.name === to)) return
    const from = design.name
    setDesigns((all) => all.map((d) => (d.name === from ? { ...d, name: to } : d)))
    setUses((all) => all.map((u) => (u.lid === from ? { ...u, lid: to } : u)))
    setSel(to)
    setDirty(true)
  }

  const deleteDesign = () => {
    if (!design) return
    const from = design.name
    setDesigns((all) => all.filter((d) => d.name !== from))
    setUses((all) => all.filter((u) => u.lid !== from))
    setSel(designs.find((d) => d.name !== from)?.name ?? null)
    setDirty(true)
  }

  const totalUnits = (lid: string) => uses.filter((u) => u.lid === lid).length
  const loading = controls.isLoading || usage.isLoading

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="LID controls"
          description="Green infrastructure in the model: rain gardens, permeable paving, green roofs and the like, and the subcatchments they treat."
          actions={
            <>
              <ManualLink href={MANUAL.lid}>How LID controls work</ManualLink>
              {!READ_ONLY && (
              <>
                {dirty && (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <Undo2 className="h-3.5 w-3.5" /> Discard
                  </Button>
                )}
                <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                  <Save className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </>
              )}
            </>
          }
        />

        {!loading && designs.length === 0 ? (
          <EmptyState onAdd={READ_ONLY ? null : addDesign} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <aside>
              <ul className="m-0 list-none space-y-1 p-0">
                {designs.map((d) => {
                  const t = LID_TYPES[d.type]
                  const n = totalUnits(d.name)
                  return (
                    <li key={d.name}>
                      <button
                        type="button"
                        onClick={() => {
                          setSel(d.name)
                          setLayer(null)
                        }}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors',
                          sel === d.name ? 'border-accent/50 bg-accent/[0.07]' : 'border-transparent hover:bg-fg/[0.04]',
                        )}
                      >
                        <TypeMark type={d.type} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-fg">{d.name}</span>
                          <span className="block truncate text-[11px] text-muted">{t.label}</span>
                        </span>
                        <span className={cn('text-[11px] tabular-nums', n ? 'text-fg-soft' : 'text-muted')} title="Subcatchments using it">
                          {n || 'unused'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {!READ_ONLY && <NewDesignMenu onPick={addDesign} />}
            </aside>

            {design && (
              <section className="min-w-0 space-y-5">
                <div className="flex flex-wrap items-start gap-3">
                  <TypeMark type={design.type} large />
                  <div className="min-w-0 flex-1">
                    {READ_ONLY ? (
                      <h2 className="m-0 text-[16px] font-semibold text-fg">{design.name}</h2>
                    ) : (
                      <input
                        key={design.name}
                        defaultValue={design.name}
                        aria-label="Design name"
                        onBlur={(e) => renameDesign(e.target.value.trim())}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        className="-ml-1 w-full rounded-md border border-transparent bg-transparent px-1 text-[16px] font-semibold text-fg hover:border-border focus:border-accent focus:outline-none"
                      />
                    )}
                    <p className="m-0 text-[12px] text-muted">
                      {LID_TYPES[design.type].label} · {LID_TYPES[design.type].blurb}
                    </p>
                  </div>
                  {!READ_ONLY && (
                    <Button variant="ghost" size="sm" onClick={deleteDesign} title="Delete this design and its placements">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <CrossSection design={design} us={us} active={layer} onPick={setLayer} />
                  <LayerForm design={design} us={us} active={layer ?? presentLayers(design)[0] ?? null} onPick={setLayer} onChange={editDesign} />
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="m-0 text-[13px] font-semibold text-fg">Where it’s used</h3>
                    <span className="text-[12px] text-muted">
                      {designUses.length ? `${designUses.length} subcatchment${designUses.length === 1 ? '' : 's'}` : 'Not placed in any subcatchment yet'}
                    </span>
                  </div>
                  <UsageTable
                    rows={designUses}
                    subs={subs}
                    subArea={subArea}
                    us={us}
                    onChange={editUse}
                    onRemove={(i) => {
                      setUses((all) => all.filter((_, j) => j !== i))
                      setDirty(true)
                    }}
                    onShow={(id) => {
                      focusOnMap({ object_type: 'subcatchment', id })
                      navigate('/map')
                    }}
                  />
                  {!READ_ONLY && subs.length > 0 && (
                    <AddUse
                      subs={subs.filter((s) => !designUses.some(({ u }) => u.subcatchment === s.id))}
                      onAdd={(sub) => {
                        setUses((all) => [
                          ...all,
                          { subcatchment: sub, lid: design.name, number: '1', area: us ? '100' : '10', width: '0', initSat: '0', fromImp: '25', toPerv: '0', rptFile: '', drainTo: '', fromPerv: '' },
                        ])
                        setDirty(true)
                      }}
                    />
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function presentLayers(d: LidDesign): LidLayer[] {
  const order: LidLayer[] = ['SURFACE', 'PAVEMENT', 'SOIL', 'STORAGE', 'DRAINMAT', 'DRAIN']
  return order.filter((l) => d.layers[l])
}

function TypeMark({ type, large }: { type: LidType; large?: boolean }) {
  const t = LID_TYPES[type]
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white', large ? 'h-9 w-9 text-[12px]' : 'h-7 w-7 text-[10px]')}
      style={{ background: t.color }}
      aria-hidden
    >
      {type}
    </span>
  )
}

function EmptyState({ onAdd }: { onAdd: ((t: LidType) => void) | null }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="m-0 text-[14px] font-medium text-fg">No LID controls in this model</p>
      <p className="mx-auto mb-5 mt-1 max-w-md text-[12px] text-muted">
        {onAdd ? 'Pick a type to start a design. You can then place it in any subcatchment.' : 'Designs added in the Saturday-SWMM app show up here.'}
      </p>
      {onAdd && (
        <div className="mx-auto grid max-w-2xl gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(LID_TYPES) as LidType[]).map((t) => (
            <button key={t} type="button" onClick={() => onAdd(t)} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left hover:border-border-strong hover:bg-fg/[0.03]">
              <TypeMark type={t} />
              <span className="text-[12px] text-fg-soft">{LID_TYPES[t].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NewDesignMenu({ onPick }: { onPick: (t: LidType) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])
  return (
    <div ref={ref} className="relative mt-2">
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen((v) => !v)}>
        <Plus className="h-3.5 w-3.5" /> New design
      </Button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 top-9 z-20 rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]">
          {(Object.keys(LID_TYPES) as LidType[]).map((t) => (
            <button
              key={t}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false)
                onPick(t)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-fg-soft hover:bg-fg/[0.06]"
            >
              <TypeMark type={t} />
              {LID_TYPES[t].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ cross-section */

const BAND: Record<Exclude<LidLayer, 'DRAIN' | 'REMOVALS'>, { fill: string; pattern?: string }> = {
  SURFACE: { fill: '#e0f2fe' },
  PAVEMENT: { fill: '#9ca3af', pattern: 'lid-brick' },
  SOIL: { fill: '#a87c4f', pattern: 'lid-soil' },
  STORAGE: { fill: '#d6d3d1', pattern: 'lid-gravel' },
  DRAINMAT: { fill: '#475569' },
}

function CrossSection({ design, us, active, onPick }: { design: LidDesign; us: boolean; active: LidLayer | null; onPick: (l: LidLayer) => void }) {
  const unit = unitLabel('depth', us)
  const isBarrel = design.type === 'RB'
  const bands = (['SURFACE', 'PAVEMENT', 'SOIL', 'STORAGE', 'DRAINMAT'] as const).filter((l) => design.layers[l] && !(isBarrel && l !== 'STORAGE'))
  const thick = bands.map((l) => Math.max(layerThickness(design, l), 0))
  const total = thick.reduce((a, b) => a + b, 0) || 1
  const W = 360
  const H = 210
  const top = 22
  const avail = H - top - 26
  // Proportional, but every layer stays tall enough to read and click.
  const raw = thick.map((t) => Math.max(24, (t / total) * avail))
  const scale = Math.min(1, avail / raw.reduce((a, b) => a + b, 0))
  const hs = raw.map((h) => h * scale)
  let y = top
  const veg = Number(design.layers.SURFACE?.[1] ?? 0) > 0 || ['BC', 'RG', 'GR', 'VS'].includes(design.type)
  const drain = design.layers.DRAIN
  const drainOn = drain && Number(drain[0]) > 0
  const bottom = top + hs.reduce((a, b) => a + b, 0)
  const offset = drain ? Number(drain[2] ?? 0) : 0
  const storeIdx = bands.findIndex((b) => b === 'STORAGE')
  const storeH = storeIdx >= 0 ? hs[storeIdx]! : 0
  const storeT = storeIdx >= 0 ? thick[storeIdx]! : 0
  const drainY = storeIdx >= 0 ? bottom - Math.min(storeH - 8, Math.max(8, storeT ? (offset / storeT) * storeH : 8)) : bottom - 8

  return (
    <figure className="m-0 rounded-xl border border-border bg-surface p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Cross-section of ${design.name}`}>
        <defs>
          <pattern id="lid-soil" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="3" r="0.9" fill="#00000030" />
            <circle cx="7" cy="7" r="0.7" fill="#ffffff30" />
          </pattern>
          <pattern id="lid-gravel" width="14" height="12" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="3" fill="none" stroke="#78716c80" />
            <circle cx="11" cy="9" r="2.4" fill="none" stroke="#78716c80" />
          </pattern>
          <pattern id="lid-brick" width="20" height="10" patternUnits="userSpaceOnUse">
            <path d="M0 0H20M0 5H20M10 0V5M0 5V10M20 5V10" stroke="#00000035" strokeWidth="1" fill="none" />
          </pattern>
          <pattern id="lid-native" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0V8" stroke="#78716c55" strokeWidth="1.2" />
          </pattern>
        </defs>

        {/* native ground */}
        <rect x="0" y={bottom} width={W} height={H - bottom} fill="url(#lid-native)" />
        {isBarrel ? (
          <g>
            <rect x={W / 2 - 50} y={top} width="100" height={bottom - top} rx="14" fill="#cffafe" stroke="#0891b2" strokeWidth="2" onClick={() => onPick('STORAGE')} className="cursor-pointer" />
            <rect x={W / 2 - 48} y={top + (bottom - top) * 0.45} width="96" height={(bottom - top) * 0.55 - 2} rx="12" fill="#67e8f9" opacity="0.6" pointerEvents="none" />
            <text x={W / 2} y={top + 18} textAnchor="middle" className="fill-[#0e7490] text-[11px] font-medium">
              Barrel {design.layers.STORAGE?.[0]} {unit}
            </text>
          </g>
        ) : (
          bands.map((l, i) => {
            const h = hs[i]!
            const yy = y
            y += h
            const b = BAND[l]
            const on = active === l
            return (
              <g key={l} onClick={() => onPick(l)} className="cursor-pointer">
                <rect x="40" y={yy} width={W - 80} height={h} fill={b.fill} />
                {b.pattern && <rect x="40" y={yy} width={W - 80} height={h} fill={`url(#${b.pattern})`} />}
                {l === 'SURFACE' && <rect x="40" y={yy + h * 0.55} width={W - 80} height={h * 0.45} fill="#7dd3fc" opacity="0.7" />}
                <rect x="40" y={yy} width={W - 80} height={h} fill="none" stroke={on ? 'var(--color-accent)' : '#00000022'} strokeWidth={on ? 2.5 : 1} />
                <text x="50" y={yy + Math.min(h / 2 + 4, 18)} className={cn('text-[11px] font-medium', l === 'DRAINMAT' || l === 'PAVEMENT' ? 'fill-white' : 'fill-[#1f2937]')}>
                  {LAYER_LABEL[l]}
                </text>
                <text x={W - 50} y={yy + Math.min(h / 2 + 4, 18)} textAnchor="end" className={cn('text-[11px] tabular-nums', l === 'DRAINMAT' || l === 'PAVEMENT' ? 'fill-white/90' : 'fill-[#374151]')}>
                  {l === 'SURFACE' ? `berm ${design.layers.SURFACE?.[0] ?? 0} ${unit}` : `${design.layers[l]?.[0] ?? 0} ${unit}`}
                </text>
              </g>
            )
          })
        )}
        {/* plants on top */}
        {!isBarrel && veg && bands[0] === 'SURFACE' && (
          <g fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round">
            {[70, 120, 175, 230, 285].map((x) => (
              <path key={x} d={`M${x} ${top + 2} q-4 -10 -8 -14 M${x} ${top + 2} q2 -12 0 -18 M${x} ${top + 2} q5 -9 10 -12`} />
            ))}
          </g>
        )}
        {/* underdrain */}
        {drain && (
          <g onClick={() => onPick('DRAIN')} className="cursor-pointer">
            <line x1={isBarrel ? W / 2 + 50 : W - 40} y1={drainY} x2={W - 4} y2={drainY} stroke={drainOn ? '#0369a1' : '#94a3b8'} strokeWidth="6" strokeLinecap="round" strokeDasharray={drainOn ? undefined : '3 4'} />
            <circle cx={isBarrel ? W / 2 + 50 : W - 46} cy={drainY} r="7" fill={drainOn ? '#0ea5e9' : '#cbd5e1'} stroke={active === 'DRAIN' ? 'var(--color-accent)' : '#0f172a55'} strokeWidth={active === 'DRAIN' ? 2.5 : 1.5} />
          </g>
        )}
        {/* seepage arrows */}
        {design.layers.STORAGE && Number(design.layers.STORAGE[2] ?? 0) > 0 && (
          <g stroke="#78716c" strokeWidth="1.5" fill="#78716c">
            {[110, 180, 250].map((x) => (
              <g key={x}>
                <line x1={x} y1={bottom + 3} x2={x} y2={bottom + 15} />
                <path d={`M${x - 3} ${bottom + 12} L${x} ${bottom + 18} L${x + 3} ${bottom + 12}Z`} stroke="none" />
              </g>
            ))}
          </g>
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-muted">
        <span>Click a layer to edit it</span>
        {drain && <span>{drainOn ? 'Underdrain on' : 'No underdrain flow'}</span>}
      </figcaption>
    </figure>
  )
}

/* -------------------------------------------------------------- layer form */

function LayerForm({
  design,
  us,
  active,
  onPick,
  onChange,
}: {
  design: LidDesign
  us: boolean
  active: LidLayer | null
  onPick: (l: LidLayer) => void
  onChange: (fn: (d: LidDesign) => LidDesign) => void
}) {
  const layers = presentLayers(design)
  const t = LID_TYPES[design.type]
  const optional = (t.optional ?? []).filter((l) => !design.layers[l])
  if (!active || !design.layers[active] || active === 'REMOVALS') return null
  const defs = LAYER_PARAMS[active]
  const vals = design.layers[active] ?? []
  const set = (i: number, v: string) =>
    onChange((d) => {
      const cur = [...(d.layers[active] ?? [])]
      while (cur.length <= i) cur.push('')
      cur[i] = v
      return { ...d, layers: { ...d.layers, [active]: cur } }
    })

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        {layers.map((l) => (
          <button
            key={l}
            role="tab"
            type="button"
            aria-selected={l === active}
            onClick={() => onPick(l)}
            className={cn('rounded-md px-2.5 py-1 text-[12px]', l === active ? 'bg-accent/15 font-medium text-fg' : 'text-muted hover:bg-fg/[0.05] hover:text-fg')}
          >
            {LAYER_LABEL[l]}
          </button>
        ))}
        {!READ_ONLY &&
          optional.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                onChange((d) => ({ ...d, layers: { ...d.layers, [l]: LAYER_PARAMS[l as Exclude<LidLayer, 'REMOVALS'>].map((p) => p.def) } }))
                onPick(l)
              }}
              className="rounded-md border border-dashed border-border px-2.5 py-1 text-[12px] text-muted hover:text-fg"
            >
              + {LAYER_LABEL[l]}
            </button>
          ))}
      </div>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {defs.map((p, i) => {
          if (p.label === 'Swale side slope' && design.type !== 'VS') return null
          if ((p.label === 'Covered' || p.label === 'Drain delay') && design.type !== 'RB') return null
          const u = unitLabel(p.unit, us)
          const label = design.type === 'RB' && active === 'STORAGE' && p.label === 'Thickness' ? 'Barrel height' : p.label
          return (
            <label key={p.label} className="block">
              <span className="mb-1 flex items-baseline justify-between gap-2 text-[12px] text-fg-soft">
                {label}
                {u && <span className="text-[11px] text-muted">{u}</span>}
              </span>
              {p.unit === 'yesno' ? (
                <select className="field h-8 text-[12px]" disabled={READ_ONLY} value={(vals[i] || p.def).toUpperCase()} onChange={(e) => set(i, e.target.value)}>
                  <option value="YES">Yes</option>
                  <option value="NO">No</option>
                </select>
              ) : (
                <input
                  className="field h-8 text-[12px] tabular-nums"
                  readOnly={READ_ONLY}
                  inputMode={p.unit === 'curve' ? 'text' : 'decimal'}
                  value={vals[i] ?? ''}
                  placeholder={p.def || '—'}
                  onChange={(e) => set(i, e.target.value.trim())}
                />
              )}
              {p.help && <span className="mt-0.5 block text-[11px] text-muted">{p.help}</span>}
            </label>
          )
        })}
      </div>
      {design.layers.REMOVALS && design.layers.REMOVALS.length > 0 && (
        <p className="mt-4 text-[12px] text-muted">
          Pollutant removal:{' '}
          {pairs(design.layers.REMOVALS)
            .map(([p, r]) => `${p} ${r} %`)
            .join(', ')}
        </p>
      )}
    </div>
  )
}

const pairs = (v: string[]) => v.reduce<[string, string][]>((a, x, i) => (i % 2 ? (a[a.length - 1]![1] = x, a) : [...a, [x, '']]), [])

/* ------------------------------------------------------------------- usage */

function UsageTable({
  rows,
  subs,
  subArea,
  us,
  onChange,
  onRemove,
  onShow,
}: {
  rows: { u: LidUse; i: number }[]
  subs: { id: string }[]
  subArea: Map<string, number>
  us: boolean
  onChange: (i: number, patch: Partial<LidUse>) => void
  onRemove: (i: number) => void
  onShow: (id: string) => void
}) {
  if (!rows.length) return null
  const a = us ? 'ft²' : 'm²'
  const perSubUnit = us ? 43560 : 10000 // subcatchment area is in ac or ha
  const cell = 'field h-7 w-full min-w-0 px-1.5 text-right text-[12px] tabular-nums'
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-border bg-fg/[0.02] text-left text-[11px] text-muted">
            <th className="px-3 py-2 font-medium">Subcatchment</th>
            <th className="px-2 py-2 text-right font-medium">Units</th>
            <th className="px-2 py-2 text-right font-medium">Area each ({a})</th>
            <th className="px-2 py-2 text-right font-medium" title="Share of the subcatchment covered">Covers</th>
            <th className="px-2 py-2 text-right font-medium" title="% of the impervious area whose runoff goes to the LID">Impervious treated %</th>
            <th className="px-2 py-2 text-right font-medium" title="% of the pervious area whose runoff goes to the LID">Pervious treated %</th>
            <th className="px-2 py-2 text-right font-medium" title="Initial saturation">Initially full %</th>
            <th className="px-2 py-2 font-medium" title="Underdrain flow goes to this node or subcatchment (blank = its own outlet)">Drain to</th>
            <th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ u, i }) => {
            const total = Number(u.number) * Number(u.area)
            const sa = subArea.get(u.subcatchment)
            const pct = sa && sa > 0 ? (total / (sa * perSubUnit)) * 100 : null
            return (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">
                  {READ_ONLY ? (
                    <span className="font-mono text-fg">{u.subcatchment}</span>
                  ) : (
                    <select className="field h-7 font-mono text-[12px]" value={u.subcatchment} onChange={(e) => onChange(i, { subcatchment: e.target.value })}>
                      {!subs.some((s) => s.id === u.subcatchment) && <option value={u.subcatchment}>{u.subcatchment}</option>}
                      {subs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.id}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-2 py-1.5"><input className={cn(cell, 'w-14')} readOnly={READ_ONLY} value={u.number} onChange={(e) => onChange(i, { number: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input className={cn(cell, 'w-20')} readOnly={READ_ONLY} value={u.area} onChange={(e) => onChange(i, { area: e.target.value })} /></td>
                <td className={cn('px-2 py-1.5 text-right tabular-nums', pct != null && pct > 100 ? 'text-danger' : 'text-fg-soft')}>
                  {pct == null ? '—' : `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)} %`}
                </td>
                <td className="px-2 py-1.5"><input className={cn(cell, 'w-16')} readOnly={READ_ONLY} value={u.fromImp} onChange={(e) => onChange(i, { fromImp: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input className={cn(cell, 'w-16')} readOnly={READ_ONLY} value={u.fromPerv} placeholder="0" onChange={(e) => onChange(i, { fromPerv: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input className={cn(cell, 'w-16')} readOnly={READ_ONLY} value={u.initSat} onChange={(e) => onChange(i, { initSat: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input className={cn(cell, 'w-24 text-left font-mono')} readOnly={READ_ONLY} value={u.drainTo === '*' ? '' : u.drainTo} placeholder="outlet" onChange={(e) => onChange(i, { drainTo: e.target.value.trim() })} /></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  <button type="button" onClick={() => onShow(u.subcatchment)} className="rounded p-1 text-muted hover:bg-fg/[0.06] hover:text-fg" title="Show on map" aria-label={`Show ${u.subcatchment} on map`}>
                    <MapPin className="h-3.5 w-3.5" />
                  </button>
                  {!READ_ONLY && (
                    <button type="button" onClick={() => onRemove(i)} className="rounded p-1 text-muted hover:bg-fg/[0.06] hover:text-danger" title="Remove from this subcatchment" aria-label={`Remove from ${u.subcatchment}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AddUse({ subs, onAdd }: { subs: { id: string }[]; onAdd: (sub: string) => void }) {
  const [v, setV] = useState('')
  if (!subs.length) return null
  return (
    <div className="mt-2 flex items-center gap-2">
      <select className="field h-8 w-56 font-mono text-[12px]" value={v} onChange={(e) => setV(e.target.value)} aria-label="Subcatchment to add">
        <option value="">Choose a subcatchment…</option>
        {subs.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={!v}
        onClick={() => {
          onAdd(v)
          setV('')
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Place here
      </Button>
    </div>
  )
}
