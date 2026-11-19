/**
 * A window for charts and long-sections: it floats over the map (drag by the
 * title, resize from the corner), or moves to its own browser window so it can
 * sit on a second monitor.
 */
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Minimize2, X } from 'lucide-react'

type Rect = { x: number; y: number; w: number; h: number }

export function FloatingWindow({
  title,
  initial,
  onClose,
  children,
  zIndex = 40,
  onFocus,
}: {
  title: ReactNode
  initial: Rect
  onClose: () => void
  children: ReactNode
  zIndex?: number
  onFocus?: () => void
}) {
  const [rect, setRect] = useState(initial)
  const [external, setExternal] = useState<Window | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const drag = useRef<{ mode: 'move' | 'size'; sx: number; sy: number; r: Rect } | null>(null)

  const start = (mode: 'move' | 'size') => (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    onFocus?.()
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r: rect }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    setRect(
      d.mode === 'move'
        ? { ...d.r, x: Math.max(0, d.r.x + dx), y: Math.max(0, d.r.y + dy) }
        : { ...d.r, w: Math.max(320, d.r.w + dx), h: Math.max(200, d.r.h + dy) },
    )
  }
  const end = () => (drag.current = null)

  // Move into a real browser window: copy the app's styles and theme, render through a portal.
  const popOut = () => {
    const win = window.open('', '', `width=${Math.round(rect.w + 40)},height=${Math.round(rect.h + 60)}`)
    if (!win) return
    win.document.title = typeof title === 'string' ? `${title} · Saturday-SWMM` : 'Saturday-SWMM'
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => win.document.head.appendChild(n.cloneNode(true)))
    win.document.documentElement.className = document.documentElement.className
    const theme = document.documentElement.getAttribute('data-theme')
    if (theme) win.document.documentElement.setAttribute('data-theme', theme)
    win.document.body.style.margin = '0'
    win.document.body.className = 'bg-surface text-fg'
    const div = win.document.createElement('div')
    div.style.cssText = 'height:100vh;display:flex;flex-direction:column'
    win.document.body.appendChild(div)
    setExternal(win)
    setHost(div)
  }
  useEffect(() => {
    if (!external) return
    const back = () => {
      setExternal(null)
      setHost(null)
    }
    external.addEventListener('beforeunload', back)
    // ResponsiveContainer & co. listen to the main window's resize; nudge them on the popup's.
    const nudge = () => window.dispatchEvent(new Event('resize'))
    external.addEventListener('resize', nudge)
    return () => {
      external.removeEventListener('beforeunload', back)
      external.removeEventListener('resize', nudge)
    }
  }, [external])
  useEffect(() => () => external?.close(), [external])

  const titleBar = (inExternal: boolean) => (
    <div
      className={`flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5 text-[12px] font-medium text-fg-soft ${inExternal ? '' : 'cursor-move select-none'}`}
      onPointerDown={inExternal ? undefined : start('move')}
      onPointerMove={inExternal ? undefined : move}
      onPointerUp={inExternal ? undefined : end}
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {inExternal ? (
        <button type="button" title="Bring back into the app" aria-label="Bring back into the app" className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg" onClick={() => external?.close()}>
          <Minimize2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button type="button" title="Open in its own window (for a second monitor)" aria-label="Open in its own window" className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg" onClick={popOut}>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      <button type="button" title="Close" aria-label="Close window" className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg" onClick={onClose}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  if (external && host)
    return createPortal(
      <>
        {titleBar(true)}
        <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
      </>,
      host,
    )

  return (
    <section
      className="map-overlay pointer-events-auto absolute flex flex-col"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex }}
      onPointerDown={() => onFocus?.()}
      aria-label={typeof title === 'string' ? title : 'Window'}
    >
      {titleBar(false)}
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
      <div
        className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-se-resize"
        onPointerDown={start('size')}
        onPointerMove={move}
        onPointerUp={end}
        aria-hidden
      />
    </section>
  )
}
