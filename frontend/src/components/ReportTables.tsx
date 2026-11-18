/**
 * The report's summary tables, sortable, with rows that jump to the object on the map.
 */

import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { downloadText, safeName, toCsv } from '../lib/exportFiles'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RptTable } from '../api/client'
import { focusOnMap } from '../lib/mapFocus'
import { convertTable, useUnitSystem } from '../lib/units'
import { setPref } from '../lib/prefs'

function fmt(v: string | number | null, col: string) {
  if (v == null) return ''
  if (typeof v !== 'number') return v
  if (col === 'Days') return String(Math.round(v))
  return Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(v)
}

/** Values a modeller should look at: flooding, surcharge, pipes over capacity. */
function flagReason(table: string, column: string, v: string | number | null): string | null {
  if (typeof v !== 'number') return null
  const t = table.toLowerCase()
  const c = column.toLowerCase()
  if (c.includes('hours flooded') && v > 0) return 'Flooded'
  if (t.includes('flooding') && c.includes('maximum rate') && v > 0) return 'Flooding'
  if (t.includes('flooding') && c.includes('total flood volume') && v > 0) return 'Flood volume'
  if (c.includes('max/full flow') && v > 1) return 'Over capacity'
  if (c.includes('max/full depth') && v >= 1) return 'Full'
  if (t.includes('surcharge') && c.includes('hours') && c.includes('surcharged') && v > 0) return 'Surcharged'
  return null
}


function Table({ t, idFilter = '', flaggedOnly = false }: { t: RptTable; idFilter?: string; flaggedOnly?: boolean }) {
  const navigate = useNavigate()
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null)
  const [filter, setFilter] = useState('')
  const rows = useMemo(() => {
    let r = t.rows
    const q = (filter || idFilter).toLowerCase()
    if (q) r = r.filter((row) => String(row[0]).toLowerCase().includes(q))
    if (flaggedOnly) r = r.filter((row) => row.some((v, ci) => flagReason(t.title, t.columns[ci], v)))
    if (sort) {
      r = [...r].sort((a, b) => {
        const x = a[sort.col], y = b[sort.col]
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })
        return sort.desc ? -c : c
      })
    }
    return r
  }, [t.rows, sort, filter, idFilter, flaggedOnly, t.title, t.columns])

  return (
    <section className="rounded-[var(--radius-panel)] border border-border bg-elevated">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h3 className="m-0 flex-1 text-sm font-semibold text-fg">
          {t.title} <span className="font-normal text-muted">· {t.rows.length}</span>
        </h3>
        {t.rows.length > 8 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by ID"
            aria-label={`Filter ${t.title} by ID`}
            className="field h-7 w-40 text-[12px]"
          />
        )}
        <button
          type="button"
          title={`Download ${t.title} as CSV`}
          aria-label={`Download ${t.title} as CSV`}
          onClick={() =>
            downloadText(
              `${safeName(t.title)}.csv`,
              toCsv(
                t.columns.map((c, i) => (t.units?.[i] ? `${c} (${t.units[i]})` : c)),
                rows,
              ),
            )
          }
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-fg/5 hover:text-fg"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </header>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead className="sticky top-0 bg-elevated">
            <tr>
              {t.columns.map((c, i) => (
                <th key={c + i} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-fg"
                    onClick={() => setSort((s) => (s?.col === i ? { col: i, desc: !s.desc } : { col: i, desc: i > 0 }))}
                  >
                    {c}
                    {t.units[i] && <span className="text-[10px] font-normal">({t.units[i]})</span>}
                    {sort?.col === i && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-t border-border/60 hover:bg-fg/5">
                {row.map((v, ci) => (
                  <td
                    key={ci}
                    title={flagReason(t.title, t.columns[ci], v) ?? undefined}
                    className={`whitespace-nowrap px-3 py-1.5 ${ci === 0 ? '' : flagReason(t.title, t.columns[ci], v) ? 'font-medium text-warning' : 'text-fg-soft'}`}
                  >
                    {ci === 0 && t.object ? (
                      <button
                        type="button"
                        title="Show on map"
                        className="font-medium text-accent-soft hover:underline"
                        onClick={() => {
                          focusOnMap({ object_type: t.object!, id: String(v) })
                          navigate('/map')
                        }}
                      >
                        {fmt(v, t.columns[ci])}
                      </button>
                    ) : (
                      fmt(v, t.columns[ci])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ReportTables({ tables: raw }: { tables: RptTable[] }) {
  const system = useUnitSystem()
  const tables = useMemo(() => raw.map((t) => convertTable(t, system)), [raw, system])
  const [kind, setKind] = useState<'all' | 'node' | 'link' | 'subcatchment'>('all')
  const [q, setQ] = useState('')
  const [flagged, setFlagged] = useState(false)
  if (!tables.length) return <p className="text-sm text-muted">No summary tables in this report.</p>
  const shown = tables.filter((t) => kind === 'all' || t.object === kind)
  const visible = flagged ? shown.filter((t) => t.rows.some((r) => r.some((v, ci) => flagReason(t.title, t.columns[ci], v)))) : shown
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-border bg-elevated px-3 py-2">
        <div className="flex gap-0.5" role="radiogroup" aria-label="Element type">
          {(
            [
              ['all', 'All tables'],
              ['node', 'Nodes'],
              ['link', 'Links'],
              ['subcatchment', 'Subcatchments'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`h-7 rounded-md px-2.5 text-[12px] ${kind === k ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Element ID" aria-label="Filter every table by element ID" className="field h-7 w-44 text-[12px]" />
        <label className="inline-flex items-center gap-1.5 text-[12px] text-fg-soft">
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
          Only flooding, surcharge and over-capacity rows
        </label>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted">
          Units
          <select className="field h-7 w-36 text-[12px]" value={system} onChange={(e) => setPref('display-units', e.target.value)} aria-label="Display units">
            <option value="model">As in the model</option>
            <option value="us">US customary</option>
            <option value="si">SI (metric)</option>
          </select>
        </label>
        <span className="text-[11px] text-muted">
          {visible.length} of {tables.length} tables
        </span>
      </div>
      {visible.map((t) => (
        <Table key={t.title} t={t} idFilter={q} flaggedOnly={flagged} />
      ))}
      {!visible.length && <p className="text-[13px] text-muted">No table has rows like that. Clear the filters to see everything.</p>}
    </div>
  )
}
