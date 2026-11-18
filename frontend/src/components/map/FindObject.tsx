/** Find a node, link or subcatchment by ID and zoom to it (Ctrl/Cmd+F on the map). */

import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelNetwork } from '../../api/client'
import type { FocusTarget } from '../../lib/mapFocus'

type Hit = FocusTarget & { kind: string }
const KIND_LABEL: Record<string, string> = { node: 'Node', link: 'Link', subcatchment: 'Subcatchment' }

export function FindObject({ network, onFind }: { network: ModelNetwork; onFind: (t: FocusTarget) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLInputElement>(null)

  const all = useMemo<Hit[]>(
    () =>
      network.geojson.features.flatMap((f) => {
        const p = f.properties ?? {}
        const t = p.object_type as string
        if (!['node', 'link', 'subcatchment'].includes(t) || p.id == null) return []
        return [{ object_type: t as Hit['object_type'], id: String(p.id), kind: String(p.node_kind ?? p.link_kind ?? KIND_LABEL[t]) }]
      }),
    [network],
  )
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const starts = all.filter((h) => h.id.toLowerCase().startsWith(s))
    const has = all.filter((h) => !h.id.toLowerCase().startsWith(s) && h.id.toLowerCase().includes(s))
    return [...starts, ...has].slice(0, 12)
  }, [q, all])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && ref.current?.offsetParent) {
        e.preventDefault()
        ref.current.focus()
        ref.current.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (h: Hit) => {
    onFind({ object_type: h.object_type, id: h.id })
    setQ(h.id)
    setOpen(false)
    ref.current?.blur()
  }

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 w-56">
      <div className="flex h-8 items-center gap-1.5 map-overlay px-2 focus-within:border-accent">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        <input
          ref={ref}
          value={q}
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="find-object-list"
          aria-label="Find by ID"
          placeholder="Find by ID"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && hits[active]) {
              pick(hits[active])
            } else if (e.key === 'Escape') {
              setOpen(false)
              ref.current?.blur()
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-muted"
        />
        <kbd className="hidden text-[10px] text-muted sm:inline">Ctrl F</kbd>
      </div>
      {open && hits.length > 0 && (
        <ul id="find-object-list" role="listbox" className="mt-1 max-h-72 list-none overflow-y-auto rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]">
          {hits.map((h, i) => (
            <li
              key={h.object_type + h.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(h)
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-xs ${i === active ? 'bg-accent/15 text-fg' : 'text-fg-soft'}`}
            >
              <span className="truncate font-mono">{h.id}</span>
              <span className="shrink-0 text-[10px] capitalize text-muted">{h.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
