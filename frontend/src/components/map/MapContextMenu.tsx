/** Right-click menu on the map: actions for what's under the pointer. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem =
  | { kind?: 'item'; label: string; hint?: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }

export function MapContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [active, setActive] = useState(-1)
  const actionable = items.map((it, i) => (it.kind === 'separator' || it.kind === 'header' || it.disabled ? -1 : i)).filter((i) => i >= 0)

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 6), y: Math.min(y, window.innerHeight - r.height - 6) })
    el.focus()
  }, [x, y])

  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('wheel', close, { passive: true })
      window.addEventListener('blur', close)
      window.addEventListener('resize', close)
    }, 0)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('wheel', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const i = actionable.indexOf(active)
          const n = e.key === 'ArrowDown' ? (i + 1) % actionable.length : (i - 1 + actionable.length) % actionable.length
          setActive(actionable[n] ?? -1)
        } else if (e.key === 'Enter' && active >= 0) {
          const it = items[active]
          if (it && it.kind !== 'separator' && it.kind !== 'header') {
            onClose()
            it.onSelect()
          }
        }
      }}
      className="fixed z-[60] min-w-[13rem] max-w-[20rem] rounded-xl border border-border bg-elevated p-1 text-xs shadow-[var(--shadow-panel)] outline-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((it, i) =>
        it.kind === 'separator' ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : it.kind === 'header' ? (
          <div key={i} className="truncate px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-muted">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left disabled:opacity-40 ${
              active === i ? 'bg-fg/10' : ''
            } ${it.danger ? 'text-danger' : 'text-fg-soft'}`}
          >
            <span className="flex w-4 shrink-0 justify-center text-muted">{it.icon}</span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && <span className="shrink-0 text-[10px] text-muted">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  )
}
