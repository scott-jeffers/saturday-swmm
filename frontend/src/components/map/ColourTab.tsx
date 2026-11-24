/**
 * Review → Color: colour the map by any property or result. Starts from
 * engineering classes where there are well-known limits (capacity, velocity,
 * flooding, slope, cover), otherwise natural breaks; every class's limits and
 * colour can be changed, and the choices are remembered for each property.
 */
import * as DM from '@radix-ui/react-dropdown-menu'
import { ArrowUpDown, Check, ChevronDown, Info, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Attribute } from '../../lib/elementAttributes'
import { getPref, setPref } from '../../lib/prefs'
import { cn } from '../../lib/cn'
import { METHOD_LABEL, PALETTES, breaksFor, classOf, defaultPalette, fmtNum, recommendedFor, samplePalette, type Method } from '../../lib/symbology'
import { Button } from '../ui'
import type { ThematicStyle } from './NetworkMap'

type Legend = { label: string; color: string }[]
type Thematic = ThematicStyle & { legend: Legend; title: string }

type Scheme = {
  method: Method
  classes: number
  palette: string
  reverse: boolean
  /** Full edges, when manual. */
  edges?: number[]
  /** Per-class colour changes (index → colour). */
  colors: Record<number, string>
  noValue: string
  widths: boolean
}

const NO_VALUE = '#9ca3af'
const load = (key: string): Partial<Scheme> => {
  try {
    return JSON.parse(getPref(`colour:${key}`, '{}')) as Partial<Scheme>
  } catch {
    return {}
  }
}

function initial(attr: Attribute, us: boolean, saved = true): Scheme {
  const rec = recommendedFor(attr.key, us)
  return {
    method: rec ? 'recommended' : 'jenks',
    classes: rec ? rec.inner.length + 1 : 5,
    palette: rec ? 'Traffic' : defaultPalette(attr.key),
    reverse: false,
    colors: {},
    noValue: rec?.noValue?.color ?? NO_VALUE,
    widths: attr.target === 'link',
    ...(saved ? load(attr.key) : {}),
  }
}

const rangeLabel = (lo: number, hi: number, unit?: string) => {
  const u = unit ? ` ${unit}` : ''
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return 'All'
  if (!Number.isFinite(lo)) return `Up to ${fmtNum(hi)}${u}`
  if (!Number.isFinite(hi)) return `Over ${fmtNum(lo)}${u}`
  return `${fmtNum(lo)} – ${fmtNum(hi)}${u}`
}

export function ColourTab({ attrs, us, onThematic, AttrSelect }: { attrs: Attribute[]; us: boolean; onThematic: (t: Thematic | null) => void; AttrSelect: (p: { attrs: Attribute[]; value: string; onChange: (v: string) => void }) => React.ReactElement }) {
  const [key, setKey] = useState(() => getPref('colour:last', '') && attrs.some((a) => a.key === getPref('colour:last', '')) ? getPref('colour:last', '') : attrs.find((a) => a.key === 'r:Link Flow Summary:Max/Full Flow')?.key ?? attrs.find((a) => a.target === 'link')?.key ?? '')
  const attr = attrs.find((a) => a.key === key)
  const [s, setS] = useState<Scheme | null>(() => (attr ? initial(attr, us) : null))
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (attr) setS(initial(attr, us))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const rec = attr ? recommendedFor(attr.key, us) : null
  const values = useMemo(() => (attr ? [...attr.values.values()] : []), [attr])

  // Classes: edges, colours, labels.
  const plan = useMemo(() => {
    if (!attr || !s) return null
    let edges: number[]
    let labels: string[] | null = null
    let base: string[]
    if (s.method === 'recommended' && rec) {
      edges = [-Infinity, ...rec.inner, Infinity]
      labels = rec.labels
      base = rec.colors
    } else {
      edges = s.method === 'manual' && s.edges?.length ? s.edges : breaksFor(values, s.classes, s.method === 'recommended' || s.method === 'manual' ? 'jenks' : s.method)
      const pal = PALETTES.find((p) => p.id === s.palette) ?? PALETTES[0]!
      base = samplePalette(pal.colors, Math.max(1, edges.length - 1), s.reverse)
    }
    const n = Math.max(1, edges.length - 1)
    const colors = Array.from({ length: n }, (_, i) => s.colors[i] ?? base[i] ?? base[base.length - 1]!)
    const counts = new Array(n).fill(0) as number[]
    for (const v of values) counts[classOf(v, edges)]!++
    return { edges, colors, counts, labels: Array.from({ length: n }, (_, i) => labels?.[i] ?? rangeLabel(edges[i]!, edges[i + 1]!, attr.unit)) }
  }, [attr, s, rec, values])

  const thematic = (): Thematic | null => {
    if (!attr || !s || !plan || plan.edges.length < 2) return null
    const colorById: Record<string, string> = {}
    const widthById: Record<string, number> = {}
    const n = plan.colors.length
    for (const [id, v] of attr.values) {
      const c = classOf(v, plan.edges)
      colorById[id] = plan.colors[c]!
      if (s.widths && attr.target === 'link') widthById[id] = 2 + (n > 1 ? (c / (n - 1)) * 4 : 0)
    }
    const legend: Legend = plan.colors.map((color, i) => ({ color, label: plan.labels[i]! }))
    if (rec?.noValue && s.method === 'recommended') legend.unshift({ color: s.noValue, label: rec.noValue.label })
    else legend.push({ color: s.noValue, label: 'No value' })
    return { target: attr.target, colorById, fallback: s.noValue, widthById: s.widths && attr.target === 'link' ? widthById : undefined, legend, title: `${attr.label}${attr.unit ? ` (${attr.unit})` : ''}` }
  }

  // Remember the choices, and keep the map up to date once applied.
  useEffect(() => {
    if (!attr || !s) return
    setPref(`colour:${attr.key}`, JSON.stringify(s))
    setPref('colour:last', attr.key)
    if (live) onThematic(thematic())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, live])

  if (!attr || !s || !plan) return <p className="text-muted">Nothing to colour by yet.</p>
  const set = (p: Partial<Scheme>) => setS({ ...s, ...p })
  const toManual = (edges: number[]) => set({ method: 'manual', edges, classes: edges.length - 1 })
  const finiteEdges = () => {
    const v = [...values].sort((a, b) => a - b)
    return plan.edges.map((e, i) => (Number.isFinite(e) ? e : i === 0 ? Math.min(v[0] ?? 0, plan.edges[1] ?? 0) : Math.max(v[v.length - 1] ?? 0, plan.edges[plan.edges.length - 2] ?? 0)))
  }
  const methods: Method[] = [...(rec ? (['recommended'] as Method[]) : []), 'jenks', 'quantile', 'equal', 'pretty', 'stddev', 'manual']

  return (
    <div className="space-y-2.5">
      <label className="block font-medium text-fg-soft">
        Color by
        <div className="mt-1">
          <AttrSelect attrs={attrs} value={key} onChange={setKey} />
        </div>
      </label>
      {rec && s.method === 'recommended' && (
        <p className="m-0 flex gap-1.5 rounded-md bg-fg/[0.04] px-2 py-1.5 text-[11.5px] leading-snug text-fg-soft">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-muted" />
          {rec.note}
        </p>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <label className="block text-muted">
          Classes from
          <select
            className="field mt-1 h-7 text-[12px]"
            value={s.method}
            onChange={(e) => {
              const m = e.target.value as Method
              if (m === 'manual') toManual(finiteEdges())
              else set({ method: m, edges: undefined, colors: {}, classes: m === 'recommended' && rec ? rec.inner.length + 1 : s.method === 'recommended' ? 5 : s.classes })
            }}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <div className="text-muted">
          Classes
          <div className="mt-1 flex h-7 items-center rounded-md border border-border-strong">
            <button
              type="button"
              aria-label="Fewer classes"
              disabled={plan.colors.length <= 2}
              className="flex h-full w-6 items-center justify-center text-fg-soft hover:bg-fg/[0.06] disabled:opacity-40"
              onClick={() => (s.method === 'manual' ? toManual(plan.edges.slice(0, -2).concat(plan.edges[plan.edges.length - 1]!)) : set({ method: s.method === 'recommended' ? 'jenks' : s.method, classes: Math.max(2, plan.colors.length - 1), colors: {} }))}
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-5 text-center text-[12px] tabular-nums text-fg">{plan.colors.length}</span>
            <button
              type="button"
              aria-label="More classes"
              disabled={plan.colors.length >= 9}
              className="flex h-full w-6 items-center justify-center text-fg-soft hover:bg-fg/[0.06] disabled:opacity-40"
              onClick={() => {
                if (s.method === 'manual') {
                  const e = finiteEdges()
                  const last = e[e.length - 1]!
                  const prev = e[e.length - 2]!
                  toManual([...e.slice(0, -1), +(prev + (last - prev) / 2).toPrecision(4), last])
                } else set({ method: s.method === 'recommended' ? 'jenks' : s.method, classes: Math.min(9, plan.colors.length + 1), colors: {} })
              }}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
      {s.method !== 'recommended' && (
        <div className="flex items-end gap-1.5">
          <div className="min-w-0 flex-1 text-muted">
            Colors
            <PalettePicker value={s.palette} onChange={(id) => set({ palette: id, colors: {} })} reverse={s.reverse} />
          </div>
          <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Reverse colors" title="Reverse colors" onClick={() => set({ reverse: !s.reverse, colors: {} })}>
            <ArrowUpDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <ul className="m-0 list-none space-y-1 p-0">
        {plan.colors.map((c, i) => {
          const lo = plan.edges[i]!
          const hi = plan.edges[i + 1]!
          return (
            <li key={i} className="flex items-center gap-2 text-fg-soft">
              <label className="relative h-4 w-6 shrink-0 cursor-pointer overflow-hidden rounded-sm ring-1 ring-black/10" style={{ background: c }} title="Change this color">
                <input type="color" value={c} onChange={(e) => set({ colors: { ...s.colors, [i]: e.target.value } })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Color for ${plan.labels[i]}`} />
              </label>
              {s.method === 'manual' ? (
                <span className="flex min-w-0 flex-1 items-center gap-1 tabular-nums">
                  <span className="w-12 truncate text-right">{fmtNum(lo)}</span>
                  <span className="text-muted">–</span>
                  {i < plan.colors.length - 1 ? (
                    <input
                      defaultValue={fmtNum(hi)}
                      key={`${i}-${hi}`}
                      onBlur={(e) => {
                        const v = Number(e.target.value)
                        if (!Number.isFinite(v)) return
                        const edges = [...plan.edges]
                        edges[i + 1] = v
                        toManual(edges.map((x, k) => (k > 0 && x < edges[k - 1]! ? edges[k - 1]! : x)))
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      aria-label={`Upper limit of class ${i + 1}`}
                      className="field h-6 w-16 px-1.5 text-[12px] tabular-nums"
                    />
                  ) : (
                    <span>{fmtNum(hi)}</span>
                  )}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate tabular-nums" title={plan.labels[i]}>
                  {plan.labels[i]}
                </span>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-muted" title="Elements in this class">
                {plan.counts[i]}
              </span>
            </li>
          )
        })}
        <li className="flex items-center gap-2 text-fg-soft">
          <label className="relative h-4 w-6 shrink-0 cursor-pointer overflow-hidden rounded-sm ring-1 ring-black/10" style={{ background: s.noValue }}>
            <input type="color" value={s.noValue} onChange={(e) => set({ noValue: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Color for elements with no value" />
          </label>
          <span className="flex-1 text-muted">{rec?.noValue && s.method === 'recommended' ? rec.noValue.label : 'No value'}</span>
        </li>
      </ul>
      {attr.target === 'link' && (
        <label className="flex items-center gap-2 text-fg-soft">
          <input type="checkbox" checked={s.widths} onChange={(e) => set({ widths: e.target.checked })} /> Thicker lines for higher classes
        </label>
      )}
      <div className="flex items-center justify-end gap-1.5 border-t border-border pt-2.5">
        <button type="button" className="mr-auto text-[11.5px] text-muted hover:text-fg" onClick={() => setS(initial(attr, us, false))}>
          Start over
        </button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setLive(false)
            onThematic(null)
          }}
        >
          Reset colors
        </Button>
        <Button
          size="sm"
          variant={live ? 'outline' : 'primary'}
          disabled={plan.edges.length < 2}
          onClick={() => {
            setLive(true)
            onThematic(thematic())
          }}
        >
          {live ? (
            <>
              <Check className="h-3.5 w-3.5" /> On the map
            </>
          ) : (
            'Apply to map'
          )}
        </Button>
      </div>
      {live && <p className="m-0 text-right text-[11px] text-muted">Changes show on the map as you make them.</p>}
    </div>
  )
}

function Strip({ colors, className }: { colors: string[]; className?: string }) {
  return (
    <span className={cn('flex h-3 overflow-hidden rounded-sm', className)}>
      {colors.map((c, i) => (
        <span key={i} className="flex-1" style={{ background: c }} />
      ))}
    </span>
  )
}

function PalettePicker({ value, onChange, reverse }: { value: string; onChange: (id: string) => void; reverse: boolean }) {
  const cur = PALETTES.find((p) => p.id === value) ?? PALETTES[0]!
  const groups: [string, string][] = [
    ['sequential', 'Low to high'],
    ['traffic', 'Good to bad'],
    ['diverging', 'Two-sided'],
  ]
  return (
    <DM.Root>
      <DM.Trigger className="field mt-1 flex h-7 items-center gap-2 text-left text-[12px]">
        <Strip colors={samplePalette(cur.colors, 7, reverse)} className="w-16 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-fg">{cur.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={4} className="z-[80] max-h-[min(420px,calc(100vh-6rem))] w-64 overflow-y-auto rounded-lg border border-border bg-elevated p-1 text-[12px] shadow-[var(--shadow-panel)]">
          {groups.map(([kind, label]) => (
            <div key={kind}>
              <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-muted">{label}</div>
              {PALETTES.filter((p) => p.kind === kind).map((p) => (
                <DM.Item key={p.id} onSelect={() => onChange(p.id)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-fg/[0.06]">
                  <Strip colors={samplePalette(p.colors, 7)} className="w-20 shrink-0" />
                  <span className={cn('min-w-0 flex-1 truncate', p.id === value ? 'font-medium text-fg' : 'text-fg-soft')}>{p.label}</span>
                  {p.safe && (
                    <span className="text-[10px] text-muted" title="Readable with common kinds of colour blindness">
                      CB-safe
                    </span>
                  )}
                </DM.Item>
              ))}
            </div>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}
