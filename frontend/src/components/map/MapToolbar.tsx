import { ELEMENT_COLOR } from '../../lib/elementColors'
import { useEffect, useRef, useState } from 'react'
import {
  Circle,
  Grid2x2,
  Hexagon,
  ChevronDown,
  Maximize2,
  MousePointer2,
  Pentagon,
  Spline,
  Trash2,
  Triangle,
} from 'lucide-react'
import { Tooltip } from '../ui'
import { cn } from '../../lib/cn'

export type DrawMode =
  | 'select'
  | 'add-junction'
  | 'add-outfall'
  | 'add-storage'
  | 'add-conduit'
  | 'add-subcatchment'
  | 'draw-mesh-aoi'
  | 'delete'

export type LinkDrawKind = 'conduit' | 'pump' | 'orifice' | 'weir' | 'outlet'

const LINK_KIND_OPTIONS: Array<{ value: LinkDrawKind; label: string }> = [
  { value: 'conduit', label: 'Conduit' },
  { value: 'weir', label: 'Weir' },
  { value: 'orifice', label: 'Orifice' },
  { value: 'outlet', label: 'Outlet' },
  { value: 'pump', label: 'Pump' },
]

// Tool icons wear the colour the element has on the map and in the legend.
const tools: Array<{ mode: DrawMode; label: string; icon: typeof MousePointer2; color?: string }> = [
  { mode: 'select', label: 'Select', icon: MousePointer2 },
  { mode: 'add-junction', label: 'Junction', icon: Circle, color: ELEMENT_COLOR.junction },
  { mode: 'add-outfall', label: 'Outfall', icon: Triangle, color: ELEMENT_COLOR.outfall },
  { mode: 'add-storage', label: 'Storage', icon: Hexagon, color: ELEMENT_COLOR.storage },
  { mode: 'add-conduit', label: 'Link', icon: Spline, color: ELEMENT_COLOR.conduit },
  { mode: 'add-subcatchment', label: 'Subcatchment', icon: Pentagon, color: ELEMENT_COLOR.subcatchment },
  { mode: 'draw-mesh-aoi', label: '2D area', icon: Grid2x2, color: ELEMENT_COLOR.mesh },
  { mode: 'delete', label: 'Delete', icon: Trash2 },
]

/** One-key shortcuts in Edit mode (the map page listens for them). */
export const SHORTCUT: Record<DrawMode, string> = {
  select: 'V',
  'add-junction': 'J',
  'add-outfall': 'O',
  'add-storage': 'S',
  'add-conduit': 'L',
  'add-subcatchment': 'A',
  'draw-mesh-aoi': 'M',
  delete: 'D',
} as Record<DrawMode, string>
const TIP: Partial<Record<DrawMode, string>> = {
  select: 'Select and move',
  'add-junction': 'Add junctions: click the map',
  'add-outfall': 'Add outfalls: click the map',
  'add-storage': 'Add storage units: click the map',
  'add-subcatchment': 'Draw a subcatchment: click its corners, Enter to finish',
  'draw-mesh-aoi': 'Draw the 2D area: click its corners, Enter to finish',
  delete: 'Delete: click an element',
}

export function MapToolbar({
  mode,
  onModeChange,
  linkKind = 'conduit',
  onLinkKindChange,
  onZoomExtent,
  dock = false,
}: {
  mode: DrawMode
  onModeChange: (mode: DrawMode) => void
  linkKind?: LinkDrawKind
  onLinkKindChange?: (kind: LinkDrawKind) => void
  /** Shown by the map page under the tab bar. */
  hint?: string
  onZoomExtent?: () => void
  /** A floating dock over the map: tools with their names under them, grouped. */
  dock?: boolean
}) {
  const [linkMenuOpen, setLinkMenuOpen] = useState(false)
  const linkMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!linkMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!linkMenuRef.current?.contains(e.target as Node)) {
        setLinkMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [linkMenuOpen])

  useEffect(() => {
    if (mode !== 'add-conduit') setLinkMenuOpen(false)
  }, [mode])

  const btn = (active: boolean) =>
    cn(
      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors',
      active ? 'bg-accent/15 font-medium text-accent-soft' : 'text-fg-soft hover:bg-fg/[0.06] hover:text-fg',
    )
  if (dock) {
    const GROUP_END = new Set<DrawMode>(['select', 'add-storage', 'add-conduit', 'draw-mesh-aoi'])
    const kindLabel = LINK_KIND_OPTIONS.find((o) => o.value === linkKind)?.label ?? 'Link'
    return (
      <div
        className="pointer-events-auto flex items-stretch gap-0.5 rounded-2xl border border-border bg-elevated/95 p-1 shadow-[var(--shadow-panel)] backdrop-blur"
        role="toolbar"
        aria-label="Draw and edit"
      >
        {tools.map(({ mode: m, label, icon: Icon, color }) => {
          const active = mode === m
          const name = m === 'add-conduit' ? kindLabel : label
          const key = SHORTCUT[m]
          const button = (
            <button
              type="button"
              aria-pressed={active}
              aria-label={name}
              className={cn(
                'relative flex h-12 w-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none transition-colors max-sm:h-10 max-sm:w-9',
                active ? 'bg-accent/15 font-medium text-accent-soft' : 'text-fg-soft hover:bg-fg/[0.06] hover:text-fg',
              )}
              onClick={() => {
                if (m === 'add-conduit') {
                  if (active) setLinkMenuOpen((o) => !o)
                  else {
                    onModeChange(m)
                    setLinkMenuOpen(true)
                  }
                } else onModeChange(m)
              }}
            >
              <Icon className={cn('h-[18px] w-[18px]', m === 'delete' && !active && 'text-danger/80')} style={color ? { color } : undefined} />
              <span className="flex items-center gap-0.5 max-sm:hidden">
                {name}
                {m === 'add-conduit' && <ChevronDown className="h-2.5 w-2.5 opacity-60" />}
              </span>
            </button>
          )
          return (
            <div key={m} className="contents">
              {m === 'add-conduit' ? (
                <div className="relative" ref={linkMenuRef}>
                  <Tooltip content={`Draw a ${kindLabel.toLowerCase()} between two nodes (${key})`}>{button}</Tooltip>
                  {linkMenuOpen && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[8.5rem] rounded-lg border border-border bg-elevated py-1 shadow-[var(--shadow-panel)]">
                      {LINK_KIND_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={cn('block w-full px-3 py-1.5 text-left text-[13px] hover:bg-fg/5', opt.value === linkKind && 'text-accent-soft')}
                          onClick={() => {
                            onLinkKindChange?.(opt.value)
                            onModeChange('add-conduit')
                            setLinkMenuOpen(false)
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Tooltip content={`${TIP[m] ?? label} (${key})`}>{button}</Tooltip>
              )}
              {GROUP_END.has(m) && <span className="mx-1 my-2 w-px bg-border max-sm:mx-0.5" aria-hidden />}
            </div>
          )
        })}
      </div>
    )
  }

  // Docked in the map's tab bar: labelled tools (labels hide on narrow screens; tooltips remain).
  return (
    <div className="flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Edit tools">
      {tools.map(({ mode: m, label, icon: Icon, color }) => {
        const active = mode === m
        if (m === 'add-conduit') {
          const kindLabel = LINK_KIND_OPTIONS.find((o) => o.value === linkKind)?.label ?? 'Link'
          return (
            <div key={m} className="relative" ref={linkMenuRef}>
              <Tooltip content={`Draw a ${kindLabel.toLowerCase()} between two nodes`}>
                <button
                  type="button"
                  aria-pressed={active}
                  className={btn(active)}
                  onClick={() => {
                    if (active) setLinkMenuOpen((o) => !o)
                    else {
                      onModeChange(m)
                      setLinkMenuOpen(true)
                    }
                  }}
                >
                  <Icon className="h-3.5 w-3.5" style={color ? { color } : undefined} />
                  <span className="hidden xl:inline">{kindLabel}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </Tooltip>
              {linkMenuOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[8.5rem] rounded-lg border border-border bg-elevated py-1 shadow-[var(--shadow-panel)]">
                  {LINK_KIND_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn('block w-full px-3 py-1.5 text-left text-[13px] hover:bg-fg/5', opt.value === linkKind && 'text-accent-soft')}
                      onClick={() => {
                        onLinkKindChange?.(opt.value)
                        onModeChange('add-conduit')
                        setLinkMenuOpen(false)
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        }
        return (
          <Tooltip key={m} content={label}>
            <button type="button" aria-pressed={active} aria-label={label} className={btn(active)} onClick={() => onModeChange(m)}>
              <Icon className={cn('h-3.5 w-3.5', m === 'delete' && !active && 'text-danger/80')} style={color ? { color } : undefined} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          </Tooltip>
        )
      })}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      {onZoomExtent && (
        <Tooltip content="Zoom to the whole network">
          <button type="button" aria-label="Zoom to extent" className={btn(false)} onClick={onZoomExtent}>
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
