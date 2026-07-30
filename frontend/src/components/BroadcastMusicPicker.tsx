import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Music, X } from 'lucide-react'
import { listStationsByCategory } from '../lib/broadcastStations'
import { cn } from '../lib/cn'

const VIEWPORT_INSET = 12
const MOBILE_BREAKPOINT = 640
const DESKTOP_PANEL_MAX = 320

type PickerLayout = {
  top: number
  left: number
  right?: number
  width?: number
  maxHeight: number
}

function useFixedPickerLayout(
  anchorRef: React.RefObject<HTMLElement | null> | undefined,
  enabled: boolean,
) {
  const [layout, setLayout] = useState<PickerLayout | null>(null)

  useLayoutEffect(() => {
    if (!enabled || !anchorRef?.current) {
      setLayout(null)
      return
    }

    function measure() {
      const anchor = anchorRef?.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const top = rect.bottom + 6
      const maxHeight = Math.max(160, window.innerHeight - top - VIEWPORT_INSET - 8)
      const vw = window.innerWidth

      if (vw < MOBILE_BREAKPOINT) {
        setLayout({
          top,
          left: VIEWPORT_INSET,
          right: VIEWPORT_INSET,
          maxHeight,
        })
        return
      }

      const panelWidth = Math.min(DESKTOP_PANEL_MAX, vw - VIEWPORT_INSET * 2)
      let left = rect.right - panelWidth
      left = Math.max(VIEWPORT_INSET, left)
      if (left + panelWidth > vw - VIEWPORT_INSET) {
        left = vw - VIEWPORT_INSET - panelWidth
      }

      setLayout({ top, left, width: panelWidth, maxHeight })
    }

    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef, enabled])

  return layout
}

export function BroadcastMusicPicker({
  stationId,
  stationShortLabel,
  onSelect,
  onClose,
  anchorRef,
}: {
  stationId: string
  stationShortLabel: string
  onSelect: (id: string) => void
  onClose: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => listStationsByCategory(), [])
  const layout = useFixedPickerLayout(anchorRef, Boolean(anchorRef))

  useEffect(() => {
    function onDoc(e: MouseEvent | TouchEvent) {
      if (!panelRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
    }
  }, [onClose])

  if (!layout) return null

  const panel = (
    <div
      ref={panelRef}
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-elevated/95 p-2.5 shadow-2xl backdrop-blur-md"
      style={{
        position: 'fixed',
        top: layout.top,
        left: layout.left,
        ...(layout.right != null ? { right: layout.right } : {}),
        ...(layout.width != null ? { width: layout.width } : {}),
        maxHeight: layout.maxHeight,
        zIndex: 120,
      }}
      onClick={(e) => e.stopPropagation()}
      role="listbox"
      aria-label="Broadcast music station"
    >
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Soundtrack · {stationShortLabel}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-fg"
          aria-label="Close music picker"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {groups.map((group) => (
          <div key={group.category} className="mb-2 last:mb-0">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
              {group.category}
            </p>
            <ul>
              {group.stations.map((s) => {
                const active = s.id === stationId
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-accent-strong/25 text-fg'
                          : 'text-fg-soft hover:bg-border/40 hover:text-fg',
                      )}
                      onClick={() => {
                        onSelect(s.id)
                        onClose()
                      }}
                    >
                      <Music
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          active ? 'text-accent-soft' : 'text-muted',
                        )}
                      />
                      <span className="min-w-0 flex-1 leading-snug">{s.label}</span>
                      {active && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
