import { ChevronRight, Eye, EyeOff, Layers, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  isStyled,
  STYLE_SWATCHES,
  styleColor,
  styleOpacity,
  styleSize,
  type ElementStyle,
  type MapStyle,
  type StyleKey,
} from '../../lib/mapStyle'
import { Switch } from '../ui'
import type { BasemapMode } from './MapCanvas'

/** Little painted previews, so the choice reads at a glance without loading tiles. */
const BACKGROUNDS: { mode: BasemapMode; label: string; swatch: CSSProperties }[] = [
  {
    mode: 'osm',
    label: 'Streets',
    swatch: {
      background:
        'linear-gradient(115deg, transparent 44%, #f6d27a 44% 50%, transparent 50%), linear-gradient(20deg, transparent 58%, #fff 58% 64%, transparent 64%), linear-gradient(160deg, #cfe3c4 0 30%, #eeeae2 30%)',
    },
  },
  {
    mode: 'light',
    label: 'Light',
    swatch: {
      background:
        'linear-gradient(115deg, transparent 45%, #fff 45% 51%, transparent 51%), linear-gradient(25deg, transparent 60%, #fff 60% 64%, transparent 64%), #e7e8e4',
    },
  },
  {
    mode: 'dark',
    label: 'Dark',
    swatch: {
      background:
        'linear-gradient(115deg, transparent 45%, #3a3d45 45% 51%, transparent 51%), linear-gradient(25deg, transparent 60%, #2c2f36 60% 64%, transparent 64%), #16171b',
    },
  },
  {
    mode: 'hybrid',
    label: 'Satellite',
    swatch: {
      background:
        'radial-gradient(circle at 25% 30%, #5d7a3f 0 22%, transparent 23%), radial-gradient(circle at 75% 70%, #3f5a2d 0 26%, transparent 27%), linear-gradient(115deg, transparent 46%, #b9ad94 46% 50%, transparent 50%), #6b6a4c',
    },
  },
  {
    mode: 'projected',
    label: 'None',
    swatch: {
      background:
        'linear-gradient(#ffffff14 1px, transparent 1px) 0 0 / 10px 10px, linear-gradient(90deg, #ffffff14 1px, transparent 1px) 0 0 / 10px 10px, #0b1220',
    },
  },
  { mode: 'custom', label: 'Custom', swatch: {} },
]

type Row = { key: StyleKey; label: string; shape: 'dot' | 'tri' | 'sq' | 'line' | 'area' }
const ROWS: Row[] = [
  { key: 'junction', label: 'Junctions', shape: 'dot' },
  { key: 'outfall', label: 'Outfalls', shape: 'tri' },
  { key: 'storage', label: 'Storage', shape: 'sq' },
  { key: 'conduit', label: 'Conduits', shape: 'line' },
  { key: 'pump', label: 'Pumps', shape: 'line' },
  { key: 'orifice', label: 'Orifices', shape: 'line' },
  { key: 'weir', label: 'Weirs', shape: 'line' },
  { key: 'outlet', label: 'Outlets', shape: 'line' },
  { key: 'subcatchment', label: 'Subcatchments', shape: 'area' },
]

function Glyph({ shape, color, opacity }: { shape: Row['shape']; color: string; opacity: number }) {
  const s = { opacity: Math.max(0.25, opacity) }
  if (shape === 'dot') return <span className="h-2.5 w-2.5 rounded-full ring-1 ring-black/70" style={{ ...s, background: color }} />
  if (shape === 'sq') return <span className="h-2.5 w-2.5 rounded-[1px] ring-1 ring-black/70" style={{ ...s, background: color }} />
  if (shape === 'tri')
    return <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent" style={{ ...s, borderBottomColor: color }} />
  if (shape === 'area') return <span className="h-2.5 w-3.5 rounded-[2px] border" style={{ ...s, background: `${color}55`, borderColor: color }} />
  return <span className="h-[3px] w-3.5 rounded-full" style={{ ...s, background: color }} />
}

export type LayersButtonProps = {
  basemap: BasemapMode
  onBasemap: (b: BasemapMode) => void
  customTiles: string
  onCustomTiles: (url: string) => void
  /** Basemaps that need a world position are pointless without a CRS. */
  hasCrs: boolean
  visible: Record<StyleKey, boolean>
  counts: Partial<Record<StyleKey, number>>
  onToggle: (key: StyleKey) => void
  style: MapStyle
  onStyle: (key: StyleKey, patch: ElementStyle | null) => void
  showLabels: boolean
  onShowLabels: (v: boolean) => void
  show3DBuildings: boolean
  onShow3DBuildings: (v: boolean) => void
  /** In results mode the colours are the results, so colour picking is off. */
  resultsMode: boolean
  /** The 2D surface, when the model has a mesh. */
  surface?: {
    triangles: number
    mesh: boolean
    onMesh: (v: boolean) => void
    depth: boolean
    onDepth: (v: boolean) => void
    hasResults: boolean
    opacity: number
    onOpacity: (v: number) => void
    /** Open mesh edges and their boundary conditions. */
    boundaries?: boolean
    onBoundaries?: (v: boolean) => void
  } | null
  /** HAND floodplain polygons from a DEM flow-accumulation run (app only). */
  floodplain?: { on: boolean; onToggle: (v: boolean) => void; available: boolean; note?: string } | null
  /** Background GIS layers (DEMs and vector files), shown at the bottom. */
  gis?: ReactNode
  /** Drawn as a toolbar button (the map's tab bar) instead of over the map. */
  toolbar?: boolean
  /** Toolbar: show the label only on wide screens. */
  compact?: boolean
}

export function LayersButton(p: LayersButtonProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<StyleKey | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const t = e.target as Element
      // A dialog opened from inside (e.g. a GIS layer's CRS question) is not "outside".
      if (t.closest?.('[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]') && !root.current?.contains(t)) return
      if (root.current && !root.current.contains(t)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const rows = ROWS.filter((r) => (p.counts[r.key] ?? 0) > 0)

  return (
    <div ref={root} className="pointer-events-auto relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Layers"
        title="Layers: background, visibility and style"
        onClick={() => setOpen((v) => !v)}
        className={
          p.toolbar
            ? cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors',
                open ? 'bg-accent/15 font-medium text-accent-soft' : 'text-fg-soft hover:bg-fg/[0.06] hover:text-fg',
              )
            : cn(
                'inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium shadow-[var(--shadow-panel)] backdrop-blur transition-colors',
                open ? 'border-accent/60 bg-elevated text-fg' : 'border-border bg-elevated/95 text-fg-soft hover:text-fg',
              )
        }
      >
        <Layers className={p.toolbar ? 'h-3.5 w-3.5' : 'h-4 w-4 text-ic-land'} />
        {p.toolbar ? <span className={p.compact ? 'hidden 2xl:inline' : 'hidden lg:inline'}>Layers</span> : 'Layers'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Layers"
          className={cn(
            'absolute right-0 z-40 flex max-h-[min(680px,calc(100vh-10rem))] w-[300px] flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-panel)]',
            p.toolbar ? 'top-9' : 'top-11',
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <h3 className="m-0 mb-2 text-[12px] font-semibold text-fg">Background</h3>
            <div className="grid grid-cols-3 gap-2">
              {BACKGROUNDS.map((b) => {
                const disabled = !p.hasCrs && b.mode !== 'projected' && b.mode !== 'custom'
                const on = p.basemap === b.mode
                return (
                  <button
                    key={b.mode}
                    type="button"
                    disabled={disabled}
                    title={disabled ? 'Set the coordinate system first' : b.label}
                    onClick={() => p.onBasemap(b.mode)}
                    className="group flex flex-col items-center gap-1 disabled:opacity-40"
                  >
                    <span
                      className={cn(
                        'block h-11 w-full rounded-md ring-1 ring-border transition',
                        on ? 'ring-2 ring-accent' : 'group-hover:ring-border-strong',
                        b.mode === 'custom' && 'border border-dashed border-border-strong bg-fg/[0.03] ring-0',
                      )}
                      style={b.swatch}
                    >
                      {b.mode === 'custom' && <span className="flex h-full items-center justify-center text-[15px] text-muted">+</span>}
                    </span>
                    <span className={cn('text-[11px]', on ? 'font-medium text-fg' : 'text-muted')}>{b.label}</span>
                  </button>
                )
              })}
            </div>
            {p.basemap === 'custom' && (
              <input
                className="field mt-2 h-7 w-full font-mono text-[11px]"
                aria-label="Custom tile URL"
                defaultValue={p.customTiles}
                placeholder="https://tile.example.com/{z}/{x}/{y}.png"
                onBlur={(e) => p.onCustomTiles(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && p.onCustomTiles((e.target as HTMLInputElement).value.trim())}
              />
            )}

            <h3 className="m-0 mb-1 mt-4 text-[12px] font-semibold text-fg">Elements</h3>
            <ul className="m-0 list-none p-0">
              {rows.map((r) => {
                const vis = p.visible[r.key]
                const st = p.style[r.key]
                const isOpen = expanded === r.key
                const color = styleColor(p.style, r.key)
                return (
                  <li key={r.key} className="rounded-md">
                    <div className="flex h-8 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`${vis ? 'Hide' : 'Show'} ${r.label}`}
                        aria-pressed={vis}
                        onClick={() => p.onToggle(r.key)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-fg/[0.06] hover:text-fg"
                      >
                        {vis ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : r.key)}
                        className={cn('flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-[12px] hover:bg-fg/[0.06]', !vis && 'opacity-50')}
                      >
                        <span className="flex w-4 justify-center">
                          <Glyph shape={r.shape} color={color} opacity={styleOpacity(p.style, r.key)} />
                        </span>
                        <span className="flex-1 truncate text-fg-soft">{r.label}</span>
                        {isStyled(st) && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Styled" />}
                        <span className="text-[10px] tabular-nums text-muted">{(p.counts[r.key] ?? 0).toLocaleString('en-US')}</span>
                        <ChevronRight className={cn('h-3.5 w-3.5 text-muted transition-transform', isOpen && 'rotate-90')} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="mb-2 ml-8 mr-1 space-y-2.5 rounded-lg bg-fg/[0.035] p-2.5">
                        <Slider
                          label={r.shape === 'area' ? 'Outline' : 'Size'}
                          min={0.4}
                          max={2.5}
                          step={0.1}
                          value={styleSize(p.style, r.key)}
                          format={(v) => `${Math.round(v * 100)}%`}
                          onChange={(v) => p.onStyle(r.key, { size: Math.abs(v - 1) < 0.001 ? undefined : v })}
                        />
                        <Slider
                          label="Opacity"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={styleOpacity(p.style, r.key)}
                          format={(v) => `${Math.round(v * 100)}%`}
                          onChange={(v) => p.onStyle(r.key, { opacity: v >= 0.999 ? undefined : v })}
                        />
                        <div>
                          <div className="mb-1 text-[11px] text-muted">
                            Colour{p.resultsMode && r.key !== 'storage' && r.key !== 'outfall' ? ' (shows results here; applies in Edit)' : ''}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {STYLE_SWATCHES.map((c) => (
                              <button
                                key={c}
                                type="button"
                                aria-label={`Colour ${c}`}
                                onClick={() => p.onStyle(r.key, { color: c })}
                                className={cn('h-5 w-5 rounded-full ring-1 ring-black/20 transition-transform hover:scale-110', color === c && 'ring-2 ring-accent ring-offset-1 ring-offset-elevated')}
                                style={{ background: c }}
                              />
                            ))}
                          </div>
                        </div>
                        {isStyled(st) && (
                          <button type="button" onClick={() => p.onStyle(r.key, null)} className="inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline">
                            <RotateCcw className="h-3 w-3" /> Reset {r.label.toLowerCase()}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
              {p.surface && (() => {
                const sf = p.surface
                const vis = sf.mesh || sf.depth
                const isOpen = expanded === ('surface' as StyleKey)
                return (
                  <li className="rounded-md">
                    <div className="flex h-8 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`${vis ? 'Hide' : 'Show'} 2D surface`}
                        aria-pressed={vis}
                        onClick={() => {
                          if (vis) {
                            sf.onMesh(false)
                            sf.onDepth(false)
                          } else {
                            sf.onMesh(true)
                            if (sf.hasResults) sf.onDepth(true)
                          }
                        }}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-fg/[0.06] hover:text-fg"
                      >
                        {vis ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : ('surface' as StyleKey))}
                        className={cn('flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-[12px] hover:bg-fg/[0.06]', !vis && 'opacity-50')}
                      >
                        <span className="flex w-4 justify-center">
                          <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: 'linear-gradient(90deg,#38bdf8,#22c55e,#facc15,#ef4444)', opacity: Math.max(0.3, sf.opacity) }} />
                        </span>
                        <span className="flex-1 truncate text-fg-soft">2D surface</span>
                        <span className="text-[10px] tabular-nums text-muted">{sf.triangles.toLocaleString('en-US')}</span>
                        <ChevronRight className={cn('h-3.5 w-3.5 text-muted transition-transform', isOpen && 'rotate-90')} />
                      </button>
                    </div>
                    {isOpen && (
                      <div className="mb-2 ml-8 mr-1 space-y-2.5 rounded-lg bg-fg/[0.035] p-2.5">
                        <Slider label="Opacity" min={0.1} max={1} step={0.05} value={sf.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={sf.onOpacity} />
                        <label className="flex items-center justify-between gap-2 text-[12px] text-fg-soft">
                          Mesh outline
                          <Switch checked={sf.mesh} onCheckedChange={sf.onMesh} />
                        </label>
                        <label className={cn('flex items-center justify-between gap-2 text-[12px] text-fg-soft', !sf.hasResults && 'opacity-50')}>
                          Flood depth
                          <Switch checked={sf.depth && sf.hasResults} disabled={!sf.hasResults} onCheckedChange={sf.onDepth} />
                        </label>
                        {!sf.hasResults && <p className="m-0 text-[11px] text-muted">Depths show after a 2D run, in Results.</p>}
                        {sf.onBoundaries && (
                          <label className="flex items-center justify-between gap-2 text-[12px] text-fg-soft" title="Open mesh edges and their boundary conditions; click an edge to edit it">
                            Boundaries
                            <Switch checked={Boolean(sf.boundaries)} onCheckedChange={sf.onBoundaries} />
                          </label>
                        )}
                      </div>
                    )}
                  </li>
                )
              })()}
            </ul>

            <h3 className="m-0 mb-1 mt-4 text-[12px] font-semibold text-fg">On the map</h3>
            <label className="flex h-8 items-center justify-between gap-2 text-[12px] text-fg-soft">
              <span>
                ID labels <span className="text-[11px] text-muted">· when zoomed in</span>
              </span>
              <Switch checked={p.showLabels} onCheckedChange={p.onShowLabels} />
            </label>
            <label className={cn('flex h-8 items-center justify-between gap-2 text-[12px] text-fg-soft', !p.hasCrs && 'opacity-50')}>
              <span>
                3D buildings <span className="text-[11px] text-muted">· tilt to see</span>
              </span>
              <Switch checked={p.show3DBuildings} disabled={!p.hasCrs} onCheckedChange={p.onShow3DBuildings} />
            </label>
            {p.floodplain && (
              <label
                className={cn('flex h-8 items-center justify-between gap-2 text-[12px] text-fg-soft', !p.floodplain.available && 'opacity-50')}
                title={p.floodplain.available ? 'HAND floodplain polygons from the DEM flow-accumulation run' : 'Run with the DEM flow-accumulation engine to make these'}
              >
                <span>
                  Floodplain {p.floodplain.note && <span className="text-[11px] text-muted">· {p.floodplain.note}</span>}
                </span>
                <Switch checked={p.floodplain.on && p.floodplain.available} disabled={!p.floodplain.available} onCheckedChange={p.floodplain.onToggle} />
              </label>
            )}
            {p.gis && <div className="mt-3">{p.gis}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-0.5 flex justify-between text-[11px] text-muted">
        {label}
        <span className="tabular-nums text-fg-soft">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-[var(--color-accent)]"
      />
    </label>
  )
}
