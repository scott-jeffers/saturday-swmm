/**
 * Time patterns: multipliers by month, day of the week, hour, and weekend hour,
 * used by dry-weather flow, inflow baselines and monthly adjustments. Drag the
 * bars or type the factors.
 */
import { CalendarClock, Scale, Wand2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import * as DM from '@radix-ui/react-dropdown-menu'
import { cn } from '../../lib/cn'
import {
  PATTERN_LABEL,
  PATTERN_PRESETS,
  PATTERN_SLOTS,
  PATTERN_TYPES,
  fitFactors,
  freeName,
  normalisePattern,
  patternMean,
  presetPattern,
  trim,
  usedBy,
  type PatternType,
  type Sections,
  type TimePattern,
} from '../../lib/seriesData'
import { Button } from '../ui'
import { EmptyEditor, ItemHeader, ItemList, Stat, fmt } from './shared'

export function PatternsTab({
  list,
  setList,
  secs,
  missing,
  pick,
  setPick,
  onRename,
}: {
  list: TimePattern[]
  setList: (l: TimePattern[]) => void
  secs: Sections
  missing: { name: string; by: string }[]
  pick: string | null
  setPick: (n: string | null) => void
  onRename: (from: string, to: string) => void
}) {
  const current = list.find((p) => p.name === pick) ?? list[0] ?? null
  const items = useMemo(
    () =>
      [...list]
        .sort((a, b) => PATTERN_TYPES.indexOf(a.type) - PATTERN_TYPES.indexOf(b.type))
        .map((p) => {
          const m = patternMean(p)
          return { name: p.name, group: PATTERN_LABEL[p.type], sub: `avg ${fmt(m)}`, warn: Math.abs(m - 1) > 0.02 ? `Factors average ${fmt(m)}, not 1: the average flow changes too` : undefined }
        }),
    [list],
  )
  const names = list.map((p) => p.name)
  const add = (type: PatternType = current?.type ?? 'HOURLY', name?: string) => {
    const n = name ?? freeName(type === 'MONTHLY' ? 'Monthly' : type === 'DAILY' ? 'Daily' : type === 'WEEKEND' ? 'Weekend' : 'Hourly', names)
    setList([...list, { name: n, type, factors: fitFactors([], type) }])
    setPick(n)
  }
  const addPreset = (id: string) => {
    const p = PATTERN_PRESETS.find((x) => x.id === id)!
    const n = freeName(p.label.split(' (')[0]!.replace(/\s+/g, '_'), names)
    setList([...list, presetPattern(id, n)])
    setPick(n)
  }
  const update = (patch: Partial<TimePattern>) => current && setList(list.map((p) => (p.name === current.name ? { ...p, ...patch } : p)))

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      <ItemList
        noun="patterns"
        items={items}
        current={current?.name ?? null}
        onPick={setPick}
        onAdd={() => add()}
        addLabel="New pattern"
        missing={missing}
        onCreateMissing={(n) => add('HOURLY', n)}
        extra={<PresetMenu onPick={addPreset} />}
      />
      {current ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <ItemHeader
            name={current.name}
            taken={names}
            usedBy={usedBy('pattern', current.name, secs)}
            onRename={(to) => {
              onRename(current.name, to)
              setPick(to)
            }}
            onDuplicate={() => {
              const n = freeName(`${current.name}_copy`, names)
              setList([...list, { ...current, name: n, factors: [...current.factors] }])
              setPick(n)
            }}
            onDelete={() => {
              setList(list.filter((p) => p.name !== current.name))
              setPick(null)
            }}
          >
            <select
              value={current.type}
              onChange={(e) => update({ type: e.target.value as PatternType, factors: fitFactors(current.factors, e.target.value as PatternType) })}
              aria-label="Pattern type"
              className="field h-8 w-auto text-[12.5px]"
            >
              {PATTERN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PATTERN_LABEL[t]}
                </option>
              ))}
            </select>
          </ItemHeader>
          <PatternEditor p={current} onFactors={(factors) => update({ factors })} onNormalise={() => update({ factors: normalisePattern(current).factors })} />
        </div>
      ) : (
        <EmptyEditor
          icon={<CalendarClock className="h-5 w-5 text-ic-scen" />}
          title="No time patterns yet"
          body="Patterns make a steady flow vary: by hour of the day (with a separate weekend shape), by day of the week, and by month. Dry-weather flow is the usual use. Start from an example shape and adjust it to your flow monitoring."
          actions={
            <>
              <Button variant="primary" onClick={() => addPreset('res-weekday')}>
                <Wand2 className="h-3.5 w-3.5" /> Residential weekday shape
              </Button>
              <Button variant="outline" onClick={() => add('HOURLY')}>
                Blank hourly pattern
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}

function PresetMenu({ onPick }: { onPick: (id: string) => void }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Wand2 className="h-3.5 w-3.5" /> Start from an example
        </Button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={4} className="z-[70] w-72 rounded-lg border border-border bg-elevated p-1 text-[12.5px] shadow-[var(--shadow-panel)]">
          {PATTERN_PRESETS.map((p) => (
            <DM.Item key={p.id} onSelect={() => onPick(p.id)} className="cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-fg/[0.06]">
              <span className="block text-fg">{p.label}</span>
              <span className="block text-[11px] text-muted">{PATTERN_LABEL[p.type]}</span>
            </DM.Item>
          ))}
          <p className="m-0 px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted">Typical shapes to start from, not data for any place. Replace them with factors from your own flow monitoring.</p>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

function PatternEditor({ p, onFactors, onNormalise }: { p: TimePattern; onFactors: (f: string[]) => void; onNormalise: () => void }) {
  const slots = PATTERN_SLOTS[p.type]
  const vals = p.factors.map((v) => Number(v))
  const mean = patternMean(p)
  const finite = vals.filter(Number.isFinite)
  const top = Math.max(2, Math.ceil((Math.max(...finite, 0) * 1.1) / 0.5) * 0.5)
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState(false)
  const W = 720
  const H = 220
  const padL = 34
  const padB = 22
  const bw = (W - padL - 6) / slots.length
  const y = (v: number) => H - padB - (v / top) * (H - padB - 8)
  const setAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * H
    const i = Math.floor((px - padL) / bw)
    if (i < 0 || i >= slots.length) return
    const v = Math.max(0, Math.round((((H - padB - py) / (H - padB - 8)) * top) / 0.05) * 0.05)
    if (Math.abs(v - vals[i]!) < 1e-9) return
    onFactors(p.factors.map((f, j) => (j === i ? trim(v, 2) : f)))
  }
  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Stat label="Average factor" value={fmt(mean)} tone={Math.abs(mean - 1) > 0.02 ? 'warn' : undefined} />
        <Stat label="Lowest" value={fmt(Math.min(...finite))} />
        <Stat label="Highest" value={fmt(Math.max(...finite))} />
        <Stat label="Peak ÷ average" value={mean ? fmt(Math.max(...finite) / mean) : '–'} />
        <Button variant="outline" size="sm" disabled={!mean || Math.abs(mean - 1) < 0.0005} onClick={onNormalise} className="ml-auto">
          <Scale className="h-3.5 w-3.5" /> Make them average 1
        </Button>
      </div>
      {Math.abs(mean - 1) > 0.02 && (
        <p className="m-0 text-[12px] text-warning">
          These factors average {fmt(mean)}, so they change the average flow as well as its shape. Patterns usually average 1, so the node’s average value stays its average.
        </p>
      )}
      <div className="rounded-lg border border-border bg-elevated p-2">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className={cn('block w-full touch-none select-none', drag ? 'cursor-grabbing' : 'cursor-ns-resize')}
          role="img"
          aria-label={`${PATTERN_LABEL[p.type]} factors; drag the bars to change them`}
          onPointerDown={(e) => {
            ;(e.target as Element).setPointerCapture?.(e.pointerId)
            setDrag(true)
            setAt(e)
          }}
          onPointerMove={(e) => drag && setAt(e)}
          onPointerUp={() => setDrag(false)}
          onPointerCancel={() => setDrag(false)}
        >
          {[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].filter((t) => t <= top).map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeDasharray={t === 1 ? undefined : '2 4'} strokeWidth={t === 1 ? 1.2 : 1} />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--color-muted)">
                {t}
              </text>
            </g>
          ))}
          {vals.map((v, i) => (
            <g key={i}>
              <rect x={padL + i * bw + bw * 0.14} width={bw * 0.72} y={Number.isFinite(v) ? y(Math.min(v, top)) : y(0)} height={Number.isFinite(v) ? Math.max(0, y(0) - y(Math.min(v, top))) : 0} rx={2} fill="var(--color-ic-scen)" opacity={0.85} />
              {(slots.length <= 12 || i % 3 === 0) && (
                <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--color-muted)">
                  {slots[i]}
                </text>
              )}
            </g>
          ))}
          <text x={W - 6} y={y(1) - 4} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            average flow
          </text>
        </svg>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${slots.length > 12 ? 12 : slots.length}, minmax(0, 1fr))` }}>
        {slots.map((s, i) => (
          <label key={i} className="min-w-0">
            <span className="block text-center text-[10.5px] text-muted">{p.type === 'HOURLY' || p.type === 'WEEKEND' ? `${s}:00` : s}</span>
            <input
              value={p.factors[i] ?? ''}
              onChange={(e) => onFactors(p.factors.map((f, j) => (j === i ? e.target.value : f)))}
              aria-label={`Factor for ${s}`}
              inputMode="decimal"
              className={cn('field h-7 w-full px-1 text-center text-[12px] tabular-nums', !Number.isFinite(Number(p.factors[i])) && 'border-danger')}
            />
          </label>
        ))}
      </div>
      <p className="m-0 text-[12px] text-muted">
        {p.type === 'HOURLY' && 'Each hour’s flow is the average × its factor. When the node also has a weekend pattern, this one is for Monday to Friday.'}
        {p.type === 'WEEKEND' && 'Used instead of the hourly pattern on Saturdays and Sundays.'}
        {p.type === 'DAILY' && 'One factor for each day of the week, starting on Sunday as SWMM does.'}
        {p.type === 'MONTHLY' && 'One factor for each month. Monthly patterns can also adjust subcatchment roughness, depression storage and infiltration.'}
      </p>
    </div>
  )
}
