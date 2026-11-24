/**
 * Dry-weather flow: every node's average sanitary (or base) flow and the
 * patterns that shape it, the whole system's flow over a week, and tools to add
 * nodes, set flows from population, and give many nodes the same patterns.
 */
import { CalendarClock, Droplets, Plus, Search, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '../../lib/cn'
import { PATTERN_LABEL, PATTERN_SLOTS, PATTERN_TYPES, dwfSlots, dwfWeek, perCapitaToFlow, trim, type DwfRow, type PatternType, type TimePattern } from '../../lib/seriesData'
import { Button, Dialog, DialogContent } from '../ui'
import { EmptyEditor, Stat, axisTick, fmt, tooltipStyle } from './shared'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const up = (s: string) => s.toUpperCase()

function setSlots(d: DwfRow, patterns: TimePattern[], next: Partial<Record<PatternType, string>>): DwfRow {
  const cur = dwfSlots(d, patterns)
  const merged = { ...cur, ...next }
  return { ...d, patterns: [...PATTERN_TYPES.map((t) => merged[t] ?? '').filter(Boolean), ...cur.other] }
}

export function DwfTab({
  rows,
  setRows,
  patterns,
  nodes,
  pollutants,
  flow,
  us,
  onOpenPatterns,
}: {
  rows: DwfRow[]
  setRows: (r: DwfRow[]) => void
  patterns: TimePattern[]
  nodes: string[]
  pollutants: string[]
  flow: string
  us: boolean
  onOpenPatterns: () => void
}) {
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [month, setMonth] = useState(0)
  const [dialog, setDialog] = useState<null | 'add' | 'people' | 'patterns'>(null)
  const week = useMemo(() => dwfWeek(rows, patterns, month), [rows, patterns, month])
  const flowRows = rows.filter((r) => up(r.constituent) === 'FLOW')
  const total = flowRows.reduce((a, r) => a + (Number(r.average) || 0), 0)
  const peak = Math.max(...week, 0)
  const low = Math.min(...week)
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.node.toLowerCase().includes(filter.toLowerCase()))
  const byType = (t: PatternType) => patterns.filter((p) => p.type === t)
  const edit = (i: number, d: DwfRow) => setRows(rows.map((x, j) => (j === i ? d : x)))
  const allSel = shown.length > 0 && shown.every(({ i }) => sel.has(i))
  const targets = sel.size ? [...sel] : []

  if (!rows.length && !dialog)
    return (
      <EmptyEditor
        icon={<Droplets className="h-5 w-5 text-ic-water" />}
        title="No dry-weather flow yet"
        body="Dry-weather flow is the steady flow a sewer carries without rain: sanitary flow from homes and businesses, and groundwater infiltration. Give nodes an average flow, from a number or from population, then shape it over the day with time patterns."
        actions={
          <>
            <Button variant="primary" onClick={() => setDialog('add')}>
              <Plus className="h-3.5 w-3.5" /> Add nodes
            </Button>
            <Button variant="outline" onClick={onOpenPatterns}>
              <CalendarClock className="h-3.5 w-3.5" /> Set up time patterns first
            </Button>
          </>
        }
      />
    )

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="grid grid-cols-2 content-start gap-3 xl:grid-cols-1">
          <Stat label="Nodes with flow" value={new Set(flowRows.map((r) => up(r.node))).size} />
          <Stat label={`Total average (${flow})`} value={fmt(total)} />
          <Stat label={`Peak hour (${flow})`} value={fmt(peak)} />
          <Stat label={`Lowest hour (${flow})`} value={fmt(low)} />
          <Stat label="Peaking factor" value={total ? fmt(peak / total) : '–'} />
        </div>
        <div className="rounded-lg border border-border bg-elevated p-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[12px] font-medium text-fg">Total dry-weather flow over a week</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month" className="field h-7 w-auto text-[12px]">
              {PATTERN_SLOTS.MONTHLY.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={week.map((v, i) => ({ h: i, v }))} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="h" type="number" domain={[0, 167]} ticks={[0, 24, 48, 72, 96, 120, 144]} tickFormatter={(h) => DAYS[Math.floor(h / 24)]!} tick={axisTick} />
                <YAxis tick={axisTick} width={46} tickFormatter={fmt} />
                <Tooltip formatter={(v) => [`${fmt(Number(v))} ${flow}`, 'Flow']} labelFormatter={(h) => `${DAYS[Math.floor(Number(h) / 24)]} ${Number(h) % 24}:00`} contentStyle={tooltipStyle} />
                <Area type="stepAfter" dataKey="v" stroke="var(--color-ic-water)" fill="var(--color-ic-water)" fillOpacity={0.18} strokeWidth={1.6} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a node" aria-label="Find a node" className="field h-8 w-48 pl-7 text-[12.5px]" />
        </label>
        <Button variant="outline" size="sm" onClick={() => setDialog('add')}>
          <Plus className="h-3.5 w-3.5" /> Add nodes
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <span className="text-[12px] text-muted">{sel.size ? `${sel.size} selected:` : 'Select rows to:'}</span>
        <Button variant="outline" size="sm" disabled={!sel.size} onClick={() => setDialog('people')}>
          <Users className="h-3.5 w-3.5" /> Set flow from population
        </Button>
        <Button variant="outline" size="sm" disabled={!sel.size} onClick={() => setDialog('patterns')}>
          <CalendarClock className="h-3.5 w-3.5" /> Set patterns
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:text-danger"
          disabled={!sel.size}
          onClick={() => {
            setRows(rows.filter((_, i) => !sel.has(i)))
            setSel(new Set())
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </Button>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-elevated">
        <table className="w-full min-w-[860px] border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-[11.5px] text-muted">
              <th className="w-9 px-3 py-2">
                <input type="checkbox" aria-label="Select all shown" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(shown.map(({ i }) => i)))} />
              </th>
              <th className="px-1 py-2 font-medium">Node</th>
              <th className="px-1 py-2 font-medium">What</th>
              <th className="px-1 py-2 font-medium">Average</th>
              {PATTERN_TYPES.map((t) => (
                <th key={t} className="px-1 py-2 font-medium">
                  {PATTERN_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, i }) => {
              const slots = dwfSlots(r, patterns)
              const isFlow = up(r.constituent) === 'FLOW'
              const known = nodes.some((n) => up(n) === up(r.node))
              return (
                <tr key={i} className={cn('border-b border-border/60 last:border-0', sel.has(i) && 'bg-accent/[0.06]')}>
                  <td className="px-3 py-1">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.node}`}
                      checked={sel.has(i)}
                      onChange={() => {
                        const s = new Set(sel)
                        if (s.has(i)) s.delete(i)
                        else s.add(i)
                        setSel(s)
                      }}
                    />
                  </td>
                  <td className={cn('px-1 py-1 font-mono', known ? 'text-fg' : 'text-danger')} title={known ? undefined : 'No node with this name'}>
                    {r.node}
                  </td>
                  <td className="px-1 py-1">
                    <select value={r.constituent} onChange={(e) => edit(i, { ...r, constituent: e.target.value })} aria-label={`What enters at ${r.node}`} className="field h-7 w-full max-w-[9rem] text-[12px]">
                      <option value="FLOW">Flow</option>
                      {pollutants.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      {!isFlow && !pollutants.some((p) => up(p) === up(r.constituent)) && <option value={r.constituent}>{r.constituent}</option>}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      <input value={r.average} onChange={(e) => edit(i, { ...r, average: e.target.value })} aria-label={`Average at ${r.node}`} inputMode="decimal" className="field h-7 w-28 text-[12px] tabular-nums" />
                      <span className="text-[11px] text-muted">{isFlow ? flow : 'conc.'}</span>
                    </div>
                  </td>
                  {PATTERN_TYPES.map((t) => (
                    <td key={t} className="px-1 py-1">
                      <select
                        value={slots[t] ?? ''}
                        onChange={(e) => edit(i, setSlots(r, patterns, { [t]: e.target.value }))}
                        aria-label={`${PATTERN_LABEL[t]} pattern at ${r.node}`}
                        className={cn('field h-7 w-full text-[12px]', !slots[t] && 'text-muted')}
                      >
                        <option value="">None</option>
                        {byType(t).map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!shown.length && <p className="m-0 px-3 py-4 text-[12px] text-muted">No nodes match.</p>}
      </div>
      {!patterns.length && (
        <p className="mt-2 text-[12px] text-muted">
          With no patterns the flow is the same every hour.{' '}
          <button type="button" className="text-accent-soft hover:underline" onClick={onOpenPatterns}>
            Make a pattern
          </button>
        </p>
      )}

      <AddNodesDialog
        open={dialog === 'add'}
        onOpenChange={(o) => setDialog(o ? 'add' : null)}
        nodes={nodes.filter((n) => !rows.some((r) => up(r.node) === up(n) && up(r.constituent) === 'FLOW'))}
        flow={flow}
        onAdd={(list, avg) => {
          const start = rows.length
          setRows([...rows, ...list.map((node) => ({ node, constituent: 'FLOW', average: avg, patterns: [] }))])
          setSel(new Set(list.map((_, k) => start + k)))
        }}
      />
      <PopulationDialog
        open={dialog === 'people'}
        onOpenChange={(o) => setDialog(o ? 'people' : null)}
        count={targets.length}
        flow={flow}
        us={us}
        onApply={(people, rate) => setRows(rows.map((r, i) => (sel.has(i) && up(r.constituent) === 'FLOW' ? { ...r, average: trim(perCapitaToFlow(rate, people, flow), 6) } : r)))}
      />
      <PatternsDialog
        open={dialog === 'patterns'}
        onOpenChange={(o) => setDialog(o ? 'patterns' : null)}
        count={targets.length}
        patterns={patterns}
        onApply={(next) => setRows(rows.map((r, i) => (sel.has(i) ? setSlots(r, patterns, next) : r)))}
      />
    </div>
  )
}

function AddNodesDialog({ open, onOpenChange, nodes, flow, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; nodes: string[]; flow: string; onAdd: (n: string[], avg: string) => void }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [avg, setAvg] = useState('0')
  const shown = nodes.filter((n) => n.toLowerCase().includes(q.toLowerCase()))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add dry-weather flow to nodes" description="Pick the nodes that receive flow. You can set flows from population afterwards." className="w-[min(480px,calc(100vw-2rem))]">
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find nodes" aria-label="Find nodes" className="field h-8 min-w-0 flex-1 text-[12.5px]" />
          <Button variant="outline" size="sm" className="h-8" onClick={() => setPick(new Set([...pick, ...shown]))}>
            Select {q ? 'shown' : 'all'}
          </Button>
        </div>
        <div className="mt-2 h-60 overflow-y-auto rounded-md border border-border p-1">
          {shown.map((n) => (
            <label key={n} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-fg/[0.04]">
              <input
                type="checkbox"
                checked={pick.has(n)}
                onChange={() => {
                  const s = new Set(pick)
                  if (s.has(n)) s.delete(n)
                  else s.add(n)
                  setPick(s)
                }}
              />
              <span className="font-mono">{n}</span>
            </label>
          ))}
          {!shown.length && <p className="m-0 p-2 text-[12px] text-muted">{nodes.length ? 'No match.' : 'Every node already has dry-weather flow.'}</p>}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12.5px]">
          <span className="text-muted">Average flow for each</span>
          <input value={avg} onChange={(e) => setAvg(e.target.value)} inputMode="decimal" className="field h-8 w-24 tabular-nums" />
          <span className="text-muted">{flow}</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!pick.size}
            onClick={() => {
              onAdd(nodes.filter((n) => pick.has(n)), avg.trim() || '0')
              setPick(new Set())
              onOpenChange(false)
            }}
          >
            Add {pick.size || ''} node{pick.size === 1 ? '' : 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PopulationDialog({ open, onOpenChange, count, flow, us, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; flow: string; us: boolean; onApply: (people: number, rate: number) => void }) {
  const [people, setPeople] = useState('100')
  const [rate, setRate] = useState(us ? '80' : '200')
  const each = perCapitaToFlow(Number(rate) || 0, Number(people) || 0, flow)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Set flow from population"
        description={`Average flow = people × water use per person, for each of the ${count} selected node${count === 1 ? '' : 's'}.`}
        className="w-[min(460px,calc(100vw-2rem))]"
      >
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12.5px]">
          <span className="text-muted">People at each node</span>
          <input value={people} onChange={(e) => setPeople(e.target.value)} inputMode="decimal" className="field h-8 w-28 tabular-nums" />
          <span className="text-muted">Per person per day</span>
          <span className="flex items-center gap-2">
            <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="field h-8 w-28 tabular-nums" />
            <span className="text-muted">{us ? 'gallons' : 'litres'}</span>
          </span>
        </div>
        <p className="mb-0 mt-3 text-[12px] leading-relaxed text-muted">
          Typical values are {us ? '60 to 100 gallons' : '150 to 250 litres'} per person per day, before infiltration; use your utility’s design figure. Each node gets{' '}
          <span className="font-medium text-fg">
            {fmt(each)} {flow}
          </span>
          .
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!Number(people) || !Number(rate)}
            onClick={() => {
              onApply(Number(people), Number(rate))
              onOpenChange(false)
            }}
          >
            Set {count} node{count === 1 ? '' : 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PatternsDialog({ open, onOpenChange, count, patterns, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; patterns: TimePattern[]; onApply: (p: Partial<Record<PatternType, string>>) => void }) {
  const KEEP = '\u0000keep'
  const [pick, setPick] = useState<Record<PatternType, string>>({ MONTHLY: KEEP, DAILY: KEEP, HOURLY: KEEP, WEEKEND: KEEP })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Set patterns" description={`For the ${count} selected node${count === 1 ? '' : 's'}.`} className="w-[min(420px,calc(100vw-2rem))]">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12.5px]">
          {PATTERN_TYPES.map((t) => (
            <label key={t} className="contents">
              <span className="text-muted">{PATTERN_LABEL[t]}</span>
              <select value={pick[t]} onChange={(e) => setPick({ ...pick, [t]: e.target.value })} className="field h-8 text-[12.5px]">
                <option value={KEEP}>Leave as it is</option>
                <option value="">None</option>
                {patterns
                  .filter((p) => p.type === t)
                  .map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onApply(Object.fromEntries(Object.entries(pick).filter(([, v]) => v !== KEEP)) as Partial<Record<PatternType, string>>)
              onOpenChange(false)
            }}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
