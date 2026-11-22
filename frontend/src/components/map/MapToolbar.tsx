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

export function MapToolbar({
  mode,
  onModeChange,
  linkKind = 'conduit',
  onLinkKindChange,
  onZoomExtent,
}: {
  mode: DrawMode
  onModeChange: (mode: DrawMode) => void
  linkKind?: LinkDrawKind
  onLinkKindChange?: (kind: LinkDrawKind) => void
  /** Shown by the map page under the tab bar. */
  hint?: string
  onZoomExtent?: () => void
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
