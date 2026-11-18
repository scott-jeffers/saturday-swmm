/**
 * Every SWMM section as an editable grid (or text for CONTROLS/TITLE/
 * TRANSECTS): curves, time series, patterns, inflows, dry-weather flow,
 * LID, water quality, groundwater… Paste blocks from Excel, bulk-set a
 * column on selected rows, add and delete rows.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { api, type SectionData } from '../api/client'
import { Button, useToast } from '../components/ui'
import { IS_VIEWER } from '../lib/mode'

type Row = { values: string[]; comment: string }

const GROUPS: [string, string[]][] = [
  ['Simulation', ['TITLE', 'OPTIONS', 'REPORT', 'FILES', 'EVAPORATION', 'TEMPERATURE', 'ADJUSTMENTS']],
  ['Hydrology', ['RAINGAGES', 'SUBCATCHMENTS', 'SUBAREAS', 'INFILTRATION', 'LID_CONTROLS', 'LID_USAGE', 'AQUIFERS', 'GROUNDWATER', 'GWF', 'SNOWPACKS']],
  ['Hydraulics', ['JUNCTIONS', 'OUTFALLS', 'DIVIDERS', 'STORAGE', 'CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS', 'OUTLETS', 'XSECTIONS', 'TRANSECTS', 'STREETS', 'INLETS', 'INLET_USAGE', 'LOSSES', 'CONTROLS']],
  ['Inflows', ['INFLOWS', 'DWF', 'RDII', 'HYDROGRAPHS']],
  ['Water quality', ['POLLUTANTS', 'LANDUSES', 'COVERAGES', 'LOADINGS', 'BUILDUP', 'WASHOFF', 'TREATMENT']],
  ['Curves & series', ['CURVES', 'TIMESERIES', 'PATTERNS']],
  ['Map', ['MAP', 'COORDINATES', 'VERTICES', 'POLYGONS', 'SYMBOLS', 'LABELS', 'BACKDROP', 'TAGS']],
]
const MAX_ROWS_SHOWN = 1000

function SectionGrid({ name, data, onSaved }: { name: string; data: SectionData; onSaved: (d: SectionData) => void }) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [rows, setRows] = useState<Row[]>(data.rows ?? [])
  const [text, setText] = useState(data.text ?? '')
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState('')
  const [bulkCol, setBulkCol] = useState(1)
  const [bulkVal, setBulkVal] = useState('')
  const lastClicked = useRef<number | null>(null)

  useEffect(() => {
    setRows(data.rows ?? [])
    setText(data.text ?? '')
    setDirty(false)
    setSelected(new Set())
  }, [data])

  const cols = useMemo(() => {
    const w = Math.max(data.columns?.length ?? 0, ...rows.map((r) => r.values.length), 1)
    return Array.from({ length: w }, (_, i) => data.columns?.[i] ?? `Field ${i + 1}`)
  }, [data.columns, rows])

  const visible = useMemo(() => {
    const idx = rows.map((_, i) => i)
    const f = filter.trim().toLowerCase()
    return (f ? idx.filter((i) => rows[i].values.join(' ').toLowerCase().includes(f)) : idx).slice(0, MAX_ROWS_SHOWN)
  }, [rows, filter])

  const save = useMutation({
    mutationFn: () => (data.kind === 'text' ? api.putSection(name, { text }) : api.putSection(name, { rows })),
    onSuccess: (d) => {
      onSaved(d)
      for (const k of ['network', 'object', 'inp', 'project', 'model-check']) void qc.invalidateQueries({ queryKey: [k] })
      toast({ title: `Saved [${name}]`, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: `Couldn’t save [${name}]`, description: e.message, tone: 'danger' }),
  })

  const setCell = (r: number, c: number, v: string) => {
    setRows((prev) => {
      const next = prev.slice()
      const vals = next[r].values.slice()
      while (vals.length <= c) vals.push('')
      vals[c] = v
      next[r] = { ...next[r], values: vals }
      return next
    })
    setDirty(true)
  }

  // Paste a block copied from Excel / Sheets (tab-separated) starting at this cell.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const t = e.clipboardData.getData('text/plain')
    if (!t.includes('\t') && !t.includes('\n')) return
    e.preventDefault()
    const block = t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    setRows((prev) => {
      const next = prev.slice()
      block.forEach((cells, i) => {
        const ri = r + i
        while (next.length <= ri) next.push({ values: [], comment: '' })
        const vals = next[ri].values.slice()
        cells.forEach((v, j) => {
          while (vals.length <= c + j) vals.push('')
          vals[c + j] = v.trim()
        })
        next[ri] = { ...next[ri], values: vals }
      })
      return next
    })
    setDirty(true)
  }

  if (data.kind === 'text') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setDirty(true)
          }}
          spellCheck={false}
          readOnly={IS_VIEWER}
          className="min-h-[24rem] flex-1 rounded-lg border border-border bg-surface p-3 font-mono text-xs text-fg outline-none focus:border-accent"
        />
        <div className={`flex gap-2 ${IS_VIEWER ? 'hidden' : ''}`}>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button variant="ghost" disabled={!dirty} onClick={() => onSaved(data)}>
            <Undo2 className="h-4 w-4" /> Discard changes
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!IS_VIEWER && (<>
        <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
        <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => onSaved(data)}>
          <Undo2 className="h-3.5 w-3.5" /> Discard
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRows((p) => [...p, { values: cols.map(() => ''), comment: '' }])
            setDirty(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add row
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selected.size}
          onClick={() => {
            setRows((p) => p.filter((_, i) => !selected.has(i)))
            setSelected(new Set())
            setDirty(true)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete {selected.size || ''}
        </Button>
        {selected.size > 0 && (
          <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-fg-soft">
            Set
            <select value={bulkCol} onChange={(e) => setBulkCol(Number(e.target.value))} className="h-7 rounded border border-border bg-surface px-1 text-xs">
              {cols.map((c, i) => (
                <option key={c + i} value={i}>
                  {c}
                </option>
              ))}
            </select>
            to
            <input value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} className="h-7 w-24 rounded border border-border bg-surface px-2 text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRows((p) =>
                  p.map((r, i) => {
                    if (!selected.has(i)) return r
                    const v = r.values.slice()
                    while (v.length <= bulkCol) v.push('')
                    v[bulkCol] = bulkVal
                    return { ...r, values: v }
                  }),
                )
                setDirty(true)
              }}
            >
              Apply to {selected.size} row{selected.size > 1 ? 's' : ''}
            </Button>
          </span>
        )}
        </>)}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows"
          aria-label="Filter rows"
          className="ml-auto h-8 w-48 rounded-md border border-border bg-surface px-2 text-xs text-fg outline-none focus:border-accent"
        />
      </div>
      <p className="m-0 text-[11px] text-muted">
        {rows.length.toLocaleString()} rows{visible.length < rows.length ? ` · showing ${visible.length.toLocaleString()}` : ''}.
        {IS_VIEWER ? ' Read-only in the browser viewer.' : ' Paste cells copied from Excel straight into the grid.'}
        {dirty && <span className="ml-2 text-amber-300">Unsaved changes</span>}
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-elevated">
            <tr>
              <th className="w-8 px-2 py-1.5">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={visible.length > 0 && visible.every((i) => selected.has(i))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(visible) : new Set())}
                />
              </th>
              {cols.map((c, i) => (
                <th key={c + i} className="whitespace-nowrap px-1 py-1.5 text-left font-medium text-muted">
                  {c}
                </th>
              ))}
              <th className="px-1 py-1.5 text-left font-medium text-muted">Comment</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((ri) => (
              <tr key={ri} className={`border-t border-border/50 ${selected.has(ri) ? 'bg-accent/10' : ''}`}>
                <td className="px-2">
                  <input
                    type="checkbox"
                    aria-label={`Select row ${ri + 1}`}
                    title="Shift-click to select a range"
                    checked={selected.has(ri)}
                    onClick={(e) => {
                      const on = !selected.has(ri)
                      const shift = e.shiftKey && lastClicked.current != null
                      const from = shift ? visible.indexOf(lastClicked.current!) : -1
                      const to = visible.indexOf(ri)
                      setSelected((s) => {
                        const n = new Set(s)
                        const range = shift && from >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [ri]
                        for (const r of range) on ? n.add(r) : n.delete(r)
                        return n
                      })
                      lastClicked.current = ri
                    }}
                    onChange={() => {}}
                  />
                </td>
                {cols.map((_, ci) => (
                  <td key={ci} className="p-0">
                    <input
                      value={rows[ri].values[ci] ?? ''}
                      readOnly={IS_VIEWER}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      onPaste={(e) => onPaste(e, ri, ci)}
                      className="h-7 w-full min-w-[5.5rem] border-0 bg-transparent px-1.5 font-mono text-[12px] text-fg outline-none focus:bg-accent/10"
                    />
                  </td>
                ))}
                <td className="p-0">
                  <input
                    value={rows[ri].comment}
                    readOnly={IS_VIEWER}
                    onChange={(e) => {
                      const v = e.target.value
                      setRows((p) => p.map((r, i) => (i === ri ? { ...r, comment: v } : r)))
                      setDirty(true)
                    }}
                    className="h-7 w-full min-w-[8rem] border-0 bg-transparent px-1.5 text-[12px] text-muted outline-none focus:bg-accent/10"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ModelDataPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['sections'], queryFn: api.listSections })
  const [current, setCurrent] = useState('CURVES')
  const sec = useQuery({ queryKey: ['section', current], queryFn: () => api.getSection(current) })
  const present = new Map((list.data?.sections ?? []).map((s) => [s.name.toUpperCase(), s]))

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-60 shrink-0 overflow-y-auto border-r border-border bg-elevated p-3" aria-label="Sections">
        <h1 className="m-0 mb-4 px-2 pt-1 text-[15px] font-semibold text-fg">Model data</h1>
        {GROUPS.map(([g, names]) => (
          <div key={g} className="mb-3">
            <div className="mb-1 px-2 text-[11px] font-medium text-muted">{g}</div>
            {names.map((n) => {
              const p = present.get(n)
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCurrent(n)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs ${
                    current === n ? 'bg-accent/15 text-fg' : p ? 'text-fg-soft hover:bg-fg/5' : 'text-muted hover:bg-fg/5'
                  }`}
                >
                  <span>{n.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
                  {p && <span className="tabular-nums text-[10px] text-muted">{p.rows}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <header>
          <h2 className="m-0 text-lg font-semibold text-fg">[{current}]</h2>
          {!present.has(current) && (
            <p className="m-0 text-xs text-muted">This section isn’t in the model yet. Add rows and save to create it.</p>
          )}
        </header>
        {sec.data ? (
          <SectionGrid
            name={current}
            data={sec.data}
            onSaved={(d) => {
              qc.setQueryData(['section', current], { ...d })
              void qc.invalidateQueries({ queryKey: ['sections'] })
            }}
          />
        ) : (
          <p className="text-sm text-muted">{sec.isError ? (sec.error as Error).message : 'Loading…'}</p>
        )}
      </main>
    </div>
  )
}
