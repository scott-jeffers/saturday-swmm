import { useEffect, useRef, useState } from 'react'
import {
  Circle,
  Grid2x2,
  Hexagon,
  Maximize2,
  MousePointer2,
  Pentagon,
  Spline,
  Trash2,
  Triangle,
  Undo2,
} from 'lucide-react'
import { IconButton, Tooltip } from '../ui'
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

const tools: Array<{ mode: DrawMode; label: string; icon: typeof MousePointer2 }> = [
  { mode: 'select', label: 'Select', icon: MousePointer2 },
  { mode: 'add-junction', label: 'Add junction', icon: Circle },
  { mode: 'add-outfall', label: 'Add outfall', icon: Triangle },
  { mode: 'add-storage', label: 'Add storage', icon: Hexagon },
  { mode: 'add-conduit', label: 'Add link', icon: Spline },
  { mode: 'add-subcatchment', label: 'Add subcatchment', icon: Pentagon },
  { mode: 'draw-mesh-aoi', label: 'Draw 2D mesh AOI', icon: Grid2x2 },
  { mode: 'delete', label: 'Delete', icon: Trash2 },
]

export function MapToolbar({
  mode,
  onModeChange,
  linkKind = 'conduit',
  onLinkKindChange,
  hint,
  onZoomExtent,
  onUndo,
  canUndo,
}: {
  mode: DrawMode
  onModeChange: (mode: DrawMode) => void
  linkKind?: LinkDrawKind
  onLinkKindChange?: (kind: LinkDrawKind) => void
  hint?: string
  onZoomExtent?: () => void
  onUndo?: () => void
  canUndo?: boolean
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

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-border bg-elevated/95 p-1.5 shadow-[var(--shadow-panel)] backdrop-blur">
        {tools.map(({ mode: m, label, icon: Icon }) => {
          if (m === 'add-conduit') {
            const active = mode === m
            const kindLabel =
              LINK_KIND_OPTIONS.find((o) => o.value === linkKind)?.label ?? 'Link'
            return (
              <div key={m} className="relative" ref={linkMenuRef}>
                <Tooltip content={`Add ${kindLabel.toLowerCase()}`}>
                  <IconButton
                    label={`Add ${kindLabel.toLowerCase()}`}
                    variant={active ? 'primary' : 'ghost'}
                    active={active}
                    onClick={() => {
                      if (active) {
                        setLinkMenuOpen((o) => !o)
                      } else {
                        onModeChange(m)
                        setLinkMenuOpen(true)
                      }
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </IconButton>
                </Tooltip>
                {linkMenuOpen && (
                  <div className="absolute left-1/2 top-full z-30 mt-2 min-w-[8.5rem] -translate-x-1/2 rounded-xl border border-border bg-elevated py-1 shadow-[var(--shadow-panel)]">
                    {LINK_KIND_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={cn(
                          'block w-full px-3 py-1.5 text-left text-sm hover:bg-border/40',
                          opt.value === linkKind && 'bg-accent/15 text-accent-soft',
                        )}
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
              <IconButton
                label={label}
                variant={mode === m ? 'primary' : 'ghost'}
                active={mode === m}
                onClick={() => onModeChange(m)}
                className={cn(m === 'delete' && mode === m && 'bg-danger-bg border-danger/50')}
              >
                <Icon className="h-4 w-4" />
              </IconButton>
            </Tooltip>
          )
        })}
        {(onZoomExtent || onUndo) && (
          <>
            <div className="mx-0.5 h-6 w-px bg-border" />
            {onUndo && (
              <Tooltip content="Undo (Ctrl+Z)">
                <IconButton
                  label="Undo"
                  variant="ghost"
                  onClick={onUndo}
                  disabled={!canUndo}
                >
                  <Undo2 className="h-4 w-4" />
                </IconButton>
              </Tooltip>
            )}
            {onZoomExtent && (
              <Tooltip content="Zoom to extent">
                <IconButton label="Zoom to extent" variant="ghost" onClick={onZoomExtent}>
                  <Maximize2 className="h-4 w-4" />
                </IconButton>
              </Tooltip>
            )}
          </>
        )}
      </div>
      {hint && (
        <div className="rounded-lg border border-border bg-elevated/90 px-2.5 py-1 text-xs text-muted shadow">
          {hint}
        </div>
      )}
    </div>
  )
}
