/**
 * Scenario switcher (header) and manager dialog.
 *
 * Every scenario is a complete SWMM .inp in its own folder; children inherit
 * from their parent through "Update from parent" (a three-way merge).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, GitBranch, GitMerge, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, type Scenario, type ScenarioChange, type ScenarioList } from '../api/client'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { AlertDialog, Button, Dialog, DialogContent, useToast } from './ui'

function useScenarios(enabled = true) {
  return useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios, enabled, retry: false })
}

function tree(list: Scenario[]): { s: Scenario; depth: number }[] {
  const byParent = new Map<string | null, Scenario[]>()
  for (const s of list) byParent.set(s.parent, [...(byParent.get(s.parent) ?? []), s])
  const out: { s: Scenario; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const s of byParent.get(parent) ?? []) {
      out.push({ s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const CHANGE_LABEL: Record<ScenarioChange['change'], string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Changed',
}

function ChangeList({ items, empty }: { items: ScenarioChange[]; empty: string }) {
  if (!items.length) return <p className="m-0 text-xs text-muted">{empty}</p>
  const bySection = new Map<string, ScenarioChange[]>()
  for (const c of items) bySection.set(c.section, [...(bySection.get(c.section) ?? []), c])
  return (
    <div className="max-h-56 space-y-2 overflow-y-auto text-xs">
      {[...bySection.entries()].map(([sec, cs]) => (
        <div key={sec}>
          <div className="font-medium text-fg-soft">
            [{sec}] <span className="font-normal text-muted">· {cs.length}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {cs.slice(0, 60).map((c) => (
              <span
                key={c.id + c.change}
                className={`rounded px-1.5 py-0.5 ${
                  c.change === 'added'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : c.change === 'removed'
                      ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-sky-500/15 text-sky-200'
                }`}
                title={CHANGE_LABEL[c.change]}
              >
                {c.id === '*' ? 'section' : c.id}
              </span>
            ))}
            {cs.length > 60 && <span className="text-muted">+{cs.length - 60} more</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function ScenarioDetail({ s, list, onChanged }: { s: Scenario; list: ScenarioList; onChanged: (d: ScenarioList) => void }) {
  const { toast } = useToast()
  const diff = useQuery({ queryKey: ['scenario-diff', s.id], queryFn: () => api.scenarioDiff(s.id), enabled: Boolean(s.parent) })
  const parent = list.scenarios.find((p) => p.id === s.parent)
  const sync = useMutation({
    mutationFn: () => api.syncScenario(s.id),
    onSuccess: (d) => {
      onChanged(d)
      void diff.refetch()
      toast({
        title: d.applied.length ? `Pulled ${d.applied.length} change${d.applied.length > 1 ? 's' : ''} from ${parent?.name}` : 'Already up to date with its parent',
        description: d.conflicts.length
          ? `${d.conflicts.length} object${d.conflicts.length > 1 ? 's were' : ' was'} changed in both; this scenario's version was kept: ${d.conflicts.slice(0, 8).map((c) => c.id).join(', ')}`
          : undefined,
        tone: d.conflicts.length ? 'default' : 'success',
      })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t update from parent', description: e.message, tone: 'danger' }),
  })
  if (!s.parent) {
    return (
      <p className="m-0 text-xs text-muted">
        Base is the project’s own <code>{s.inp}</code>. Create a child scenario to try a change without touching it.
      </p>
    )
  }
  const pending = diff.data?.parent_updates.length ?? 0
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-xs font-semibold text-fg">Differences from {parent?.name ?? 'parent'}</div>
        {diff.isLoading ? (
          <p className="m-0 text-xs text-muted">Comparing…</p>
        ) : (
          <ChangeList items={diff.data?.vs_parent ?? []} empty="Identical to its parent." />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
        <GitMerge className="h-4 w-4 text-muted" />
        <span className="min-w-0 flex-1 text-xs text-fg-soft">
          {pending
            ? `${parent?.name} has ${pending} change${pending > 1 ? 's' : ''} since this scenario was created or last updated.`
            : `Up to date with ${parent?.name}.`}{' '}
          Updating keeps everything you changed here.
        </span>
        <Button size="sm" variant={pending ? 'primary' : 'outline'} disabled={sync.isPending} onClick={() => sync.mutate()}>
          Update from parent
        </Button>
      </div>
      <p className="m-0 text-[11px] text-muted">
        File: <code>{s.inp}</code> — a complete SWMM model you can open in any SWMM tool.
      </p>
    </div>
  )
}

export function ScenarioManager({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const list = useScenarios(open)
  const [focus, setFocus] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Scenario | null>(null)

  const data = list.data
  const rows = useMemo(() => (data ? tree(data.scenarios) : []), [data])
  const selected = data?.scenarios.find((s) => s.id === (focus ?? data.active)) ?? data?.scenarios[0]

  const applied = (d: ScenarioList, switched: boolean) => {
    qc.setQueryData(['scenarios'], d)
    if (switched) invalidateProjectQueries(qc)
  }

  const activate = useMutation({
    mutationFn: (id: string) => api.setActiveScenario(id),
    onSuccess: (d) => {
      applied(d, true)
      toast({ title: `Now working in “${d.scenarios.find((s) => s.id === d.active)?.name}”`, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t switch scenario', description: e.message, tone: 'danger' }),
  })
  const create = useMutation({
    mutationFn: () => api.createScenario(newName, selected?.id),
    onSuccess: (d) => {
      applied(d, true)
      setNewName('')
      setFocus(d.active)
      toast({ title: `Created “${d.scenarios.find((s) => s.id === d.active)?.name}” and switched to it`, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t create scenario', description: e.message, tone: 'danger' }),
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.updateScenario(id, { name }),
    onSuccess: (d) => {
      applied(d, false)
      setRenaming(null)
      void qc.invalidateQueries({ queryKey: ['project'] })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t rename', description: e.message, tone: 'danger' }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteScenario(id),
    onSuccess: (d) => {
      applied(d, true)
      setConfirmDelete(null)
      setFocus(null)
      toast({ title: 'Scenario deleted', description: 'Its folder was moved to scenarios/.deleted.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t delete', description: e.message, tone: 'danger' }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Scenarios"
        description="Try changes in a copy of the model. Each scenario is a full SWMM file with its own results; children can pull later changes from their parent."
        className="w-[min(860px,calc(100vw-2rem))]"
      >
        {!data ? (
          <p className="text-sm text-muted">{list.isError ? (list.error as Error).message : 'Loading…'}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
            <div>
              <ul className="m-0 list-none space-y-0.5 p-0">
                {rows.map(({ s, depth }) => (
                  <li key={s.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                        selected?.id === s.id ? 'bg-accent/15 text-fg' : 'text-fg-soft hover:bg-fg/5'
                      }`}
                      style={{ paddingLeft: 8 + depth * 16 }}
                    >
                      {depth > 0 && <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted" />}
                      {renaming === s.id ? (
                        <input
                          autoFocus
                          value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') rename.mutate({ id: s.id, name: renameText })
                            if (e.key === 'Escape') setRenaming(null)
                          }}
                          onBlur={() => setRenaming(null)}
                          className="h-7 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-sm text-fg"
                        />
                      ) : (
                        <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setFocus(s.id)}>
                          {s.name}
                          {data.active === s.id && <span className="ml-2 text-[10px] text-accent-soft">active</span>}
                          {s.has_results && <span className="ml-2 text-[10px] text-muted">results</span>}
                        </button>
                      )}
                      {s.id !== 'base' && renaming !== s.id && (
                        <span className="flex opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            title="Rename"
                            className="rounded p-1 text-muted hover:text-fg"
                            onClick={() => {
                              setRenaming(s.id)
                              setRenameText(s.name)
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" title="Delete" className="rounded p-1 text-muted hover:text-danger" onClick={() => setConfirmDelete(s)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (newName.trim()) create.mutate()
                }}
              >
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`New child of ${selected?.name ?? 'Base'}`}
                  aria-label="New scenario name"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm text-fg outline-none focus:border-accent"
                />
                <Button size="sm" variant="outline" type="submit" disabled={!newName.trim() || create.isPending}>
                  <Plus className="h-3.5 w-3.5" /> Create
                </Button>
              </form>
            </div>
            {selected && (
              <div className="min-w-0 space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="m-0 flex-1 truncate text-base font-semibold text-fg">{selected.name}</h3>
                  {data.active !== selected.id && (
                    <Button size="sm" variant="primary" disabled={activate.isPending} onClick={() => activate.mutate(selected.id)}>
                      Switch to this scenario
                    </Button>
                  )}
                </div>
                <ScenarioDetail s={selected} list={data} onChanged={(d) => applied(d, data.active === selected.id)} />
              </div>
            )}
          </div>
        )}
        <AlertDialog
          open={Boolean(confirmDelete)}
          onOpenChange={(o) => !o && setConfirmDelete(null)}
          title={`Delete “${confirmDelete?.name}”?`}
          description="Its folder (model and results) is moved to scenarios/.deleted inside the project, so you can still recover it from there."
          confirming={remove.isPending}
          onConfirm={() => confirmDelete && remove.mutate(confirmDelete.id)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Header control: shows the active scenario and opens the manager. */
export function ScenarioSwitcher({ name }: { name?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Scenarios"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-soft hover:bg-fg/[0.06] hover:text-fg"
      >
        <GitBranch className="h-3.5 w-3.5 text-muted" />
        {name ?? 'Base'}
        <ChevronDown className="h-3 w-3 text-muted" />
      </button>
      {open && <ScenarioManager open={open} onOpenChange={setOpen} />}
    </>
  )
}
