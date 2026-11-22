/**
 * Review mode: find elements by attribute, colour the map by any property or
 * result, and run design checks. Results always select on the map.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Plus, Trash2, X } from 'lucide-react'
import type { Feature } from 'geojson'
import { api, type ModelNetwork } from '../../api/client'
import {
  buildAttributes,
  classBreaks,
  classify,
  defaultRules,
  RAMPS,
  runChecks,
  runQuery,
  type Attribute,
  type Condition,
  type Op,
  type Rule,
  type Target,
} from '../../lib/elementAttributes'
import { getPref, setPref } from '../../lib/prefs'
import { cn } from '../../lib/cn'
import { Button } from '../ui'
import type { Selection, ThematicStyle } from './NetworkMap'

const TARGETS: [Target, string][] = [
  ['link', 'Links'],
  ['node', 'Nodes'],
  ['subcatchment', 'Subcatchments'],
]
const OPS: Op[] = ['>', '>=', '<', '<=', '=', '!=']
const OP_LABEL: Record<Op, string> = {
  '>': 'more than',
  '>=': 'at least',
  '<': 'less than',
  '<=': 'at most',
  '=': 'equal to',
  '!=': 'not equal to',
}
const TARGET_NOUN: Record<Target, string> = { link: 'links', node: 'nodes', subcatchment: 'subcatchments' }
const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3).replace(/\.?0+$/, '') || '0')

function AttrSelect({ attrs, value, onChange }: { attrs: Attribute[]; value: string; onChange: (v: string) => void }) {
  const groups = ['Model', 'Derived', 'Results'] as const
  return (
    <select className="field h-7 text-[12px]" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Property">
      {groups.map((g) => {
        const list = attrs.filter((a) => a.group === g)
        return list.length ? (
          <optgroup key={g} label={g === 'Results' ? 'Results (last run)' : g}>
            {list.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
                {a.unit ? ` (${a.unit})` : ''}
              </option>
            ))}
          </optgroup>
        ) : null
      })}
    </select>
  )
}

export function ReviewPanel({
  network,
  onSelectMany,
  onThematic,
  onClose,
}: {
  network: ModelNetwork
  onSelectMany: (items: NonNullable<Selection>[]) => void
  onThematic: (t: (ThematicStyle & { legend: { label: string; color: string }[]; title: string }) | null) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'find' | 'colour' | 'checks' | 'cost'>(() => (getPref('review-tab') as 'find') || 'checks')
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const rpt = useQuery({ queryKey: ['rpt-summary', 'review', project.data?.has_out], queryFn: api.getRptSummary, retry: false })
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const features = network.geojson.features as Feature[]
  const attrs = useMemo(() => buildAttributes(features, rpt.data?.available ? rpt.data.tables : undefined, us), [features, rpt.data, us])
  const idsBy = useMemo(() => {
    const m: Record<Target, string[]> = { node: [], link: [], subcatchment: [] }
    for (const f of features) {
      const t = f.properties?.object_type as Target
      if (m[t]) m[t].push(String(f.properties?.id))
    }
    return m
  }, [features])

  const setTabP = (t: typeof tab) => {
    setTab(t)
    setPref('review-tab', t)
  }

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-r border-border bg-elevated text-[12px]" aria-label="Review">
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">Review</h2>
        <button type="button" aria-label="Close review" title="Close review" onClick={onClose} className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div role="tablist" aria-label="Review tools" className="mx-3 mb-1 grid grid-cols-4 gap-0.5 rounded-md bg-fg/5 p-0.5">
        {(
          [
            ['checks', 'Checks', 'Design checks against your rules'],
            ['find', 'Find', 'Find elements by their properties or results'],
            ['colour', 'Color', 'Color the map by any property or result'],
            ['cost', 'Cost', 'Construction cost estimate'],
          ] as const
        ).map(([k, l, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            title={t}
            onClick={() => setTabP(k)}
            className={cn('h-7 rounded text-[12px] transition-colors', tab === k ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg')}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'find' && <FindTab attrs={attrs} idsBy={idsBy} onSelectMany={onSelectMany} />}
        {tab === 'colour' && <ColourTab attrs={attrs} onThematic={onThematic} />}
        {tab === 'cost' && <CostTab features={features} us={us} onThematic={onThematic} />}
        {tab === 'checks' && <ChecksTab attrs={attrs} us={us} hasResults={Boolean(rpt.data?.available)} onSelectMany={onSelectMany} onThematic={onThematic} />}
      </div>
    </aside>
  )
}

/** Find by property or result, on its own: the map's "Select by…" tool in any mode. */
export function SelectByAttribute({
  network,
  onSelectMany,
  onClose,
}: {
  network: ModelNetwork
  onSelectMany: (items: NonNullable<Selection>[]) => void
  onClose: () => void
}) {
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const rpt = useQuery({ queryKey: ['rpt-summary', 'review', project.data?.has_out], queryFn: api.getRptSummary, retry: false })
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const features = network.geojson.features as Feature[]
  const attrs = useMemo(() => buildAttributes(features, rpt.data?.available ? rpt.data.tables : undefined, us), [features, rpt.data, us])
  const idsBy = useMemo(() => {
    const m: Record<Target, string[]> = { node: [], link: [], subcatchment: [] }
    for (const f of features) {
      const t = f.properties?.object_type as Target
      if (m[t]) m[t].push(String(f.properties?.id))
    }
    return m
  }, [features])
  return (
    <section
      aria-label="Select by property"
      className="absolute left-3 top-14 z-30 w-[320px] rounded-xl border border-border bg-elevated p-3 text-[12px] shadow-[var(--shadow-panel)]"
    >
      <header className="mb-2 flex items-center gap-2">
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">Select by property</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <p className="mb-2.5 mt-0 text-muted">Then edit them all at once in the inspector, or open them in the table.</p>
      <FindTab attrs={attrs} idsBy={idsBy} onSelectMany={onSelectMany} />
    </section>
  )
}

function FindTab({ attrs, idsBy, onSelectMany }: { attrs: Attribute[]; idsBy: Record<Target, string[]>; onSelectMany: (i: NonNullable<Selection>[]) => void }) {
  const [target, setTarget] = useState<Target>('link')
  const tAttrs = attrs.filter((a) => a.target === target)
  const [conds, setConds] = useState<Condition[]>([])
  const conditions = conds.length ? conds : tAttrs[0] ? [{ attr: tAttrs[0].key, op: '>' as Op, value: 0 }] : []
  const valid = conditions.filter((c) => tAttrs.some((a) => a.key === c.attr))
  const hits = useMemo(() => runQuery(attrs, valid, idsBy[target]), [attrs, valid, idsBy, target])
  const set = (i: number, patch: Partial<Condition>) => setConds(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <div className="space-y-2.5">
      <div className="flex gap-1">
        {TARGETS.map(([t, l]) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTarget(t)
              setConds([])
            }}
            className={cn('h-7 flex-1 rounded-md text-[12px]', t === target ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:bg-fg/5')}
          >
            {l}
          </button>
        ))}
      </div>
      {conditions.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2.5">
          <div className="text-[11px] font-medium text-muted">{i === 0 ? 'Where' : 'And'}</div>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <AttrSelect attrs={tAttrs} value={c.attr} onChange={(v) => set(i, { attr: v })} />
            </div>
            {conditions.length > 1 && (
              <button type="button" aria-label="Remove condition" onClick={() => setConds(conditions.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <select className="field h-7 w-[7.5rem] shrink-0 text-[12px]" value={c.op} onChange={(e) => set(i, { op: e.target.value as Op })} aria-label="Comparison">
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {OP_LABEL[o]}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              className="field h-7 flex-1 text-[12px]"
              value={Number.isFinite(c.value) ? c.value : ''}
              onChange={(e) => set(i, { value: Number(e.target.value) })}
              aria-label="Value"
            />
          </div>
        </div>
      ))}
      {tAttrs.length > 0 && (
        <button type="button" onClick={() => setConds([...conditions, { attr: tAttrs[0].key, op: '>', value: 0 }])} className="inline-flex items-center gap-1 text-accent-soft hover:underline">
          <Plus className="h-3 w-3" /> Add condition
        </button>
      )}
      <div className="flex items-center justify-between border-t border-border pt-2.5">
        <span className="text-fg-soft">
          <strong className="font-semibold text-fg">{hits.length.toLocaleString('en-US')}</strong> of{' '}
          {idsBy[target].length.toLocaleString('en-US')} {TARGET_NOUN[target]} match
        </span>
        <Button size="sm" variant="primary" disabled={!hits.length} onClick={() => onSelectMany(hits.map((id) => ({ object_type: target, id })))}>
          Select on map
        </Button>
      </div>
      {hits.length > 0 && hits.length <= 40 && <p className="m-0 text-muted">{hits.join(', ')}</p>}
    </div>
  )
}

function ColourTab({ attrs, onThematic }: { attrs: Attribute[]; onThematic: Parameters<typeof ReviewPanel>[0]['onThematic'] }) {
  const [key, setKey] = useState(() => attrs.find((a) => a.key === 'r:Link Flow Summary:Max/Full Flow')?.key ?? attrs.find((a) => a.target === 'link')?.key ?? '')
  const [classes, setClasses] = useState(5)
  const [method, setMethod] = useState<'quantile' | 'equal'>('quantile')
  const [ramp, setRamp] = useState('Heat')
  const attr = attrs.find((a) => a.key === key)
  const breaks = attr ? classBreaks([...attr.values.values()], classes, method) : []
  const colors = (() => {
    const base = RAMPS[ramp]
    return Array.from({ length: classes }, (_, i) => base[Math.round((i * (base.length - 1)) / Math.max(1, classes - 1))])
  })()
  const legend = breaks.length > 1 ? colors.map((c, i) => ({ color: c, label: `${fmt(breaks[i])} – ${fmt(breaks[i + 1])}` })) : []
  const apply = () => {
    if (!attr || breaks.length < 2) return
    const colorById: Record<string, string> = {}
    for (const [id, v] of attr.values) colorById[id] = colors[classify(v, breaks)]
    onThematic({ target: attr.target, colorById, fallback: '#9ca3af', legend, title: `${attr.label}${attr.unit ? ` (${attr.unit})` : ''}` })
  }
  return (
    <div className="space-y-2.5">
      <label className="block font-medium text-fg-soft">
        Color by
        <div className="mt-1">
          <AttrSelect attrs={attrs} value={key} onChange={setKey} />
        </div>
      </label>
      <div className="grid grid-cols-[4.75rem_1fr_1fr] gap-1.5">
        <label className="block text-muted">
          Classes
          <select className="field mt-1 h-7 text-[12px]" value={classes} onChange={(e) => setClasses(Number(e.target.value))}>
            {[3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="block text-muted">
          Breaks
          <select className="field mt-1 h-7 text-[12px]" value={method} onChange={(e) => setMethod(e.target.value as 'quantile')}>
            <option value="quantile">Quantile</option>
            <option value="equal">Equal</option>
          </select>
        </label>
        <label className="block text-muted">
          Colors
          <select className="field mt-1 h-7 text-[12px]" value={ramp} onChange={(e) => setRamp(e.target.value)}>
            {Object.keys(RAMPS).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <ul className="m-0 list-none space-y-1 p-0">
        {legend.map((l) => (
          <li key={l.label} className="flex items-center gap-2 tabular-nums text-fg-soft">
            <span className="h-3 w-5 rounded-sm" style={{ background: l.color }} />
            {l.label}
          </li>
        ))}
        {attr && !legend.length && <li className="text-muted">No values to classify.</li>}
      </ul>
      <div className="flex justify-end gap-1.5 border-t border-border pt-2.5">
        <Button size="sm" variant="ghost" onClick={() => onThematic(null)}>
          Reset colors
        </Button>
        <Button size="sm" variant="primary" disabled={!legend.length} onClick={apply}>
          Apply to map
        </Button>
      </div>
    </div>
  )
}

export function loadRules(us: boolean): Rule[] {
  const base = defaultRules(us)
  try {
    const saved = JSON.parse(getPref(`design-rules-${us ? 'us' : 'si'}`) || '[]') as Partial<Rule>[]
    return base.map((r) => ({ ...r, ...(saved.find((s) => s.id === r.id) ?? {}) }))
  } catch {
    return base
  }
}

function ChecksTab({
  attrs,
  us,
  hasResults,
  onSelectMany,
  onThematic,
}: {
  attrs: Attribute[]
  us: boolean
  hasResults: boolean
  onSelectMany: (i: NonNullable<Selection>[]) => void
  onThematic: Parameters<typeof ReviewPanel>[0]['onThematic']
}) {
  const [rules, setRules] = useState<Rule[]>(() => loadRules(us))
  const [editing, setEditing] = useState(false)
  const { failures, missing } = useMemo(() => runChecks(attrs, rules), [attrs, rules])
  const byRule = new Map<string, typeof failures>()
  for (const f of failures) byRule.set(f.rule.id, [...(byRule.get(f.rule.id) ?? []), f])
  const save = (next: Rule[]) => {
    setRules(next)
    setPref(`design-rules-${us ? 'us' : 'si'}`, JSON.stringify(next.map(({ id, limit, enabled }) => ({ id, limit, enabled }))))
  }
  const showOnMap = (list: typeof failures) => {
    if (!list.length) return
    onSelectMany(list.map((f) => ({ object_type: f.target, id: f.id })))
    const target = list[0].target
    const colorById: Record<string, string> = {}
    for (const f of failures) if (f.target === target) colorById[f.id] = '#ef4444'
    onThematic({ target, colorById, fallback: '#22c55e', legend: [{ color: '#ef4444', label: 'Fails a check' }, { color: '#22c55e', label: 'Passes' }], title: 'Design checks' })
  }
  return (
    <div className="space-y-2">
      {!hasResults && <p className="m-0 rounded-md bg-warning/10 px-2 py-1.5 text-warning">Run the model to check velocities, capacity and flooding. Slope and cover are checked from the inputs.</p>}
      <ul className="m-0 list-none space-y-1 p-0">
        {rules
          .filter((r) => editing || r.enabled)
          .map((r) => {
            const list = byRule.get(r.id) ?? []
            const unavailable = missing.some((m) => m.id === r.id)
            return (
              <li key={r.id} className="rounded-md border border-border px-2 py-1.5">
                <div className="flex items-center gap-2">
                  {editing ? (
                    <input type="checkbox" checked={r.enabled} onChange={(e) => save(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} aria-label={`Use ${r.label}`} />
                  ) : list.length ? (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger/20 px-1 text-[10px] font-semibold text-danger">{list.length}</span>
                  ) : (
                    <CheckCircle2 className={cn('h-4 w-4', unavailable ? 'text-muted' : 'text-success')} />
                  )}
                  <span className="min-w-0 flex-1 text-fg">{r.label}</span>
                  {editing ? (
                    <span className="inline-flex items-center gap-1 text-muted">
                      {r.op}
                      <input
                        type="number"
                        step="any"
                        className="field h-6 w-16 text-[12px]"
                        value={r.limit}
                        onChange={(e) => save(rules.map((x) => (x.id === r.id ? { ...x, limit: Number(e.target.value) } : x)))}
                        aria-label={`${r.label} limit`}
                      />
                      {r.unit}
                    </span>
                  ) : (
                    <span className="text-muted tabular-nums">
                      {r.op} {r.limit} {r.unit}
                    </span>
                  )}
                </div>
                {!editing && list.length > 0 && (
                  <div className="mt-1 flex items-center gap-2 pl-6">
                    <span className="min-w-0 flex-1 truncate text-muted" title={list.map((f) => f.id).join(', ')}>
                      {list
                        .slice(0, 6)
                        .map((f) => `${f.id} (${fmt(f.value)})`)
                        .join(', ')}
                      {list.length > 6 ? ` +${list.length - 6}` : ''}
                    </span>
                    <button type="button" className="shrink-0 text-accent-soft hover:underline" onClick={() => showOnMap(list)}>
                      Show
                    </button>
                  </div>
                )}
                {!editing && unavailable && <div className="mt-0.5 pl-6 text-muted">Needs results</div>}
              </li>
            )
          })}
      </ul>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <button type="button" className="text-accent-soft hover:underline" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit rules'}
        </button>
        {editing ? (
          <button type="button" className="text-muted hover:text-fg" onClick={() => save(defaultRules(us))}>
            Reset to defaults
          </button>
        ) : (
          <Button size="sm" variant="primary" disabled={!failures.length} onClick={() => showOnMap(failures)}>
            Show all {failures.length}
          </Button>
        )}
      </div>
    </div>
  )
}

type Band = { upTo: number; rate: number }
function defaultBands(us: boolean): { bands: Band[]; manhole: number } {
  // Rough installed-cost planning rates; edit them to local prices.
  return us
    ? { bands: [{ upTo: 1, rate: 180 }, { upTo: 2, rate: 300 }, { upTo: 3, rate: 450 }, { upTo: 4, rate: 650 }, { upTo: 99, rate: 950 }], manhole: 6000 }
    : { bands: [{ upTo: 0.3, rate: 600 }, { upTo: 0.6, rate: 1000 }, { upTo: 0.9, rate: 1500 }, { upTo: 1.2, rate: 2100 }, { upTo: 99, rate: 3100 }], manhole: 6000 }
}

function CostTab({ features, us, onThematic }: { features: Feature[]; us: boolean; onThematic: Parameters<typeof ReviewPanel>[0]['onThematic'] }) {
  const key = `cost-rates-${us ? 'us' : 'si'}`
  const [cfg, setCfg] = useState<{ bands: Band[]; manhole: number }>(() => {
    try {
      return { ...defaultBands(us), ...(JSON.parse(getPref(key) || '{}') as object) }
    } catch {
      return defaultBands(us)
    }
  })
  const save = (c: typeof cfg) => {
    setCfg(c)
    setPref(key, JSON.stringify(c))
  }
  const L = us ? 'ft' : 'm'
  const est = useMemo(() => {
    const perLink: Record<string, number> = {}
    let pipes = 0
    let length = 0
    for (const f of features) {
      const p = f.properties ?? {}
      if (p.object_type !== 'link' || (p.link_kind && p.link_kind !== 'conduit')) continue
      const len = Number(p.length) || 0
      const dia = Number(p.diameter) || 0
      const rate = (cfg.bands.find((b) => dia <= b.upTo) ?? cfg.bands[cfg.bands.length - 1]).rate
      perLink[String(p.id)] = len * rate
      pipes += len * rate
      length += len
    }
    const mh = features.filter((f) => f.properties?.object_type === 'node' && f.properties?.node_kind === 'junction').length
    return { perLink, pipes, length, mh, total: pipes + mh * cfg.manhole }
  }, [features, cfg])
  const money = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  const show = () => {
    const vals = Object.values(est.perLink)
    const breaks = classBreaks(vals, 5, 'quantile')
    const colors = RAMPS.Heat
    const colorById: Record<string, string> = {}
    for (const [id, v] of Object.entries(est.perLink)) colorById[id] = colors[classify(v, breaks)]
    onThematic({
      target: 'link',
      colorById,
      fallback: '#9ca3af',
      legend: colors.map((c, i) => ({ color: c, label: `${money(breaks[i])} – ${money(breaks[i + 1])}` })),
      title: 'Pipe cost',
    })
  }
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="text-muted">Pipes ({Math.round(est.length).toLocaleString()} {L})</div>
        <div className="text-right tabular-nums text-fg">{money(est.pipes)}</div>
        <div className="text-muted">Manholes ({est.mh})</div>
        <div className="text-right tabular-nums text-fg">{money(est.mh * cfg.manhole)}</div>
        <div className="border-t border-border pt-1 font-medium text-fg">Total</div>
        <div className="border-t border-border pt-1 text-right font-semibold tabular-nums text-fg">{money(est.total)}</div>
      </div>
      <div className="rounded-md border border-border p-2">
        <div className="mb-1 font-medium text-fg-soft">Rates per {L} by height / diameter</div>
        {cfg.bands.map((b, i) => (
          <div key={i} className="flex items-center gap-1.5 py-0.5">
            <span className="w-24 text-muted">{i === cfg.bands.length - 1 ? `over ${cfg.bands[i - 1]?.upTo ?? 0}` : `up to ${b.upTo}`} {L}</span>
            <input
              type="number"
              className="field h-6 flex-1 text-[12px]"
              value={b.rate}
              onChange={(e) => save({ ...cfg, bands: cfg.bands.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) })}
              aria-label={`Rate for band ${i + 1}`}
            />
          </div>
        ))}
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="w-24 text-muted">Manhole, each</span>
          <input type="number" className="field h-6 flex-1 text-[12px]" value={cfg.manhole} onChange={(e) => save({ ...cfg, manhole: Number(e.target.value) })} aria-label="Manhole cost" />
        </div>
      </div>
      <p className="m-0 text-[11px] text-muted">Planning-level figures from your rates; not a quote. Rates are kept in this browser.</p>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => save(defaultBands(us))}>
          Reset rates
        </Button>
        <Button size="sm" variant="primary" onClick={show}>
          Color pipes by cost
        </Button>
      </div>
    </div>
  )
}
