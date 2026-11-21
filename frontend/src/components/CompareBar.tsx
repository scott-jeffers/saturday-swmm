/**
 * "Compare with …" in the workspace's view row: pick another scenario (or
 * result set) once, and the map, Graphs and Profile all show both. While
 * comparing, the map can show this run, the other one, or the change.
 */
import { ArrowLeftRight, ChevronDown, GitCompareArrows, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CompareTarget } from '../api/client'
import { cn } from '../lib/cn'
import type { CompareMapMode } from '../lib/compare'
import { MapContextMenu, type MenuItem } from './map/MapContextMenu'

export function CompareBar({
  current,
  target,
  targets,
  onTarget,
  onSwap,
  mapMode,
  onMapMode,
  showMapModes,
  canSwap,
}: {
  current: { label: string } | null
  target: CompareTarget | null
  targets: CompareTarget[]
  onTarget: (id: string | null) => void
  onSwap: () => void
  mapMode: CompareMapMode
  onMapMode: (m: CompareMapMode) => void
  showMapModes: boolean
  canSwap: boolean
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  if (!targets.length) return null

  const open = () => {
    const r = btn.current?.getBoundingClientRect()
    if (r) setMenu({ x: r.left, y: r.bottom + 4 })
  }
  const ready = targets.filter((t) => t.has_results)
  // One obvious choice (e.g. the other scenario): one click compares.
  const only = ready.length === 1 && targets.filter((t) => t.kind === 'scenario').length <= 1 ? ready[0] : null
  const scen = targets.filter((t) => t.kind === 'scenario')
  const runs = targets.filter((t) => t.kind === 'run')
  const item = (t: CompareTarget): MenuItem => ({
    label: t.label + (t.id === target?.id ? '  ✓' : ''),
    hint: t.has_results ? undefined : 'not run yet',
    disabled: !t.has_results,
    onSelect: () => onTarget(t.id),
  })
  const items: MenuItem[] = [
    ...(scen.length ? [{ kind: 'header' as const, label: 'Scenarios' }, ...scen.map(item)] : []),
    ...(runs.length ? [{ kind: 'header' as const, label: scen.length ? 'Earlier runs' : 'Results' }, ...runs.slice(0, 12).map(item)] : []),
    ...(target ? [{ kind: 'separator' as const }, { label: 'Stop comparing', onSelect: () => onTarget(null) }] : []),
  ]

  return (
    <div className="ml-auto flex h-8 min-w-0 items-center gap-1.5 self-center pl-2">
      {!target ? (
        <button
          ref={btn}
          type="button"
          onClick={() => (only ? onTarget(only.id) : open())}
          className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-border px-2 text-[12px] text-fg-soft hover:bg-fg/[0.05] hover:text-fg"
          title="Show another scenario next to this one on the map, in Graphs and in the profile"
        >
          <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-ic-scen" />
          <span className="truncate max-md:hidden">{only ? `Compare with ${only.label}` : 'Compare'}</span>
          {!only && <ChevronDown className="h-3 w-3 text-muted" />}
        </button>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1 rounded-md border border-ic-scen/40 bg-ic-scen/[0.07] py-0.5 pl-2 pr-0.5 text-[12px]">
            <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-ic-scen" aria-hidden />
            <span className="inline-flex min-w-0 items-center gap-1 text-fg" title="Solid lines">
              <span className="inline-block h-0.5 w-3.5 shrink-0 rounded bg-fg" aria-hidden />
              <span className="max-w-[9rem] truncate font-medium">{current?.label ?? 'This run'}</span>
            </span>
            <span className="px-0.5 text-muted">vs</span>
            <button
              ref={btn}
              type="button"
              onClick={open}
              className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-fg hover:bg-fg/[0.06]"
              title="Dashed lines; click to compare with something else"
            >
              <span className="inline-block w-3.5 shrink-0 border-t-2 border-dashed border-ic-scen" aria-hidden />
              <span className="max-w-[11rem] truncate font-medium">{target.label}</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
            </button>
            {canSwap && (
              <button type="button" onClick={onSwap} className="rounded p-1 text-muted hover:bg-fg/[0.06] hover:text-fg" title={`Make ${target.label} the current one`} aria-label="Swap">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" onClick={() => onTarget(null)} className="rounded p-1 text-muted hover:bg-fg/[0.06] hover:text-fg" title="Stop comparing" aria-label="Stop comparing">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {showMapModes && (
            <div className="inline-flex shrink-0 rounded-md border border-border p-0.5" role="group" aria-label="Map shows">
              {(
                [
                  ['current', current?.label ?? 'This run', 'Colour the map by this run'],
                  ['other', target.label, `Colour the map by ${target.label}`],
                  ['change', 'Change', `Blue where ${current?.label ?? 'this run'} is lower than ${target.label}, red where it is higher`],
                ] as const
              ).map(([k, label, title]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={mapMode === k}
                  title={title}
                  onClick={() => onMapMode(k)}
                  className={cn(
                    'h-6 max-w-[8rem] truncate rounded px-2 text-[11.5px]',
                    mapMode === k ? 'bg-fg/[0.09] font-medium text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {menu && <MapContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** Legend for the map's "Change" view. */
export function ChangeLegend({
  currentLabel,
  otherLabel,
  depthMax,
  flowMax,
  units,
  peaks = false,
}: {
  peaks?: boolean
  currentLabel: string
  otherLabel: string
  depthMax: number
  flowMax: number
  units: { len: string; flow: string }
}) {
  const bar = 'linear-gradient(90deg, #1d4ed8, #7fb0f5 35%, #c3c8d0 50%, #f4a07f 65%, #c2261a)'
  const f = (v: number) => (v >= 10 ? v.toFixed(1) : v.toPrecision(2))
  const row = (title: string, max: number) => (
    <div>
      <p className="m-0 mb-1 text-fg-soft">{title}</p>
      <div className="h-2 rounded-full" style={{ background: bar }} />
      <div className="mt-0.5 flex justify-between tabular-nums text-[10.5px] text-muted">
        <span>−{f(max)}</span>
        <span>0</span>
        <span>+{f(max)}</span>
      </div>
    </div>
  )
  return (
    <div className="map-overlay absolute bottom-3 right-3 z-10 w-60 space-y-2.5 p-3 text-xs">
      <p className="m-0 font-medium text-fg">
        {peaks ? 'Change in peaks' : 'Change'}: {currentLabel} − {otherLabel}
      </p>
      {row(`Node depth (${units.len})`, depthMax)}
      {row(`Link flow (${units.flow})`, flowMax)}
      <p className="m-0 flex justify-between text-[11px] text-muted">
        <span>lower</span>
        <span>same</span>
        <span>higher</span>
      </p>
    </div>
  )
}
