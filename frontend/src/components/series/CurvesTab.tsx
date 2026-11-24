/**
 * Curves: storage, pump, rating, diversion, tidal, control, shape and weir
 * curves, with axes in the model's units and what each type is for.
 */
import { Spline } from 'lucide-react'
import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CURVE_TYPES, curveMeaning, freeName, usedBy, type Curve, type Sections } from '../../lib/seriesData'
import { Button } from '../ui'
import { EmptyEditor, Grid, ItemHeader, ItemList, Stat, axisTick, fmt, tooltipStyle } from './shared'

export function CurvesTab({
  list,
  setList,
  secs,
  missing,
  pick,
  setPick,
  onRename,
  us,
  flow,
}: {
  list: Curve[]
  setList: (l: Curve[]) => void
  secs: Sections
  missing: { name: string; by: string }[]
  pick: string | null
  setPick: (n: string | null) => void
  onRename: (from: string, to: string) => void
  us: boolean
  flow: string
}) {
  const current = list.find((c) => c.name === pick) ?? list[0] ?? null
  const label = (t: string) => curveMeaning(t, us, flow).label
  const items = useMemo(
    () =>
      [...list]
        .sort((a, b) => CURVE_TYPES.indexOf(a.type as never) - CURVE_TYPES.indexOf(b.type as never))
        .map((c) => {
          const x = c.points.map((p) => Number(p[0]))
          const unordered = x.some((v, i) => i > 0 && !(v > x[i - 1]!))
          return { name: c.name, group: label(c.type), sub: `${c.points.length}`, warn: unordered ? 'X values must increase down the table' : undefined }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, us, flow],
  )
  const add = (type: string = current?.type || 'STORAGE', name?: string) => {
    const n = name ?? freeName(type === 'STORAGE' ? 'Storage_curve' : type.startsWith('PUMP') ? 'Pump_curve' : `${label(type)}_curve`, list.map((c) => c.name))
    setList([...list, { name: n, type, points: [['0', '0'], ['', '']] }])
    setPick(n)
  }
  const update = (patch: Partial<Curve>) => current && setList(list.map((c) => (c.name === current.name ? { ...c, ...patch } : c)))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 max-md:flex-col">
      <ItemList noun="curves" items={items} current={current?.name ?? null} onPick={setPick} onAdd={() => add()} addLabel="New curve" missing={missing} onCreateMissing={(n) => add(guessType(n, secs), n)} />
      {current ? (
        <CurveEditor
          c={current}
          list={list}
          secs={secs}
          us={us}
          flow={flow}
          update={update}
          onRename={(to) => {
            onRename(current.name, to)
            setPick(to)
          }}
          onDuplicate={() => {
            const n = freeName(`${current.name}_copy`, list.map((c) => c.name))
            setList([...list, { ...current, name: n, points: current.points.map((p) => [...p] as [string, string]) }])
            setPick(n)
          }}
          onDelete={() => {
            setList(list.filter((c) => c.name !== current.name))
            setPick(null)
          }}
        />
      ) : (
        <EmptyEditor
          icon={<Spline className="h-5 w-5 text-ic-data" />}
          title="No curves yet"
          body="Curves describe relationships rather than changes over time: a storage unit’s area at each depth, a pump’s flow, an outlet’s rating, a tide over a day. Pick what kind to start with."
          actions={['STORAGE', 'PUMP3', 'RATING', 'TIDAL'].map((t) => (
            <Button key={t} variant="outline" onClick={() => add(t)}>
              {label(t)}
            </Button>
          ))}
        />
      )}
    </div>
  )
}

/** A missing curve's type from what uses it. */
function guessType(name: string, secs: Sections): string {
  const r = usedBy('curve', name, secs)[0]
  switch (r?.section) {
    case 'STORAGE':
      return 'STORAGE'
    case 'PUMPS':
      return 'PUMP3'
    case 'OUTLETS':
      return 'RATING'
    case 'DIVIDERS':
      return 'DIVERSION'
    case 'OUTFALLS':
      return 'TIDAL'
    case 'XSECTIONS':
      return 'SHAPE'
    case 'WEIRS':
      return 'WEIR'
    default:
      return 'CONTROL'
  }
}

function CurveEditor({
  c,
  list,
  secs,
  us,
  flow,
  update,
  onRename,
  onDuplicate,
  onDelete,
}: {
  c: Curve
  list: Curve[]
  secs: Sections
  us: boolean
  flow: string
  update: (p: Partial<Curve>) => void
  onRename: (to: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const m = curveMeaning(c.type, us, flow)
  const data = c.points.map(([x, y]) => ({ x: Number(x), y: Number(y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  const invalid = new Set<number>()
  c.points.forEach(([x], i) => {
    if (i > 0 && x.trim() && !(Number(x) > Number(c.points[i - 1]![0]))) invalid.add(i)
    if (x.trim() && !Number.isFinite(Number(x))) invalid.add(i)
  })
  const stepped = c.type === 'PUMP1' || c.type === 'PUMP2'
  const ys = data.map((d) => d.y)
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <ItemHeader name={c.name} taken={list.map((x) => x.name)} usedBy={usedBy('curve', c.name, secs)} onRename={onRename} onDuplicate={onDuplicate} onDelete={onDelete}>
        <select value={c.type} onChange={(e) => update({ type: e.target.value })} aria-label="Curve type" className="field h-8 w-auto text-[12.5px]">
          {CURVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {curveMeaning(t, us, flow).label}
            </option>
          ))}
        </select>
      </ItemHeader>
      <div className="space-y-4 px-5 py-4">
        {m.hint && <p className="m-0 max-w-2xl text-[12.5px] leading-relaxed text-fg-soft">{m.hint}</p>}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
          <Stat label="Points" value={c.points.length} />
          <Stat label={`${m.x} range`} value={data.length ? `${fmt(data[0]!.x)} – ${fmt(data[data.length - 1]!.x)}` : '–'} />
          <Stat label={`${m.y} range`} value={ys.length ? `${fmt(Math.min(...ys))} – ${fmt(Math.max(...ys))}` : '–'} />
          {invalid.size > 0 && <Stat label="To check" value={`${invalid.size} row${invalid.size === 1 ? '' : 's'}`} tone="warn" />}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="h-72 rounded-lg border border-border bg-elevated px-1 pt-2">
            {data.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 6, right: 16, bottom: 22, left: 8 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" />
                  <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmt} tick={axisTick} label={{ value: m.x, position: 'insideBottom', offset: -14, fontSize: 11, fill: 'var(--color-muted)' }} />
                  <YAxis tick={axisTick} width={54} tickFormatter={fmt} label={{ value: m.y, angle: -90, position: 'insideLeft', offset: 2, fontSize: 11, fill: 'var(--color-muted)', style: { textAnchor: 'middle' } }} />
                  <Tooltip formatter={(v) => [fmt(Number(v)), m.y]} labelFormatter={(x) => `${m.x}: ${fmt(Number(x))}`} contentStyle={tooltipStyle} />
                  <Line type={stepped ? 'stepAfter' : 'linear'} dataKey="y" stroke="var(--color-ic-data)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="m-0 pt-28 text-center text-[12px] text-muted">Add two or more points to see the curve.</p>
            )}
          </div>
          <Grid
            columns={[
              { key: 'x', label: m.x, numeric: true },
              { key: 'y', label: m.y, numeric: true },
            ]}
            rows={c.points.map((p) => [...p])}
            onChange={(rows) => update({ points: rows.map((r) => [r[0] ?? '', r[1] ?? ''] as [string, string]) })}
            invalid={invalid}
            height={232}
            addLabel="Add a point"
          />
        </div>
        {invalid.size > 0 && <p className="m-0 text-[12px] text-warning">{m.x} must increase down the table; SWMM stops at a curve whose X values go back.</p>}
      </div>
    </div>
  )
}
