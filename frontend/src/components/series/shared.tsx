/**
 * Pieces shared by the tabs of the Series & curves page: the list of items on
 * the left, an editable grid that takes pasted spreadsheet cells, the name field
 * (renames everywhere the name is used), and the "Used by" line.
 */
import { AlertTriangle, Copy, Link2, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { parsePasteGrid } from '../../lib/tableFilter'
import { validName, type Ref } from '../../lib/seriesData'
import { Button, Tooltip } from '../ui'

export type ListItem = { name: string; sub?: string; group?: string; warn?: string }

export function ItemList({
  items,
  current,
  onPick,
  onAdd,
  addLabel,
  extra,
  missing,
  onCreateMissing,
  noun,
}: {
  items: ListItem[]
  current: string | null
  onPick: (name: string) => void
  onAdd: () => void
  addLabel: string
  extra?: ReactNode
  /** Names the model uses but doesn't define. */
  missing?: { name: string; by: string }[]
  onCreateMissing?: (name: string) => void
  noun: string
}) {
  const [filter, setFilter] = useState('')
  const shown = items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
  const groups = useMemo(() => {
    const m = new Map<string, ListItem[]>()
    for (const i of shown) m.set(i.group ?? '', [...(m.get(i.group ?? '') ?? []), i])
    return [...m.entries()]
  }, [shown])
  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border bg-fg/[0.015] max-lg:w-56 max-md:max-h-[40%] max-md:w-full max-md:border-b max-md:border-r-0">
      <div className="flex items-center gap-1.5 p-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Find ${noun}`} aria-label={`Find ${noun}`} className="field h-8 w-full pl-7 text-[12.5px]" />
        </label>
        <Tooltip content={addLabel}>
          <Button variant="primary" size="icon" onClick={onAdd} aria-label={addLabel}>
            <Plus className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
      {extra && <div className="px-2 pb-2">{extra}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" role="listbox" aria-label={noun}>
        {groups.map(([g, list]) => (
          <div key={g} className="mb-1.5">
            {g && <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted">{g}</div>}
            {list.map((i) => (
              <button
                key={i.name}
                type="button"
                role="option"
                aria-selected={current === i.name}
                onClick={() => onPick(i.name)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                  current === i.name ? 'bg-accent/15 text-fg' : 'text-fg-soft hover:bg-fg/[0.05] hover:text-fg',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{i.name}</span>
                {i.warn ? (
                  <span title={i.warn}>
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-label={i.warn} />
                  </span>
                ) : (
                  i.sub && <span className="shrink-0 text-[11px] tabular-nums text-muted">{i.sub}</span>
                )}
              </button>
            ))}
          </div>
        ))}
        {!items.length && <p className="m-0 px-2 py-3 text-[12px] text-muted">None in this model yet.</p>}
        {items.length > 0 && !shown.length && <p className="m-0 px-2 py-3 text-[12px] text-muted">No match.</p>}
        {missing && missing.length > 0 && (
          <div className="mx-1 mt-2 rounded-md border border-warning/30 bg-warning/[0.06] p-2">
            <p className="m-0 mb-1 text-[11.5px] font-medium text-warning">Used but not defined</p>
            {missing.map((m) => (
              <div key={m.name} className="flex items-center gap-2 py-0.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-mono text-fg" title={`Used by ${m.by}`}>
                  {m.name}
                </span>
                {onCreateMissing && (
                  <button type="button" className="text-[11.5px] text-accent-soft hover:underline" onClick={() => onCreateMissing(m.name)}>
                    Create
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

/** The editor's title row: name (renaming updates every use), what uses it, and duplicate / delete. */
export function ItemHeader({
  name,
  taken,
  onRename,
  usedBy,
  onDuplicate,
  onDelete,
  children,
}: {
  name: string
  taken: string[]
  onRename: (to: string) => void
  usedBy: Ref[]
  onDuplicate?: () => void
  onDelete: () => void
  children?: ReactNode
}) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const clash = draft !== name && taken.some((t) => t.toUpperCase() === draft.toUpperCase() && t !== name)
  const bad = !validName(draft)
  const commit = () => {
    if (draft === name) return
    if (bad || clash) return setDraft(name)
    onRename(draft)
  }
  return (
    <div className="border-b border-border px-5 pb-3 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setDraft(name)
          }}
          aria-label="Name"
          aria-invalid={bad || clash}
          className={cn('field h-8 min-w-0 max-w-[22rem] flex-1 font-mono text-[14px] font-semibold', (bad || clash) && 'border-danger')}
        />
        {children}
        <div className="ml-auto flex items-center gap-1">
          {onDuplicate && (
            <Button variant="ghost" size="sm" onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
      {(bad || clash) && <p className="m-0 mt-1 text-[11.5px] text-danger">{bad ? 'Names can’t contain spaces, quotes, semicolons or brackets.' : 'Another item already has this name.'}</p>}
      <UsedBy refs={usedBy} />
    </div>
  )
}

export function UsedBy({ refs }: { refs: Ref[] }) {
  if (!refs.length) return <p className="m-0 mt-2 text-[12px] text-muted">Not used by anything in the model yet.</p>
  const shown = refs.slice(0, 8)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="inline-flex items-center gap-1 text-muted">
        <Link2 className="h-3.5 w-3.5" /> Used by
      </span>
      {shown.map((r, i) => (
        <span key={i} className="rounded-md border border-border bg-fg/[0.03] px-1.5 py-0.5 text-fg-soft">
          {r.what} <span className="font-mono text-fg">{r.id}</span>
        </span>
      ))}
      {refs.length > shown.length && <span className="text-muted">and {refs.length - shown.length} more</span>}
    </div>
  )
}

export type GridColumn = { key: string; label: string; width?: string; placeholder?: string; numeric?: boolean; hint?: string }

const ROW_H = 30

/**
 * An editable table of rows. Pasting cells copied from a spreadsheet fills from
 * the cell you paste into, adding rows as needed. Long tables are windowed.
 */
export function Grid({
  columns,
  rows,
  onChange,
  height = 360,
  addLabel = 'Add a row',
  invalid,
}: {
  columns: GridColumn[]
  rows: string[][]
  onChange: (rows: string[][]) => void
  height?: number
  addLabel?: string
  /** Row indexes to mark (e.g. times out of order). */
  invalid?: Set<number>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0)
  const first = Math.max(0, Math.floor(top / ROW_H) - 10)
  const last = Math.min(rows.length, first + Math.ceil(height / ROW_H) + 20)
  const set = (r: number, c: number, v: string) => onChange(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)))
  const paste = (r: number, c: number, text: string) => {
    const grid = parsePasteGrid(text)
    if (!grid) return false
    const next = rows.map((x) => [...x])
    grid.forEach((cells, ri) => {
      const at = r + ri
      while (next.length <= at) next.push(columns.map(() => ''))
      cells.forEach((v, ci) => {
        if (c + ci < columns.length) next[at]![c + ci] = v.trim()
      })
    })
    onChange(next)
    return true
  }
  const tmpl = columns.map((c) => c.width ?? '1fr').join(' ') + ' 2rem'
  return (
    <div className="rounded-lg border border-border bg-elevated">
      <div className="grid border-b border-border text-[11.5px] font-medium text-muted" style={{ gridTemplateColumns: `2.75rem ${tmpl}` }}>
        <span className="px-2 py-1.5 text-right">#</span>
        {columns.map((c) => (
          <span key={c.key} className="truncate px-1.5 py-1.5" title={c.hint}>
            {c.label}
          </span>
        ))}
        <span />
      </div>
      <div ref={box} className="overflow-y-auto" style={{ maxHeight: height }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
          {rows.slice(first, last).map((row, k) => {
            const r = first + k
            return (
              <div
                key={r}
                className={cn('group absolute inset-x-0 grid items-center', invalid?.has(r) && 'bg-warning/[0.08]')}
                style={{ top: r * ROW_H, height: ROW_H, gridTemplateColumns: `2.75rem ${tmpl}` }}
              >
                <span className="px-2 text-right text-[11px] tabular-nums text-muted">{r + 1}</span>
                {columns.map((c, ci) => (
                  <input
                    key={c.key}
                    value={row[ci] ?? ''}
                    placeholder={c.placeholder}
                    aria-label={`${c.label}, row ${r + 1}`}
                    inputMode={c.numeric ? 'decimal' : undefined}
                    onChange={(e) => set(r, ci, e.target.value)}
                    onPaste={(e) => {
                      if (paste(r, ci, e.clipboardData.getData('text/plain'))) e.preventDefault()
                    }}
                    onKeyDown={(e) => {
                      // Enter moves down a row (adding one at the end), like a spreadsheet.
                      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        const to = r + (e.key === 'ArrowUp' ? -1 : 1)
                        if (to < 0) return
                        if (to >= rows.length) onChange([...rows, columns.map(() => '')])
                        requestAnimationFrame(() => {
                          const el = box.current?.querySelector<HTMLInputElement>(`[aria-label="${c.label}, row ${to + 1}"]`)
                          el?.focus()
                          el?.select()
                        })
                      }
                    }}
                    className={cn('h-[26px] min-w-0 rounded border border-transparent bg-transparent px-1.5 text-[12.5px] text-fg outline-none hover:border-border focus:border-accent focus:bg-surface', c.numeric && 'tabular-nums')}
                  />
                ))}
                <button
                  type="button"
                  aria-label={`Delete row ${r + 1}`}
                  onClick={() => onChange(rows.filter((_, i) => i !== r))}
                  className="mx-auto hidden h-6 w-6 items-center justify-center rounded text-muted hover:bg-fg/[0.06] hover:text-danger group-hover:inline-flex"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
        <button type="button" onClick={() => onChange([...rows, columns.map(() => '')])} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-accent-soft hover:bg-fg/[0.05]">
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
        <span className="text-[11px] text-muted">Paste cells from a spreadsheet into any cell</span>
      </div>
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn('truncate text-[13px] font-medium tabular-nums', tone === 'warn' ? 'text-warning' : 'text-fg')}>{value}</div>
    </div>
  )
}

export function EmptyEditor({ icon, title, body, actions }: { icon: ReactNode; title: string; body: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-fg/[0.05]">{icon}</div>
        <h2 className="m-0 text-[15px] font-semibold text-fg">{title}</h2>
        <p className="mx-auto mb-4 mt-1.5 text-[13px] leading-relaxed text-fg-soft">{body}</p>
        {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export const fmt = (v: number) => (!Number.isFinite(v) ? '–' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString())
export const hhmm = (h: number) => {
  const m = Math.round(h * 60)
  const d = Math.floor(m / 1440)
  const r = ((m % 1440) + 1440) % 1440
  return `${d ? `${d}d ` : ''}${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}
export const tooltipStyle = { background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }
export const axisTick = { fontSize: 10.5, fill: 'var(--color-muted)' }
