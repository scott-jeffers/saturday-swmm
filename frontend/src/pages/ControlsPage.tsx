/**
 * Control rules ([CONTROLS]): every rule read as IF / THEN / ELSE with the
 * elements it watches and the ones it moves. Edit a rule's SWMM text
 * with a live check.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, Code2, LineChart, Pencil, Plus, Search, Trash2, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { Button, PageHeader, useToast } from '../components/ui'
import { ManualLink } from '../components/ManualLink'
import { cn } from '../lib/cn'
import {
  attrLabel,
  attrUnit,
  hoursLabel,
  opLabel,
  parseControls,
  parseRule,
  replaceRule,
  ruleTemplate,
  rulesByTarget,
  type Action,
  type Condition,
  type KnownIds,
  type Operand,
  type Rule,
} from '../lib/controls'
import { ELEMENT_COLOR } from '../lib/elementColors'
import { requestGraph } from '../lib/graphRequest'
import { focusOnMap } from '../lib/mapFocus'
import { MANUAL } from '../lib/manual'

type Ctx = {
  us: boolean
  flowUnits: string
  kindOf: (o: Operand) => string
  show: (o: Operand) => void
}

export function ControlsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const section = useQuery({ queryKey: ['section', 'CONTROLS'], queryFn: () => api.getSection('CONTROLS'), retry: false })
  const network = useQuery({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const gagesQ = useQuery({ queryKey: ['section', 'RAINGAGES'], queryFn: () => api.getSection('RAINGAGES'), retry: false })
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const flowUnits = String(project.data?.flow_units ?? 'CFS').toUpperCase()
  const us = ['CFS', 'GPM', 'MGD'].includes(flowUnits)
  const hasResults = Boolean(project.data?.has_out)

  const known = useMemo<KnownIds & { nodeKinds: Map<string, string> }>(() => {
    const nodes = new Set<string>()
    const links = new Set<string>()
    const subcatchments = new Set<string>()
    const linkKinds = new Map<string, string>()
    const nodeKinds = new Map<string, string>()
    for (const f of network.data?.geojson.features ?? []) {
      const p = f.properties ?? {}
      const id = String(p.id)
      if (p.object_type === 'node') {
        nodes.add(id)
        nodeKinds.set(id, String(p.node_kind ?? 'junction'))
      } else if (p.object_type === 'link') {
        links.add(id)
        linkKinds.set(id, String(p.link_kind ?? 'conduit'))
      } else if (p.object_type === 'subcatchment') subcatchments.add(id)
    }
    const gages = new Set((gagesQ.data?.rows ?? []).map((r) => r.values[0] ?? '').filter(Boolean))
    return { nodes, links, subcatchments, gages, linkKinds, nodeKinds }
  }, [network.data, gagesQ.data])

  const text = section.data?.kind === 'text' ? section.data.text ?? '' : ''
  const doc = useMemo(() => parseControls(text, known), [text, known])
  const byTarget = useMemo(() => rulesByTarget(doc.rules), [doc.rules])

  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<'rules' | 'elements'>('rules')
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null)
  const picked = params.get('rule')
  const index = Math.max(0, doc.rules.findIndex((r) => r.name === picked))
  const rule = doc.rules[index] as Rule | undefined
  const pick = (name: string) => {
    setEditing(null)
    setParams((p) => {
      p.set('rule', name)
      return p
    }, { replace: true })
  }

  const ctx: Ctx = {
    us,
    flowUnits,
    kindOf: (o) => (o.kind === 'node' ? known.nodeKinds.get(o.id ?? '') ?? 'junction' : o.kind === 'link' ? known.linkKinds?.get(o.id ?? '') ?? o.object.toLowerCase() : o.kind),
    show: (o) => {
      if (!o.id || !['node', 'link', 'subcatchment'].includes(o.kind)) return
      focusOnMap({ object_type: o.kind as 'node', id: o.id })
      navigate('/map')
    },
  }

  const save = useMutation({
    mutationFn: async (next: string) => api.putSection('CONTROLS', { text: next }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['section'] })
      void qc.invalidateQueries({ queryKey: ['inp'] })
      void qc.invalidateQueries({ queryKey: ['project'] })
    },
    onError: (e) => toast({ title: 'Couldn’t save the rules', description: (e as Error).message, tone: 'danger' }),
  })

  const q = query.trim().toLowerCase()
  const matches = (r: Rule) =>
    !q ||
    r.name.toLowerCase().includes(q) ||
    r.conditions.some((c) => c.left.id?.toLowerCase().includes(q) || (typeof c.right !== 'string' && c.right.id?.toLowerCase().includes(q))) ||
    r.actions.some((a) => a.target.id?.toLowerCase().includes(q))
  const shown = doc.rules.filter(matches)
  const withErrors = doc.rules.filter((r) => r.errors.length).length

  const startNew = () => {
    const firstLink = [...(known.linkKinds ?? [])].find(([, k]) => k !== 'conduit') ?? [...(known.linkKinds ?? [])][0]
    let n = doc.rules.length + 1
    while (doc.rules.some((r) => r.name.toUpperCase() === `RULE_${n}`)) n++
    setEditing({ index: -1, text: ruleTemplate(`RULE_${n}`, firstLink ? { id: firstLink[0], kind: firstLink[1] } : undefined, [...(known.nodes ?? [])][0]) })
  }

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Control rules"
          description="Rules that switch pumps and move gates and weirs while the model runs. SWMM checks them at every routing step."
          actions={
            <>
              {(
                <Button size="sm" variant="outline" onClick={startNew} disabled={Boolean(editing)}>
                  <Plus className="h-3.5 w-3.5" /> New rule
                </Button>
              )}
              <ManualLink href={MANUAL.controls}>Control rules in the manual</ManualLink>
            </>
          }
        />

        {section.isLoading ? (
          <p className="text-sm text-muted">Reading the model…</p>
        ) : !doc.rules.length && !editing ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <Workflow className="mx-auto mb-2 h-6 w-6 text-ic-tools" />
            <p className="m-0 text-sm text-fg">This model has no control rules.</p>
            <p className="m-0 mt-1 text-[13px] text-muted">
              Pumps run on their own curves and start-up depths; orifices and weirs stay at their set openings.
            </p>
            {(
              <Button size="sm" variant="outline" className="mt-4" onClick={startNew}>
                <Plus className="h-3.5 w-3.5" /> Write the first rule
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row">
            <aside className="flex min-w-0 flex-col gap-2 lg:w-72 lg:shrink-0">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a rule or element"
                  aria-label="Find a rule or element"
                  className="field h-8 w-full pl-8 text-[13px]"
                />
              </label>
              <div className="inline-flex self-start rounded-lg border border-border p-0.5" role="group" aria-label="List by">
                {(
                  [
                    ['rules', `Rules ${doc.rules.length}`],
                    ['elements', `Controlled elements ${byTarget.size}`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={group === k}
                    onClick={() => setGroup(k)}
                    className={cn('h-7 rounded-md px-2.5 text-[12px]', group === k ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:text-fg')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {withErrors > 0 && (
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" /> {withErrors} rule{withErrors === 1 ? '' : 's'} need{withErrors === 1 ? 's' : ''} a look
                </p>
              )}

              {group === 'rules' ? (
                <ul className="m-0 list-none space-y-1 p-0" aria-label="Rules">
                  {shown.map((r) => {
                    const on = r === rule && !(editing && editing.index < 0)
                    const targets = [...new Set(r.actions.map((a) => a.target.id!))]
                    return (
                      <li key={r.name + r.text.length}>
                        <button
                          type="button"
                          onClick={() => pick(r.name)}
                          aria-current={on || undefined}
                          className={cn(
                            'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                            on ? 'border-accent/50 bg-accent/[0.07]' : 'border-transparent hover:bg-fg/[0.04]',
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-medium text-fg">{r.name || '(no name)'}</span>
                            {r.errors.length > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Has problems" />}
                            {r.priority != null && <span className="shrink-0 text-[11px] tabular-nums text-muted">P{r.priority}</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                            {r.conditions.length} condition{r.conditions.length === 1 ? '' : 's'}
                            {targets.length ? ` · moves ${targets.join(', ')}` : ''}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                  {!shown.length && <li className="px-3 py-2 text-[12px] text-muted">No rule matches “{query}”.</li>}
                </ul>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0" aria-label="Controlled elements">
                  {[...byTarget]
                    .filter(([id, names]) => !q || id.toLowerCase().includes(q) || names.some((n) => n.toLowerCase().includes(q)))
                    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
                    .map(([id, names]) => {
                      const k = known.linkKinds?.get(id) ?? 'pump'
                      return (
                        <li key={id} className="rounded-lg border border-border px-3 py-2">
                          <Chip kind={k} label={`${k.charAt(0).toUpperCase()}${k.slice(1)} ${id}`} onClick={() => ctx.show({ object: k.toUpperCase(), id, attr: '', kind: 'link' })} />
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {names.map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => {
                                  pick(n)
                                  setGroup('rules')
                                }}
                                className="inline-flex items-center gap-0.5 rounded px-1 font-mono text-[11.5px] text-fg-soft hover:bg-fg/[0.06] hover:text-fg"
                              >
                                <ChevronRight className="h-3 w-3 text-muted" />
                                {n}
                              </button>
                            ))}
                          </div>
                        </li>
                      )
                    })}
                </ul>
              )}
            </aside>

            <section className="min-w-0 flex-1">
              {editing ? (
                <RuleEditor
                  key={editing.index}
                  initial={editing.text}
                  isNew={editing.index < 0}
                  known={known}
                  variables={doc.variables}
                  otherNames={doc.rules.filter((_, i) => i !== editing.index).map((r) => r.name.toUpperCase())}
                  ctx={ctx}
                  saving={save.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(t) => {
                    const name = parseRule(t).name
                    save.mutate(replaceRule(text, editing.index, t), {
                      onSuccess: () => {
                        setEditing(null)
                        pick(name)
                        toast({ title: editing.index < 0 ? `Added rule ${name}` : `Saved rule ${name}`, tone: 'success' })
                      },
                    })
                  }}
                />
              ) : (
                rule && (
                  <RuleCard
                    rule={rule}
                    ctx={ctx}
                    hasResults={hasResults}
                    onEdit={() => setEditing({ index, text: rule.text })}
                    onDelete={() => {
                      if (!window.confirm(`Delete rule ${rule.name}?`)) return
                      save.mutate(replaceRule(text, index, null), { onSuccess: () => toast({ title: `Deleted rule ${rule.name}`, tone: 'success' }) })
                    }}
                  />
                )
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ pieces

function Chip({ kind, label, onClick }: { kind: string; label: string; onClick?: () => void }) {
  const color = (ELEMENT_COLOR as Record<string, string>)[kind] ?? ELEMENT_COLOR.timeseries
  const body = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="truncate">{label}</span>
    </>
  )
  const cls = 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[12px] text-fg'
  return onClick ? (
    <button type="button" onClick={onClick} title="Show on the map" className={cn(cls, 'hover:border-fg/30')}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function OperandChip({ o, ctx }: { o: Operand; ctx: Ctx }) {
  if (o.kind === 'simulation') return <span className="text-[13px] text-fg-soft">Simulation</span>
  if (o.kind === 'variable') return <Chip kind="timeseries" label={o.object} />
  const k = ctx.kindOf(o)
  return <Chip kind={k} label={`${cap(k)} ${o.id}`} onClick={['node', 'link', 'subcatchment'].includes(o.kind) ? () => ctx.show(o) : undefined} />
}

function valueText(attr: string, v: string, ctx: Ctx) {
  if (attr === 'TIMEOPEN' || attr === 'TIMECLOSED' || attr === 'TIME') return hoursLabel(v)
  const unit = attrUnit(attr, ctx.us, ctx.flowUnits)
  return unit && Number.isFinite(Number(v)) ? `${v} ${unit}` : v
}

function ConditionRow({ c, label, ctx }: { c: Condition; label: string; ctx: Ctx }) {
  return (
    <li className="flex items-start gap-3 py-1.5">
      <span className={cn('w-9 shrink-0 pt-0.5 text-right text-[11px] font-semibold tracking-wide', label === 'OR' ? 'text-ic-scen' : 'text-muted')}>
        {label}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-fg-soft">
        <OperandChip o={c.left} ctx={ctx} />
        {c.left.attr && <span>{attrLabel(c.left.attr)}</span>}
        <span className="font-medium text-fg">{c.left.attr === 'TIMEOPEN' || c.left.attr === 'TIMECLOSED' ? (c.op === '>' || c.op === '>=' ? 'more than' : c.op === '<' || c.op === '<=' ? 'less than' : opLabel(c.op)) : opLabel(c.op)}</span>
        {typeof c.right === 'string' ? (
          <span className="font-medium tabular-nums text-fg">{valueText(c.left.attr, c.right, ctx)}</span>
        ) : (
          <>
            <OperandChip o={c.right} ctx={ctx} />
            {c.right.attr && <span>{attrLabel(c.right.attr)}</span>}
          </>
        )}
      </span>
    </li>
  )
}

function actionText(a: Action) {
  const v = a.value.toUpperCase()
  if (a.target.attr === 'STATUS') return { verb: v === 'ON' || v === 'OPEN' ? 'turns' : 'turns', value: v }
  if (/^(CURVE|TIMESERIES|PID)\b/.test(v)) return { verb: 'setting follows', value: a.value }
  const n = Number(a.value)
  const note = Number.isFinite(n) ? (n === 0 ? ' (closed)' : n === 1 && a.target.object !== 'PUMP' ? ' (fully open)' : '') : ''
  return { verb: 'setting to', value: `${a.value}${note}` }
}

function ActionRow({ a, label, ctx }: { a: Action; label: string; ctx: Ctx }) {
  const t = actionText(a)
  return (
    <li className="flex items-start gap-3 py-1.5">
      <span className="w-9 shrink-0 pt-0.5 text-right text-[11px] font-semibold tracking-wide text-muted">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-fg-soft">
        <OperandChip o={a.target} ctx={ctx} />
        <span>{t.verb}</span>
        <span className="font-medium text-fg">{t.value}</span>
      </span>
    </li>
  )
}

function RuleBody({ rule, ctx }: { rule: Rule; ctx: Ctx }) {
  // SWMM reads OR together with the condition before it: A AND B OR C is A AND (B OR C).
  const groups: Condition[][] = []
  for (const c of rule.conditions) {
    if (c.join === 'OR' && groups.length) groups[groups.length - 1].push(c)
    else groups.push([c])
  }
  const then = rule.actions.filter((a) => a.branch === 'THEN')
  const els = rule.actions.filter((a) => a.branch === 'ELSE')
  return (
    <div className="space-y-3">
      <ul className="m-0 list-none rounded-lg bg-fg/[0.025] px-3 py-1.5" aria-label="Conditions">
        {groups.map((g, gi) =>
          g.length === 1 ? (
            <ConditionRow key={gi} c={g[0]} label={gi === 0 ? 'IF' : 'AND'} ctx={ctx} />
          ) : (
            <li key={gi} className="flex items-start gap-3 py-1.5">
              <span className="w-9 shrink-0 pt-2 text-right text-[11px] font-semibold tracking-wide text-muted">{gi === 0 ? 'IF' : 'AND'}</span>
              <div className="min-w-0 flex-1 rounded-lg border border-ic-scen/30 px-2 py-1">
                <p className="m-0 px-1 pt-0.5 text-[11px] text-ic-scen">any of</p>
                <ul className="m-0 list-none p-0">
                  {g.map((c, i) => (
                    <ConditionRow key={i} c={c} label={i === 0 ? '' : 'OR'} ctx={ctx} />
                  ))}
                </ul>
              </div>
            </li>
          ),
        )}
        {!rule.conditions.length && <li className="py-1.5 text-[12.5px] text-muted">No conditions.</li>}
      </ul>
      <ul className="m-0 list-none rounded-lg border-l-2 border-accent/60 bg-accent/[0.05] px-3 py-1.5" aria-label="Then">
        {then.map((a, i) => (
          <ActionRow key={i} a={a} label={i === 0 ? 'THEN' : 'AND'} ctx={ctx} />
        ))}
        {!then.length && <li className="py-1.5 text-[12.5px] text-muted">No action.</li>}
      </ul>
      {els.length > 0 && (
        <ul className="m-0 list-none rounded-lg border-l-2 border-border bg-fg/[0.025] px-3 py-1.5" aria-label="Otherwise">
          {els.map((a, i) => (
            <ActionRow key={i} a={a} label={i === 0 ? 'ELSE' : 'AND'} ctx={ctx} />
          ))}
        </ul>
      )}
      {rule.errors.length > 0 && (
        <ul className="m-0 list-none space-y-1 rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-[12.5px] text-fg">
          {rule.errors.map((e) => (
            <li key={e} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RuleCard({ rule, ctx, hasResults, onEdit, onDelete }: { rule: Rule; ctx: Ctx; hasResults: boolean; onEdit?: () => void; onDelete?: () => void }) {
  const navigate = useNavigate()
  const [showText, setShowText] = useState(false)
  const chartKeys = [
    ...new Set([
      ...rule.actions.map((a) => `link:${a.target.id}`),
      ...rule.conditions.flatMap((c) => [c.left, typeof c.right === 'string' ? null : c.right]).filter((o): o is Operand => Boolean(o?.id) && (o!.kind === 'node' || o!.kind === 'link')).map((o) => `${o.kind}:${o.id}`),
    ]),
  ]
  return (
    <article className="rounded-xl border border-border bg-elevated p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="m-0 min-w-0 flex-1 truncate font-mono text-[15px] font-semibold text-fg">{rule.name}</h2>
        {rule.priority != null && (
          <span className="rounded-md bg-fg/[0.06] px-1.5 py-0.5 text-[11.5px] text-fg-soft" title="When rules disagree about an element, the higher priority wins">
            Priority {rule.priority}
          </span>
        )}
        {hasResults && chartKeys.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            title="Chart the elements this rule watches and moves"
            onClick={() => {
              requestGraph(...chartKeys)
              navigate('/map')
            }}
          >
            <LineChart className="h-3.5 w-3.5" /> Show in Graphs
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete rule ${rule.name}`}>
            <Trash2 className="h-3.5 w-3.5 text-danger" />
          </Button>
        )}
      </header>
      <RuleBody rule={rule} ctx={ctx} />
      <button type="button" onClick={() => setShowText((s) => !s)} className="mt-3 inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg" aria-expanded={showText}>
        <Code2 className="h-3.5 w-3.5" /> {showText ? 'Hide' : 'Show'} the SWMM text
      </button>
      {showText && <pre className="mt-2 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-fg-soft">{rule.text}</pre>}
    </article>
  )
}

function RuleEditor({
  initial,
  isNew,
  known,
  variables,
  otherNames,
  ctx,
  saving,
  onCancel,
  onSave,
}: {
  initial: string
  isNew: boolean
  known: KnownIds
  variables: string[]
  otherNames: string[]
  ctx: Ctx
  saving: boolean
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const [t, setT] = useState(initial)
  const rule = useMemo(() => {
    const r = parseRule(t.trim(), new Set(variables), known)
    if (r.name && otherNames.includes(r.name.toUpperCase())) r.errors.push(`Another rule is already named ${r.name}.`)
    return r
  }, [t, variables, known, otherNames])
  const changed = isNew || t.trim() !== initial.trim()
  return (
    <article className="rounded-xl border border-accent/40 bg-elevated p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="m-0 flex-1 text-[15px] font-semibold text-fg">{isNew ? 'New rule' : `Edit ${rule.name || 'rule'}`}</h2>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={saving || !changed || rule.errors.length > 0} onClick={() => onSave(t.trim())}>
          {saving ? 'Saving…' : isNew ? 'Add rule' : 'Save rule'}
        </Button>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <textarea
            value={t}
            onChange={(e) => setT(e.target.value)}
            spellCheck={false}
            aria-label="Rule text"
            rows={Math.max(8, t.split('\n').length + 1)}
            className="field !h-auto min-h-48 w-full resize-y !p-3 font-mono text-[12.5px] leading-relaxed"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && changed && !rule.errors.length) onSave(t.trim())
              if (e.key === 'Escape') onCancel()
            }}
          />
          <p className="m-0 mt-1.5 text-[11.5px] leading-relaxed text-muted">
            One clause per line: RULE name, IF, AND / OR, THEN, AND, ELSE, PRIORITY. For example{' '}
            <span className="font-mono">IF NODE J1 DEPTH &gt; 1.5</span> and <span className="font-mono">THEN PUMP P1 STATUS = ON</span>. Ctrl+Enter saves.
          </p>
        </div>
        <div>
          <p className="m-0 mb-2 text-[12px] font-medium text-fg-soft">How SWMM will read it</p>
          <RuleBody rule={rule} ctx={ctx} />
          {!rule.errors.length && <p className="m-0 mt-2 text-[12px] text-success">Reads cleanly.</p>}
        </div>
      </div>
    </article>
  )
}
