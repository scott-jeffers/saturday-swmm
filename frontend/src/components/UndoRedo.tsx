/**
 * Undo / redo for every model edit (the backend keeps the history per .inp).
 * Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y work anywhere except while
 * typing in a field, where the field's own undo applies.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ChevronDown, History, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { Tooltip, useToast } from './ui'

const MODEL_QUERIES = [
  'network', 'object', 'inp', 'sections', 'section', 'sim-options', 'model-check', 'simulation-window',
  'profile', 'project', 'raingages', '2d-options', '2d-info', '2d-mesh', 'edits',
]

export function refreshAfterEdit(qc: QueryClient) {
  for (const k of MODEL_QUERIES) void qc.invalidateQueries({ queryKey: [k] })
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest?.('.monaco-editor')))
}

/** Runs undo/redo and exposes the history for menus elsewhere (map context menu). */
export function useEditHistory() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const hist = useQuery({ queryKey: ['edits'], queryFn: api.getEdits, staleTime: 0 })
  const step = useMutation({
    mutationKey: ['edit-history'],
    mutationFn: (what: 'undo' | 'redo') => (what === 'undo' ? api.undoEdit() : api.redoEdit()),
    onSuccess: (r, what) => {
      qc.setQueryData(['edits'], { undo: r.undo, redo: r.redo })
      refreshAfterEdit(qc)
      toast({ title: `${what === 'undo' ? 'Undid' : 'Redid'}: ${r.applied}`, tone: 'success' })
    },
    onError: (e: Error) => {
      void qc.invalidateQueries({ queryKey: ['edits'] })
      toast({ title: 'Couldn’t do that', description: e.message, tone: 'danger' })
    },
  })
  return {
    undo: hist.data?.undo ?? [],
    redo: hist.data?.redo ?? [],
    busy: step.isPending,
    run: (what: 'undo' | 'redo') => step.mutateAsync(what).catch(() => undefined),
  }
}

export function UndoRedoControls() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const h = useEditHistory()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Any successful edit (anywhere in the app) refreshes the history.
  useEffect(
    () =>
      qc.getMutationCache().subscribe((ev) => {
        if (ev.type === 'updated' && ev.mutation.state.status === 'success') {
          void qc.invalidateQueries({ queryKey: ['project'] })
          if (ev.mutation.options.mutationKey?.[0] === 'edit-history') return
          const before = (qc.getQueryData(['edits']) as { undo?: string[] } | undefined)?.undo?.length ?? 0
          void qc.fetchQuery({ queryKey: ['edits'], queryFn: api.getEdits, staleTime: 0 }).then((e) => {
            // A new undo step appeared: say what was saved and offer Undo.
            if (e.undo.length > 0 && e.undo.length !== before && e.redo.length === 0) {
              toast({
                key: 'saved-edit',
                title: `Saved: ${e.undo[0]}`,
                action: { label: 'Undo', onClick: () => void hRef.current.run('undo') },
              })
            }
          })
        }
      }),
    [qc],
  )

  const hRef = useRef(h)
  hRef.current = h
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target) || hRef.current.busy) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey && hRef.current.undo.length) {
        e.preventDefault()
        void hRef.current.run('undo')
      } else if (((k === 'z' && e.shiftKey) || k === 'y') && hRef.current.redo.length) {
        e.preventDefault()
        void hRef.current.run('redo')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const btn = 'inline-flex h-7 items-center justify-center rounded-md px-1.5 text-fg-soft hover:bg-fg/5 disabled:opacity-35 disabled:hover:bg-transparent'
  return (
    <div className="relative flex items-center" ref={menuRef}>
      <Tooltip content={h.undo[0] ? `Undo: ${h.undo[0]} (Ctrl+Z)` : 'Nothing to undo'} side="bottom">
        <button type="button" className={btn} aria-label="Undo" disabled={!h.undo.length || h.busy} onClick={() => void h.run('undo')}>
          <Undo2 className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip content={h.redo[0] ? `Redo: ${h.redo[0]} (Ctrl+Shift+Z)` : 'Nothing to redo'} side="bottom">
        <button type="button" className={btn} aria-label="Redo" disabled={!h.redo.length || h.busy} onClick={() => void h.run('redo')}>
          <Redo2 className="h-4 w-4" />
        </button>
      </Tooltip>
      <button
        type="button"
        className={`${btn} px-0.5`}
        aria-label="Edit history"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-[10px] border border-border bg-elevated p-1.5 text-xs shadow-[var(--shadow-panel)]">
          <div className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 font-medium text-muted">
            <History className="h-3.5 w-3.5" /> Edit history
          </div>
          <ul className="m-0 max-h-80 list-none overflow-y-auto p-0">
            {[...h.redo].reverse().map((l, i) => (
              <li key={`r${i}`}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1 text-left text-muted line-through hover:bg-fg/5 hover:no-underline"
                  title="Redo up to here"
                  onClick={async () => {
                    setOpen(false)
                    for (let n = 0; n < h.redo.length - i; n++) await h.run('redo')
                  }}
                >
                  {l}
                </button>
              </li>
            ))}
            <li className="px-2 py-1 text-[10px] text-accent-soft">Now</li>
            {h.undo.map((l, i) => (
              <li key={`u${i}`}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1 text-left text-fg-soft hover:bg-fg/5"
                  title="Undo back to before this"
                  onClick={async () => {
                    setOpen(false)
                    for (let n = 0; n <= i; n++) await h.run('undo')
                  }}
                >
                  {l}
                </button>
              </li>
            ))}
          </ul>
          {!h.undo.length && !h.redo.length && <p className="m-0 px-2 py-1 text-muted">No edits this session.</p>}
          <SnapshotSection onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

function SnapshotSection({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const snaps = useQuery({ queryKey: ['snapshots'], queryFn: api.listSnapshots, staleTime: 0 })
  const [name, setName] = useState('')
  const save = useMutation({
    mutationFn: () => api.createSnapshot(name.trim() || 'Snapshot'),
    onSuccess: (s) => {
      setName('')
      void qc.invalidateQueries({ queryKey: ['snapshots'] })
      toast({ title: `Saved snapshot “${s.label}”`, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save the snapshot', description: e.message, tone: 'danger' }),
  })
  const restore = useMutation({
    mutationKey: ['edit-history'],
    mutationFn: (id: string) => api.restoreSnapshot(id),
    onSuccess: (s) => {
      refreshAfterEdit(qc)
      void qc.invalidateQueries({ queryKey: ['snapshots'] })
      toast({ title: `Restored “${s.label}”`, description: 'Undo puts the model back the way it was.', tone: 'success' })
      onDone()
    },
    onError: (e: Error) => toast({ title: 'Couldn’t restore', description: e.message, tone: 'danger' }),
  })
  const list = snaps.data?.snapshots ?? []
  return (
    <div className="mt-1.5 border-t border-border pt-1.5">
      <div className="px-2 pb-1 font-medium text-muted">Snapshots</div>
      <form
        className="flex gap-1 px-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name this version"
          aria-label="Snapshot name"
          className="field h-7 flex-1 text-[12px]"
        />
        <button type="submit" disabled={save.isPending} className="h-7 rounded-md bg-accent px-2 text-[12px] font-medium text-white hover:bg-accent-strong disabled:opacity-50">
          Save
        </button>
      </form>
      <ul className="m-0 max-h-52 list-none overflow-y-auto p-0">
        {list.map((s) => (
          <li key={s.id} className="group flex items-center gap-1 rounded-md px-2 py-1 hover:bg-fg/5">
            <div className="min-w-0 flex-1">
              <div className={`truncate ${s.auto ? 'text-muted' : 'text-fg-soft'}`}>{s.label}</div>
              <div className="text-[10px] text-muted">{new Date(s.created).toLocaleString()}</div>
            </div>
            <button
              type="button"
              disabled={restore.isPending}
              onClick={() => restore.mutate(s.id)}
              className="rounded px-1.5 py-0.5 text-[11px] text-accent-soft opacity-0 hover:bg-fg/[0.06] group-hover:opacity-100 focus:opacity-100"
            >
              Restore
            </button>
          </li>
        ))}
        {!list.length && <li className="px-2 py-1 text-muted">None yet. One is saved before every run.</li>}
      </ul>
    </div>
  )
}
