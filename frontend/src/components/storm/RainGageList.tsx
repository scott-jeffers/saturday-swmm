/** Rain gages in the model and the rain files in the project, in one place:
 *  what each gage reads, how and how often, which subcatchments use it. */

import * as DM from '@radix-ui/react-dropdown-menu'
import { AlertTriangle, CloudRain, Eye, FileText, MoreHorizontal, Pencil, Plus, Table2, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { AlertDialog, Button, Tooltip } from '../ui'

export type GageInfo = {
  name: string
  format: string
  interval: string
  scf?: number
  source: string
  filename?: string | null
  station?: string | null
  timeseries?: string | null
  units?: string | null
  subcatchments?: number
  subcatchments_total?: number
}

export type GageSave = {
  new_name?: string
  format: string
  interval: string
  scf?: number
  source: 'TIMESERIES' | 'FILE'
  timeseries?: string | null
  filename?: string | null
  station?: string | null
  units?: string | null
}

export type RainFile = { filename: string; size_bytes: number }

const FORMATS: [string, string, string][] = [
  ['INTENSITY', 'Intensity', 'Each value is a rain rate (in/hr or mm/hr).'],
  ['VOLUME', 'Depth per step', 'Each value is the depth that fell in that time step.'],
  ['CUMULATIVE', 'Cumulative depth', 'Each value is the total depth since the start.'],
]
const FORMAT_LABEL = Object.fromEntries(FORMATS.map(([v, l]) => [v, l]))

const INTERVALS: [string, string][] = [
  ['0:01', '1 min'], ['0:02', '2 min'], ['0:05', '5 min'], ['0:10', '10 min'], ['0:15', '15 min'],
  ['0:30', '30 min'], ['1:00', '1 hr'], ['6:00', '6 hr'], ['24:00', '1 day'],
]

function toMinutes(iv: string) {
  if (iv.includes(':')) {
    const [h, m, s] = iv.split(':').map(Number)
    return (h || 0) * 60 + (m || 0) + (s || 0) / 60
  }
  return Number(iv) * 60
}

/** "0:05" → "5 min", "1:00" → "1 hr", "0.25" (hours) → "15 min". */
export function intervalLabel(iv: string) {
  const min = toMinutes(iv)
  if (!Number.isFinite(min) || min <= 0) return iv
  if (min === 1440) return '1 day'
  if (min % 60 === 0) return `${min / 60} hr`
  return `${Math.round(min * 10) / 10} min`
}

const baseName = (f?: string | null) => (f ?? '').replace(/^.*[\\/]/, '')
const sourceKey = (g: Pick<GageInfo, 'source' | 'filename' | 'timeseries'>) =>
  g.source === 'FILE' ? `FILE:${baseName(g.filename)}` : `TS:${g.timeseries ?? ''}`

const fileSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** The gage's fields as a save body, with `patch` on top. */
function body(g: GageInfo, patch: Partial<GageSave>): GageSave {
  return {
    format: g.format.toUpperCase(),
    interval: g.interval,
    scf: g.scf ?? 1,
    source: g.source === 'FILE' ? 'FILE' : 'TIMESERIES',
    timeseries: g.timeseries,
    filename: g.filename,
    station: g.station,
    units: g.units,
    ...patch,
  }
}

const COLS = 'lg:grid-cols-[minmax(7rem,1fr)_minmax(12rem,2fr)_minmax(8.5rem,1.2fr)_6.5rem_5.5rem_minmax(9rem,1fr)_4.5rem]'
const selectCls = 'field h-8 w-full min-w-0 py-0 text-[12.5px]'

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[11px] font-medium text-muted lg:hidden" aria-hidden>{label}</span>
      {children}
    </div>
  )
}

function GageName({ name, onRename, disabled }: { name: string; onRename: (n: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  const commit = () => {
    setEditing(false)
    const v = value.trim()
    if (v && v !== name) onRename(v)
    else setValue(name)
  }
  if (editing)
    return (
      <input
        autoFocus
        aria-label={`Name of rain gage ${name}`}
        className="field h-8 w-full min-w-0 text-[13px] font-semibold"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\s/g, '_'))}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setValue(name)
            setEditing(false)
          }
        }}
      />
    )
  return (
    <Tooltip content="Rename">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="group/name flex h-8 min-w-0 items-center gap-1.5 rounded-md text-left text-[13px] font-semibold text-fg"
        aria-label={`Rename rain gage ${name}`}
      >
        <span className="truncate">{name}</span>
        <Pencil className="h-3 w-3 shrink-0 text-muted opacity-0 transition-opacity group-hover/name:opacity-100 group-focus-visible/name:opacity-100" aria-hidden />
      </button>
    </Tooltip>
  )
}

function Usage({ g, onApplyAll, busy }: { g: GageInfo; onApplyAll: () => void; busy?: boolean }) {
  const n = g.subcatchments ?? 0
  const total = g.subcatchments_total ?? 0
  if (!total) return <span className="text-[12px] text-muted">None in the model yet</span>
  if (n === total)
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-soft">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
        {total === 1 ? 'The only one' : `All ${total}`}
      </span>
    )
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
      <span className={cn('inline-flex items-center gap-1.5', n ? 'text-fg-soft' : 'text-warning')}>
        {n ? <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
        {n ? `${n} of ${total}` : 'None'}
      </span>
      <button type="button" disabled={busy} onClick={onApplyAll} className="font-medium text-accent-soft hover:underline disabled:opacity-50">
        Use for all
      </button>
    </span>
  )
}

const iconBtn = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40'

export function RainGageList({
  gages,
  files,
  timeseries,
  loading,
  busy,
  onSave,
  onApplyAll,
  onSnap,
  onSyncTimes,
  onRemove,
  onView,
  onDeleteFile,
  preview,
}: {
  gages: GageInfo[]
  files: RainFile[]
  timeseries: string[]
  loading?: boolean
  busy?: boolean
  onSave: (name: string, body: GageSave) => void
  onApplyAll: (name: string) => void
  onSnap: (name: string) => void
  onSyncTimes: (filename: string) => void
  onRemove: (name: string) => void
  /** Show the rain a gage reads, or a rain file, below the list. */
  onView: (what: { file: string } | { timeseries: string; gage: GageInfo }) => void
  onDeleteFile: (filename: string) => void
  preview?: ReactNode
}) {
  const [removing, setRemoving] = useState<GageInfo | null>(null)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)

  const readers = (file: string) => gages.filter((g) => g.source === 'FILE' && baseName(g.filename) === file)
  const canAdd = timeseries.length > 0 || files.length > 0
  const nextName = () => {
    let i = gages.length + 1
    while (gages.some((g) => g.name === `RG${i}`)) i++
    return `RG${i}`
  }
  const addGage = (file?: string) => {
    const f = file ?? (timeseries.length ? undefined : files[0]?.filename)
    onSave(
      nextName(),
      f
        ? { source: 'FILE', filename: f, format: 'VOLUME', interval: '0:05', units: 'IN' }
        : { source: 'TIMESERIES', timeseries: timeseries[0], format: 'INTENSITY', interval: '0:05' },
    )
  }
  const deletingReaders = deletingFile ? readers(deletingFile) : []

  return (
    <section aria-labelledby="rain-gages-h" className="rounded-[var(--radius-panel)] border border-border bg-elevated p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="rain-gages-h" className="m-0 text-[15px] font-semibold text-fg">Rain gages</h2>
          <p className="m-0 mt-0.5 max-w-[68ch] text-[12.5px] text-muted">
            Each subcatchment takes its rain from a gage. Choose what a gage reads and how; changes save to the model as you make them.
          </p>
        </div>
        <Tooltip content={canAdd ? 'A new gage reading the first time series or rain file' : 'Save a storm or a rain record to the model first'}>
          <span>
            <Button size="sm" variant="outline" disabled={!canAdd || busy} onClick={() => addGage()}>
              <Plus className="h-3.5 w-3.5" /> Add gage
            </Button>
          </span>
        </Tooltip>
      </div>

      {loading ? (
        <p className="m-0 mt-4 text-[12px] text-muted">Loading…</p>
      ) : !gages.length ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5 text-[12.5px] text-muted">
          <CloudRain className="h-5 w-5 shrink-0 text-accent-soft" aria-hidden />
          <span>No rain gages yet. Save a storm or a rain record to the model above and one is made for you{canAdd ? ', or add one here' : ''}.</span>
        </div>
      ) : (
        <div className="mt-4" role="table" aria-label="Rain gages in the model">
          <div role="row" className={cn('hidden gap-3 border-b border-border px-2 pb-1.5 text-[11px] font-medium text-muted lg:grid', COLS)}>
            <span role="columnheader">Gage</span>
            <span role="columnheader">Reads</span>
            <span role="columnheader">Values are</span>
            <span role="columnheader">Every</span>
            <span role="columnheader">Units</span>
            <span role="columnheader">Subcatchments</span>
            <span role="columnheader"><span className="sr-only">Actions</span></span>
          </div>
          <div role="rowgroup">
            {gages.map((g) => {
              const isFile = g.source === 'FILE'
              const fmt = g.format.toUpperCase()
              const key = sourceKey(g)
              const iv = INTERVALS.find(([v]) => toMinutes(v) === toMinutes(g.interval))?.[0]
              const save = (patch: Partial<GageSave>) => onSave(g.name, body(g, patch))
              const fileName = baseName(g.filename)
              const missing = isFile ? !files.some((f) => f.filename === fileName) : !timeseries.includes(g.timeseries ?? '')
              const SrcIcon = isFile ? FileText : Table2
              return (
                <div
                  key={g.name}
                  role="row"
                  className={cn('grid grid-cols-2 items-end gap-x-3 gap-y-2.5 border-b border-border/70 px-2 py-3 last:border-b-0 sm:grid-cols-4 lg:items-center lg:py-2', COLS)}
                >
                  <div role="cell" className="flex min-w-0 items-center gap-2 self-center sm:col-span-3 lg:col-span-1">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-soft" aria-hidden>
                      <CloudRain className="h-3.5 w-3.5" />
                    </span>
                    <GageName name={g.name} disabled={busy} onRename={(n) => save({ new_name: n })} />
                  </div>
                  <div role="cell" className="flex items-center justify-end gap-0.5 self-center lg:order-last">
                    <Tooltip content={missing ? 'Nothing to show: choose what it reads' : `Show the rain ${g.name} reads`}>
                      <span>
                        <button
                          type="button"
                          aria-label={`Show the rain ${g.name} reads`}
                          disabled={missing}
                          onClick={() => onView(isFile ? { file: fileName } : { timeseries: g.timeseries ?? '', gage: g })}
                          className={iconBtn}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </span>
                    </Tooltip>
                    <DM.Root>
                      <DM.Trigger asChild>
                        <button type="button" aria-label={`More for ${g.name}`} className={iconBtn}>
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DM.Trigger>
                      <DM.Portal>
                        <DM.Content align="end" sideOffset={4} className="z-50 min-w-[15rem] rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-[var(--shadow-panel)]">
                          {[
                            { label: 'Set simulation dates to its file', on: () => onSyncTimes(fileName), show: isFile && !!fileName },
                            { label: 'Move to the 2D mesh centre', on: () => onSnap(g.name), show: true },
                          ]
                            .filter((i) => i.show)
                            .map((i) => (
                              <DM.Item key={i.label} onSelect={i.on} className="flex min-h-8 cursor-default items-center rounded-md px-2 outline-none data-[highlighted]:bg-fg/[0.06]">
                                {i.label}
                              </DM.Item>
                            ))}
                          <DM.Separator className="my-1 h-px bg-border" />
                          <DM.Item onSelect={() => setRemoving(g)} className="flex min-h-8 cursor-default items-center rounded-md px-2 text-danger outline-none data-[highlighted]:bg-danger/10">
                            Remove gage…
                          </DM.Item>
                        </DM.Content>
                      </DM.Portal>
                    </DM.Root>
                  </div>
                  <Field label="Reads" className="col-span-2 lg:col-span-1">
                    <div className="relative">
                      <SrcIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
                      <select
                        aria-label={`What ${g.name} reads`}
                        className={cn(selectCls, 'pl-8', missing && 'border-warning')}
                        value={key}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v.startsWith('FILE:')) save({ source: 'FILE', filename: v.slice(5), station: null, units: g.units ?? 'IN' })
                          else save({ source: 'TIMESERIES', timeseries: v.slice(3) })
                        }}
                      >
                        {missing && <option value={key}>{isFile ? fileName : g.timeseries} (not found)</option>}
                        {timeseries.length > 0 && (
                          <optgroup label="Time series in the model">
                            {timeseries.map((t) => <option key={t} value={`TS:${t}`}>{t}</option>)}
                          </optgroup>
                        )}
                        {files.length > 0 && (
                          <optgroup label="Rain files in the project">
                            {files.map((f) => <option key={f.filename} value={`FILE:${f.filename}`}>{f.filename}</option>)}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  </Field>
                  <Field label="Values are" className="col-span-2 lg:col-span-1">
                    <select aria-label={`How ${g.name}'s values are recorded`} title={FORMATS.find(([v]) => v === fmt)?.[2]} className={selectCls} value={fmt} disabled={busy} onChange={(e) => save({ format: e.target.value })}>
                      {!FORMAT_LABEL[fmt] && <option value={fmt}>{g.format}</option>}
                      {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Every">
                    <select aria-label={`${g.name} recording interval`} className={selectCls} value={iv ?? g.interval} disabled={busy} onChange={(e) => save({ interval: e.target.value })}>
                      {!iv && <option value={g.interval}>{intervalLabel(g.interval)}</option>}
                      {INTERVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                  <Field label="Units">
                    {isFile ? (
                      <select aria-label={`${g.name} rain units`} className={selectCls} value={(g.units ?? 'IN').toUpperCase()} disabled={busy} onChange={(e) => save({ units: e.target.value })}>
                        <option value="IN">in</option>
                        <option value="MM">mm</option>
                      </select>
                    ) : (
                      <Tooltip content="A time series is in the model’s units (in for US, mm for SI)">
                        <span className="flex h-8 items-center text-[12.5px] text-muted">Model’s</span>
                      </Tooltip>
                    )}
                  </Field>
                  <Field label="Subcatchments" className="col-span-2 lg:col-span-1">
                    <div className="flex h-8 items-center">
                      <Usage g={g} busy={busy} onApplyAll={() => onApplyAll(g.name)} />
                    </div>
                  </Field>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="m-0 mb-2 text-[12.5px] font-semibold text-fg-soft">Rain files in the project</h3>
          <ul className="m-0 grid list-none gap-2 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,21rem),1fr))]">
            {files.map((f) => {
              const by = readers(f.filename)
              return (
                <li key={f.filename} className="flex min-w-0 items-center gap-2 rounded-lg border border-border py-1.5 pl-3 pr-1.5">
                  <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-fg" title={f.filename}>{f.filename}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {fileSize(f.size_bytes)} ·{' '}
                      {by.length ? (
                        `read by ${by.map((g) => g.name).join(', ')}`
                      ) : (
                        <button type="button" disabled={busy} className="font-medium text-accent-soft hover:underline disabled:opacity-50" onClick={() => addGage(f.filename)}>
                          Add a gage for it
                        </button>
                      )}
                    </span>
                  </span>
                  <Tooltip content="Set the simulation dates to this file’s first and last records">
                    <button type="button" className="h-7 shrink-0 rounded-md px-1.5 text-[11.5px] text-fg-soft hover:bg-fg/[0.06] hover:text-fg" onClick={() => onSyncTimes(f.filename)}>
                      Match dates
                    </button>
                  </Tooltip>
                  <button type="button" aria-label={`Show ${f.filename}`} onClick={() => onView({ file: f.filename })} className={cn(iconBtn, 'h-7 w-7')}>
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label={`Delete ${f.filename}`} onClick={() => setDeletingFile(f.filename)} className={cn(iconBtn, 'h-7 w-7 hover:bg-danger/10 hover:text-danger')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {preview}

      <AlertDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove rain gage ${removing?.name ?? ''}?`}
        description={
          removing?.subcatchments
            ? `${removing.subcatchments} subcatchment${removing.subcatchments === 1 ? '' : 's'} still read it and will need another gage before the model runs. You can undo this.`
            : 'No subcatchment reads it. You can undo this.'
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) onRemove(removing.name)
          setRemoving(null)
        }}
      />
      <AlertDialog
        open={!!deletingFile}
        onOpenChange={(o) => !o && setDeletingFile(null)}
        title={`Delete ${deletingFile ?? ''}?`}
        description={
          deletingReaders.length
            ? `${deletingReaders.map((g) => g.name).join(', ')} read${deletingReaders.length === 1 ? 's' : ''} this file, so the model won’t run until ${deletingReaders.length === 1 ? 'that gage reads' : 'they read'} something else. Undo can’t bring the file back.`
            : 'No gage reads it. Undo can’t bring the file back.'
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (deletingFile) onDeleteFile(deletingFile)
          setDeletingFile(null)
        }}
      />
    </section>
  )
}
