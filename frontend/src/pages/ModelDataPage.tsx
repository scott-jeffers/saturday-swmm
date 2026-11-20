/**
 * Every SWMM section as an editable grid (or text for CONTROLS/TITLE/
 * TRANSECTS): curves, time series, patterns, inflows, dry-weather flow,
 * LID, water quality, groundwater… Paste blocks from Excel, bulk-set a
 * column on selected rows, add and delete rows.
 */

import { Link, useSearchParams } from 'react-router-dom'
import { EditorPage } from './EditorPage'
import { ManualLink } from '../components/ManualLink'
import { MANUAL } from '../lib/manual'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { api, type SectionData } from '../api/client'
import { Button, useToast } from '../components/ui'
import { IS_VIEWER } from '../lib/mode'

type Row = { values: string[]; comment: string }

const SECTION_INFO: Record<string, string> = {
  TITLE: 'Free text describing the model.',
  OPTIONS: 'Analysis options: units, routing method, dates and time steps.',
  REPORT: 'What goes into the text report.',
  FILES: 'Interface files to use or save (hotstart, rainfall, runoff).',
  EVAPORATION: 'How evaporation rates are supplied.',
  TEMPERATURE: 'Air temperature, wind speed and snowmelt data.',
  ADJUSTMENTS: 'Monthly adjustments to temperature, evaporation, rain and conductivity.',
  RAINGAGES: 'Rain gages and the rainfall time series or file each one reads.',
  SUBCATCHMENTS: 'Subcatchment area, width, slope, imperviousness and outlet.',
  SUBAREAS: 'Roughness and depression storage of the pervious and impervious parts.',
  INFILTRATION: 'Infiltration parameters for each subcatchment.',
  LID_CONTROLS: 'Low-impact development designs (rain gardens, permeable paving…).',
  LID_USAGE: 'Where LID controls are placed and how much area they take.',
  AQUIFERS: 'Groundwater aquifer properties.',
  GROUNDWATER: 'Which aquifer sits under each subcatchment.',
  GWF: 'Custom groundwater flow equations.',
  SNOWPACKS: 'Snow accumulation and melt parameters.',
  JUNCTIONS: 'Manholes and other junction nodes.',
  OUTFALLS: 'Where water leaves the system, and the boundary condition there.',
  DIVIDERS: 'Nodes that split flow between two links.',
  STORAGE: 'Ponds, tanks and other storage nodes with their depth–area relation.',
  CONDUITS: 'Pipes and channels between nodes.',
  PUMPS: 'Pumps and the curve each one follows.',
  ORIFICES: 'Orifices between nodes.',
  WEIRS: 'Weirs between nodes.',
  OUTLETS: 'Outlets whose flow follows a rating curve or formula.',
  XSECTIONS: 'Cross-section shape and size of every link.',
  TRANSECTS: 'Irregular channel cross-sections.',
  STREETS: 'Street cross-sections for dual-drainage models.',
  INLETS: 'Street inlet designs.',
  INLET_USAGE: 'Where inlets are placed.',
  LOSSES: 'Entrance, exit and average losses, and flap gates, per conduit.',
  CONTROLS: 'Rules that operate pumps, orifices and weirs.',
  INFLOWS: 'External time-series inflows at nodes.',
  DWF: 'Dry-weather (base) flow at nodes.',
  RDII: 'Rainfall-dependent infiltration and inflow at nodes.',
  HYDROGRAPHS: 'Unit hydrographs used by RDII.',
  POLLUTANTS: 'Pollutants to simulate.',
  LANDUSES: 'Land uses and street sweeping.',
  COVERAGES: 'Share of each subcatchment per land use.',
  LOADINGS: 'Initial pollutant buildup.',
  BUILDUP: 'How pollutants build up on each land use.',
  WASHOFF: 'How pollutants wash off each land use.',
  TREATMENT: 'Pollutant removal at nodes.',
  CURVES: 'Curves used by pumps, storage, rating and tidal boundaries.',
  TIMESERIES: 'Time series of rainfall, inflows and other values.',
  PATTERNS: 'Monthly, daily and hourly patterns for dry-weather flow.',
}
const PRETTY: Record<string, string> = {
  DWF: 'Dry-weather flow',
  RDII: 'RDII',
  GWF: 'Groundwater flow',
  LID_CONTROLS: 'LID controls',
  LID_USAGE: 'LID usage',
  XSECTIONS: 'Cross-sections',
  TIMESERIES: 'Time series',
  RAINGAGES: 'Rain gauges',
  INLET_USAGE: 'Inlet usage',
  '2D_OPTIONS': '2D options',
  '2D_MESH_FILE': '2D mesh file',
}
const prettySection = (n: string) => PRETTY[n] ?? n.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

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
  const [params, setParams] = useSearchParams()
  const textView = params.get('view') === 'text'
  const setView = (text: boolean) => {
    const next = new URLSearchParams(params)
    if (text) next.set('view', 'text')
    else next.delete('view')
    setParams(next, { replace: true })
  }
  const list = useQuery({ queryKey: ['sections'], queryFn: api.listSections })
  const [current, setCurrent] = useState(() => params.get('section')?.toUpperCase() || 'TITLE')
  const [showEmpty, setShowEmpty] = useState(false)
  const sec = useQuery({ queryKey: ['section', current], queryFn: () => api.getSection(current) })
  const present = new Map((list.data?.sections ?? []).map((s) => [s.name.toUpperCase(), s]))

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-60 shrink-0 overflow-y-auto border-r border-border bg-elevated p-3" aria-label="Sections">
        <h1 className="m-0 mb-3 px-2 pt-1 text-[15px] font-semibold text-fg">INP viewer</h1>
        <div className="mb-4 flex rounded-lg bg-fg/[0.06] p-0.5" role="tablist" aria-label="View">
          {([false, true] as const).map((t) => (
            <button
              key={String(t)}
              type="button"
              role="tab"
              aria-selected={textView === t}
              onClick={() => setView(t)}
              className={`flex-1 rounded-md px-2 py-1 text-[12px] transition-colors ${textView === t ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
            >
              {t ? 'Text' : 'Sections'}
            </button>
          ))}
        </div>
        {GROUPS.filter(([, names]) => !textView || names.some((n) => present.has(n))).map(([g, names]) => (
          <div key={g} className="mb-3">
            <div className="mb-1 px-2 text-[11px] font-medium text-muted">{g}</div>
            {names.filter((n) => (textView ? present.has(n) : showEmpty || present.has(n) || n === current)).map((n) => {
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
                  <span>{prettySection(n)}</span>
                  {p && <span className="tabular-nums text-[10px] text-muted">{p.rows}</span>}
                </button>
              )
            })}
          </div>
        ))}
        {(() => {
          const empty = GROUPS.flatMap(([, n]) => n).filter((n) => !present.has(n)).length
          return empty > 0 && !textView ? (
            <button
              type="button"
              onClick={() => setShowEmpty((v) => !v)}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-[12px] text-accent-soft hover:bg-fg/5"
            >
              {showEmpty ? 'Hide empty sections' : `Show empty sections (${empty})`}
            </button>
          ) : null
        })()}
      </nav>
      {textView ? (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col px-6 py-5">
          <EditorPage projectPath="" onClose={() => setView(false)} embedded section={current} />
        </main>
      ) : (
      <main className="flex min-w-0 flex-1 flex-col gap-3 px-6 py-5">
        <header>
          <div className="flex items-baseline gap-3">
            <h2 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-fg">
              {prettySection(current)}
              <span className="ml-2 font-mono text-[12px] font-normal text-muted">[{current}]</span>
            </h2>
            <ManualLink href={MANUAL.inputFormat} className="ml-auto">
              Input format
            </ManualLink>
            {present.has(current) && (
              <button type="button" onClick={() => setView(true)} className="text-xs text-accent-soft hover:underline">
                {IS_VIEWER ? 'Show as text' : 'Edit as text'}
              </button>
            )}
          </div>
          <p className="m-0 mt-1 text-[13px] text-muted">
            {SECTION_INFO[current] ?? ''}
            {!present.has(current) && ' This section isn’t in the model yet. Add rows and save to create it.'}
          </p>
        </header>
        {current === 'OPTIONS' ? (
          <div className="rounded-lg border border-border bg-elevated p-4 text-sm text-fg-soft">
            Simulation options have their own page, with plain-language fields{IS_VIEWER ? '' : ', checks on dates and time steps'} and the
            full option list for anything else.{' '}
            <Link to="/settings" className="font-medium text-accent-soft hover:underline">
              Open Simulation options
            </Link>
          </div>
        ) : sec.data ? (
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
      )}
    </div>
  )
}
