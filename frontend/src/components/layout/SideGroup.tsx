/**
 * A sidebar entry that opens a nested list: inline under the entry when the
 * sidebar is expanded, as a flyout beside it when the sidebar is collapsed.
 */
import { ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { setPref, usePref } from '../../lib/prefs'
import { sideItemClass } from '../AppLifecycle'
import { Tooltip } from '../ui/Tooltip'

export function SideGroup({
  id,
  label,
  sublabel,
  icon,
  expanded,
  active,
  defaultOpen = true,
  children,
}: {
  id: string
  label: string
  /** Shown after the label when the sidebar is expanded (e.g. the active scenario). */
  sublabel?: string
  icon: ReactNode
  expanded: boolean
  active?: boolean
  defaultOpen?: boolean
  /** The nested items; `close` shuts the flyout after a choice. */
  children: (close: () => void) => ReactNode
}) {
  const open = usePref(`side-${id}`, defaultOpen ? '1' : '0') === '1'
  const [fly, setFly] = useState<DOMRect | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setFly(null), [location.pathname, expanded])
  useEffect(() => {
    if (!fly) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || btn.current?.contains(t)) return
      // keep the flyout when a dialog it opened is in use
      if ((t as Element).closest?.('[role="dialog"],[role="alertdialog"]')) return
      setFly(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFly(null)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [fly])
  // keep the flyout on screen
  useLayoutEffect(() => {
    const el = panel.current
    if (!fly || !el) return
    const over = el.getBoundingClientRect().bottom - (window.innerHeight - 8)
    if (over > 0) el.style.top = `${Math.max(8, fly.top - over)}px`
  }, [fly])

  const toggle = () => {
    if (expanded) setPref(`side-${id}`, open ? '0' : '1')
    else setFly((f) => (f ? null : (btn.current?.getBoundingClientRect() ?? null)))
  }

  return (
    <div className={cn('flex flex-col', !expanded && 'items-center')}>
      <Tooltip content={label} side="right" disabled={expanded || Boolean(fly)}>
        <button
          ref={btn}
          type="button"
          onClick={toggle}
          aria-expanded={expanded ? open : Boolean(fly)}
          aria-label={expanded ? undefined : label}
          className={sideItemClass(expanded, active && (!expanded || !open))}
        >
          {icon}
          {expanded && (
            <>
              <span className="truncate">{label}</span>
              {sublabel ? <span className="min-w-0 truncate text-[11px] font-normal text-muted">{sublabel}</span> : null}
              <ChevronRight aria-hidden className={cn('ml-auto h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} />
            </>
          )}
        </button>
      </Tooltip>
      {expanded && open ? <div className="ml-[17px] mt-0.5 flex flex-col gap-0.5 border-l border-border pl-1.5">{children(() => undefined)}</div> : null}
      {!expanded && fly
        ? createPortal(
            <div
              ref={panel}
              role="menu"
              aria-label={label}
              className="fixed z-[60] w-64 rounded-xl border border-border bg-elevated p-1.5 shadow-[var(--shadow-panel)]"
              style={{ left: fly.right + 8, top: fly.top }}
            >
              <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-muted">{label}</div>
              <div className="flex flex-col gap-0.5">{children(() => setFly(null))}</div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/** A plain row inside a SideGroup. */
export function SideRow({
  children,
  active,
  onClick,
  title,
  className,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50',
        active ? 'bg-fg/[0.08] font-medium text-fg' : 'text-fg-soft hover:bg-fg/[0.05] hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}
