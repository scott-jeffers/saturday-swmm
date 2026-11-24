/**
 * RDII unit hydrographs ([HYDROGRAPHS]) and the sewersheds that use them ([RDII]).
 * Each group has a rain gage and up to three triangular responses (short,
 * medium, long: R, T, K, with optional initial abstraction) for all months or
 * for each month on its own.
 */
import { Plus, Trash2, Waves } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '../../lib/cn'
import { MONTHS, RESPONSES, emptyRtk, freeName, rtkCurve, usedBy, type Month, type RdiiRow, type Response, type Rtk, type Sections, type UnitHydrograph } from '../../lib/seriesData'
import { Button } from '../ui'
import { EmptyEditor, ItemHeader, ItemList, Stat, axisTick, fmt, tooltipStyle } from './shared'

const RESP_LABEL: Record<Response, string> = { SHORT: 'Short term (fast inflow)', MEDIUM: 'Medium term', LONG: 'Long term (slow infiltration)' }
const RESP_COLOR: Record<Response, string> = { SHORT: 'var(--color-ic-rain)', MEDIUM: 'var(--color-ic-scen)', LONG: 'var(--color-ic-land)' }
const MONTH_LABEL = (m: Month) => (m === 'ALL' ? 'All months' : m[0] + m.slice(1).toLowerCase())
const FIELDS: { k: keyof Rtk; label: string; hint: string; ia?: boolean }[] = [
  { k: 'r', label: 'R', hint: 'Fraction of the rain falling on the sewershed that enters the sewer' },
  { k: 't', label: 'T (h)', hint: 'Hours from the start of rain to the peak' },
  { k: 'k', label: 'K', hint: 'Recession time ÷ time to peak' },
  { k: 'dmax', label: 'Dmax', hint: 'Most rain that can be held back before any RDII (initial abstraction depth)', ia: true },
  { k: 'drecov', label: 'Drecov', hint: 'How fast that depth recovers in dry weather (depth per day)', ia: true },
  { k: 'dinit', label: 'Dinit', hint: 'How much of it is already used at the start', ia: true },
]

export function UnitHydrographsTab({
  list,
  setList,
  rdii,
  setRdii,
  secs,
  missing,
  pick,
  setPick,
  onRename,
  gages,
  nodes,
  us,
}: {
  list: UnitHydrograph[]
  setList: (l: UnitHydrograph[]) => void
  rdii: RdiiRow[]
  setRdii: (r: RdiiRow[]) => void
  secs: Sections
  missing: { name: string; by: string }[]
  pick: string | null
  setPick: (n: string | null) => void
  onRename: (from: string, to: string) => void
  gages: string[]
  nodes: string[]
  us: boolean
}) {
  const current = list.find((u) => u.name === pick) ?? list[0] ?? null
  const names = list.map((u) => u.name)
  const items = list.map((u) => {
    const r = rtkCurve(u.months.ALL ?? Object.values(u.months)[0]).totalR
    const sheds = rdii.filter((x) => x.uh.toUpperCase() === u.name.toUpperCase()).length
    return { name: u.name, sub: `${sheds} node${sheds === 1 ? '' : 's'}`, warn: !u.gage || u.gage === '*' ? 'No rain gage' : r > 1 ? 'R adds up to more than 1' : undefined }
  })
  const add = (name = freeName('UH', names)) => {
    setList([...list, { name, gage: gages[0] ?? '', months: { ALL: { SHORT: { ...emptyRtk(), r: '0.01', t: '1', k: '2' }, MEDIUM: { ...emptyRtk(), r: '0.01', t: '4', k: '3' }, LONG: { ...emptyRtk(), r: '0.01', t: '12', k: '4' } } } }])
    setPick(name)
  }
  const update = (u: UnitHydrograph) => current && setList(list.map((x) => (x.name === current.name ? u : x)))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 max-md:flex-col">
      <ItemList noun="unit hydrographs" items={items} current={current?.name ?? null} onPick={setPick} onAdd={() => add()} addLabel="New unit hydrograph" missing={missing} onCreateMissing={(n) => add(n)} />
      {current ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <ItemHeader
            name={current.name}
            taken={names}
            usedBy={usedBy('hydrograph', current.name, secs)}
            onRename={(to) => {
              onRename(current.name, to)
              setPick(to)
            }}
            onDuplicate={() => {
              const n = freeName(`${current.name}_copy`, names)
              setList([...list, { ...structuredClone(current), name: n }])
              setPick(n)
            }}
            onDelete={() => {
              setList(list.filter((u) => u.name !== current.name))
              setRdii(rdii.filter((r) => r.uh.toUpperCase() !== current.name.toUpperCase()))
              setPick(null)
            }}
          >
            <label className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              Rain gage
              <select value={current.gage} onChange={(e) => update({ ...current, gage: e.target.value })} className={cn('field h-8 w-auto text-[12.5px]', (!current.gage || current.gage === '*') && 'border-warning')}>
                {(!current.gage || current.gage === '*') && <option value="">Choose…</option>}
                {gages.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                {current.gage && current.gage !== '*' && !gages.includes(current.gage) && <option value={current.gage}>{current.gage} (missing)</option>}
              </select>
            </label>
          </ItemHeader>
          <UhEditor key={current.name} u={current} update={update} us={us} />
          <Sewersheds uh={current.name} rdii={rdii} setRdii={setRdii} nodes={nodes} us={us} />
        </div>
      ) : (
        <EmptyEditor
          icon={<Waves className="h-5 w-5 text-ic-water" />}
          title="No unit hydrographs yet"
          body="Unit hydrographs add rainfall-derived infiltration and inflow (RDII) to sanitary sewers: rain on a sewershed reaches the pipes through leaks and connections, quickly and then slowly. Each one is up to three triangles (the RTK method) fitted to flow monitoring."
          actions={
            <Button variant="primary" onClick={() => add()} disabled={!gages.length}>
              New unit hydrograph
            </Button>
          }
        />
      )}
    </div>
  )
}

function UhEditor({ u, update, us }: { u: UnitHydrograph; update: (u: UnitHydrograph) => void; us: boolean }) {
  const [month, setMonth] = useState<Month>(u.months.ALL ? 'ALL' : ((Object.keys(u.months)[0] as Month) ?? 'ALL'))
  const own = u.months[month]
  const set = own ?? u.months.ALL
  const inherited = !own && month !== 'ALL'
  const curve = useMemo(() => rtkCurve(set), [set])
  const showIa = RESPONSES.some((r) => set?.[r]?.dmax || set?.[r]?.drecov || set?.[r]?.dinit)
  const [ia, setIa] = useState(showIa)
  const edit = (resp: Response, k: keyof Rtk, v: string) => {
    const base = structuredClone(set ?? {})
    base[resp] = { ...(base[resp] ?? emptyRtk()), [k]: v }
    update({ ...u, months: { ...u.months, [month]: base } })
  }
  const len = us ? 'in' : 'mm'
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Month">
        {MONTHS.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={month === m}
            onClick={() => setMonth(m)}
            className={cn(
              'relative rounded-md px-2 py-1 text-[12px]',
              month === m ? 'bg-accent/15 font-medium text-fg' : 'text-fg-soft hover:bg-fg/[0.05]',
            )}
          >
            {MONTH_LABEL(m)}
            {m !== 'ALL' && u.months[m] && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-label="has its own values" />}
          </button>
        ))}
      </div>
      {inherited ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-fg-soft">
          {MONTH_LABEL(month)} uses the all-months values.
          <Button variant="outline" size="sm" onClick={() => update({ ...u, months: { ...u.months, [month]: structuredClone(u.months.ALL ?? { SHORT: emptyRtk() }) } })}>
            Give {MONTH_LABEL(month)} its own values
          </Button>
        </div>
      ) : (
        month !== 'ALL' && (
          <button
            type="button"
            className="text-[12px] text-accent-soft hover:underline"
            onClick={() => {
              const m = { ...u.months }
              delete m[month]
              update({ ...u, months: m })
            }}
          >
            Use the all-months values for {MONTH_LABEL(month)} instead
          </button>
        )
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-elevated">
        <table className={cn('w-full border-collapse text-left text-[12.5px]', inherited && 'opacity-60')}>
          <thead>
            <tr className="border-b border-border text-[11.5px] text-muted">
              <th className="px-3 py-2 font-medium">Response</th>
              {FIELDS.filter((f) => !f.ia || ia).map((f) => (
                <th key={f.k} className="px-1 py-2 font-medium" title={f.hint}>
                  {f.label}
                  {f.ia && f.k !== 'drecov' ? ` (${len})` : f.k === 'drecov' ? ` (${len}/day)` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESPONSES.map((resp) => (
              <tr key={resp} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-3 py-1">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RESP_COLOR[resp] }} />
                  {RESP_LABEL[resp]}
                </td>
                {FIELDS.filter((f) => !f.ia || ia).map((f) => (
                  <td key={f.k} className="px-1 py-1">
                    <input
                      value={set?.[resp]?.[f.k] ?? ''}
                      disabled={inherited}
                      onChange={(e) => edit(resp, f.k, e.target.value)}
                      aria-label={`${resp} ${f.label}`}
                      inputMode="decimal"
                      className="field h-7 w-20 text-[12px] tabular-nums"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Stat label="Total R" value={fmt(curve.totalR)} tone={curve.totalR > 1 ? 'warn' : undefined} />
        <Stat label="Share of rain entering the sewer" value={`${fmt(curve.totalR * 100)} %`} />
        <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-fg-soft">
          <input type="checkbox" checked={ia} onChange={(e) => setIa(e.target.checked)} /> Initial abstraction (Dmax, Drecov, Dinit)
        </label>
      </div>
      <div className="h-60 rounded-lg border border-border bg-elevated px-1 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve.pts} margin={{ top: 6, right: 16, bottom: 22, left: 6 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" />
            <XAxis dataKey="t" type="number" domain={[0, 'dataMax']} tickFormatter={(v) => `${fmt(v)}`} tick={axisTick} label={{ value: 'Hours after an hour of rain starts', position: 'insideBottom', offset: -14, fontSize: 11, fill: 'var(--color-muted)' }} />
            <YAxis tick={axisTick} width={50} tickFormatter={fmt} label={{ value: 'Share of rain per hour', angle: -90, position: 'insideLeft', offset: 2, fontSize: 11, fill: 'var(--color-muted)', style: { textAnchor: 'middle' } }} />
            <Tooltip formatter={(v, n) => [fmt(Number(v)), n === 'total' ? 'Total' : RESP_LABEL[n as Response] ?? n]} labelFormatter={(t) => `${fmt(Number(t))} h`} contentStyle={tooltipStyle} />
            <Legend verticalAlign="top" align="right" height={22} iconType="plainline" wrapperStyle={{ fontSize: 11 }} formatter={(n) => (n === 'total' ? 'Total' : (n as string)[0] + (n as string).slice(1).toLowerCase())} />
            {RESPONSES.map((r) => (
              <Line key={r} dataKey={r} stroke={RESP_COLOR[r]} strokeWidth={1.4} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            ))}
            <Line dataKey="total" stroke="var(--color-fg)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="m-0 max-w-3xl text-[12px] leading-relaxed text-muted">
        Each triangle rises to its peak at T hours and falls back over K × T hours; the area under it is R. RDII at a node is this response to the rain gage’s rainfall, times the sewershed area.
      </p>
    </div>
  )
}

function Sewersheds({ uh, rdii, setRdii, nodes, us }: { uh: string; rdii: RdiiRow[]; setRdii: (r: RdiiRow[]) => void; nodes: string[]; us: boolean }) {
  const [adding, setAdding] = useState('')
  const mine = rdii.map((r, i) => ({ r, i })).filter(({ r }) => r.uh.toUpperCase() === uh.toUpperCase())
  const free = nodes.filter((n) => !rdii.some((r) => r.node.toUpperCase() === n.toUpperCase()))
  const area = mine.reduce((a, { r }) => a + (Number(r.area) || 0), 0)
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-[13px] font-semibold text-fg">Sewersheds using {uh}</h3>
        <span className="text-[12px] text-muted">
          {mine.length} node{mine.length === 1 ? '' : 's'} · {fmt(area)} {us ? 'acres' : 'hectares'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Node to add" className="field h-7 w-auto max-w-[12rem] text-[12px]">
            <option value="">Add a node…</option>
            {free.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={!adding}
            onClick={() => {
              setRdii([...rdii, { node: adding, uh, area: '0' }])
              setAdding('')
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>
      {mine.length ? (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {mine.map(({ r, i }) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-elevated px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{r.node}</span>
              <input value={r.area} onChange={(e) => setRdii(rdii.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))} aria-label={`Sewershed area at ${r.node}`} inputMode="decimal" className="field h-7 w-20 text-[12px] tabular-nums" />
              <span className="text-[11px] text-muted">{us ? 'ac' : 'ha'}</span>
              <button type="button" aria-label={`Remove ${r.node}`} onClick={() => setRdii(rdii.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:bg-fg/[0.06] hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-[12px] text-muted">No nodes receive RDII from this unit hydrograph yet. Add the nodes its sewersheds drain to, with each sewershed’s area.</p>
      )}
    </div>
  )
}
