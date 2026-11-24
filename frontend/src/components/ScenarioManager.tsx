/**
 * The scenario tree and what can be done with it.
 *
 * Every scenario is a complete SWMM .inp in its own folder. A child inherits
 * from its parent field by field: a change in the parent reaches every child
 * on its own, except where the child has its own value.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Copy, Crown, GitBranch, GitBranchPlus, Lock, LockOpen, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Scenario, type ScenarioList } from '../api/client'
import { cn } from '../lib/cn'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { ChangesPanel } from './scenarios/ChangesPanel'
import { AlertDialog, Button, Dialog, DialogContent, Tooltip, useToast } from './ui'

function useScenarios(enabled = true) {
  return useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios, enabled, retry: false })
}

export function scenarioTree(list: Scenario[]): { s: Scenario; depth: number }[] {
  const out: { s: Scenario; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const s of list.filter((x) => (x.parent ?? null) === parent)) {
      out.push({ s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  for (const s of list) if (!out.some((o) => o.s.id === s.id)) out.push({ s, depth: 0 })
  return out
}

/** "Base / Growth / Option B". */
export function scenarioPath(list: Scenario[], id: string): Scenario[] {
  const out: Scenario[] = []
  let cur = list.find((s) => s.id === id)
  while (cur && out.length < 20) {
    out.unshift(cur)
    cur = cur.parent ? list.find((s) => s.id === cur!.parent) : undefined
  }
  return out
}

/** Small marks after a scenario's name: locked, its own changes, the parent changed something, results. */
export function ScenarioBadges({ s, dot = true }: { s: Scenario; /** The results dot (left out where the row shows its own). */ dot?: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-muted">
      {s.locked && <Lock className="h-3 w-3" aria-label="locked" />}
      {(s.flags ?? 0) > 0 && (
        <span className="rounded-full bg-warning/20 px-1.5 font-medium text-warning" title={`The parent changed ${s.flags} value${s.flags === 1 ? '' : 's'} this scenario has its own value for`}>
          {s.flags}!
        </span>
      )}
      {s.parent && (s.changes ?? 0) > 0 && <span title={`${s.changes} change${s.changes === 1 ? '' : 's'} from its parent`}>{s.changes} changed</span>}
      {dot && <span
        className={cn('h-2 w-2 rounded-full', !s.has_results ? 'border border-border-strong' : s.results_stale ? 'bg-warning' : 'bg-success')}
        title={!s.has_results ? 'Not run yet' : s.results_stale ? 'Results out of date: the model changed after the run' : 'Results up to date'}
      />}
    </span>
  )
}

function NameDialog({ open, title, description, initial, action, busy, onCancel, onSubmit }: { open: boolean; title: string; description: string; initial: string; action: string; busy: boolean; onCancel: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial)
  useEffect(() => setV(initial), [initial, open])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title={title} description={description} className="w-[min(26rem,calc(100vw-2rem))]">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (v.trim()) onSubmit(v.trim())
          }}
        >
          <input autoFocus aria-label="Name" className="field h-9 w-full" value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!v.trim() || busy}>
              {action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Ask =
  | { kind: 'child' | 'duplicate' | 'insert' | 'rename'; s: Scenario }
  | null

export function ScenarioManager({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const list = useScenarios(open)
  const [focus, setFocus] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'branch' | 'base'; s: Scenario } | null>(null)
  const [menu, setMenu] = useState<{ s: Scenario; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const data = list.data
  const rows = useMemo(() => (data ? scenarioTree(data.scenarios) : []), [data])
  const selected = data?.scenarios.find((s) => s.id === (focus ?? data.active)) ?? data?.scenarios[0]
  const byId = (id: string | null | undefined) => data?.scenarios.find((s) => s.id === id)
  const stale = (data?.scenarios ?? []).filter((s) => s.has_results && s.results_stale)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const after = (d: ScenarioList, title?: string, description?: string) => {
    qc.setQueryData(['scenarios'], d)
    void qc.invalidateQueries({ queryKey: ['inheritance'] })
    void qc.invalidateQueries({ queryKey: ['run-matrix'] })
    invalidateProjectQueries(qc)
    if (title) toast({ title, description, tone: 'success' })
  }
  const fail = (title: string) => (e: Error) => toast({ title, error: e, description: e.message, tone: 'danger' })

  const activate = useMutation({ mutationFn: (id: string) => api.setActiveScenario(id), onSuccess: (d) => after(d, `Now working in “${byId(d.active)?.name ?? d.active}”`), onError: fail('Couldn’t switch scenario') })
  const create = useMutation({
    mutationFn: ({ name, parent }: { name: string; parent: string }) => api.createScenario(name, parent),
    onSuccess: (d) => (after(d, `Created “${d.scenarios.find((s) => s.id === d.active)?.name}” and switched to it`, 'It follows its parent until you change something here.'), setAsk(null), setFocus(d.active)),
    onError: fail('Couldn’t create the scenario'),
  })
  const duplicate = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.duplicateScenario(id, name), onSuccess: (d) => (after(d, 'Duplicated, with the same changes and the same parent'), setAsk(null), setFocus(d.active)), onError: fail('Couldn’t duplicate') })
  const insert = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.insertParentScenario(id, name), onSuccess: (d) => (after(d, 'Added a scenario above it', 'Changes made there reach everything below.'), setAsk(null), setFocus(d.active)), onError: fail('Couldn’t add the parent') })
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.updateScenario(id, { name }), onSuccess: (d) => (after(d), setAsk(null)), onError: fail('Couldn’t rename') })
  const lock = useMutation({
    mutationFn: ({ id, locked }: { id: string; locked: boolean }) => api.lockScenario(id, locked),
    onSuccess: (d, v) => after(d, v.locked ? 'Locked' : 'Unlocked', v.locked ? 'It can’t be changed, and waits for its parent’s changes until unlocked.' : 'It has taken any changes its parent made meanwhile.'),
    onError: fail('Couldn’t change the lock'),
  })
  const reparent = useMutation({
    mutationFn: ({ id, parent }: { id: string; parent: string }) => api.reparentScenario(id, parent),
    onSuccess: (d, v) => after(d, `Moved under “${byId(v.parent)?.name ?? v.parent}”`, 'Its own changes came along; everything else now comes from its new parent. Undo in its History if needed.'),
    onError: fail('Couldn’t move it'),
  })
  const makeBase = useMutation({
    mutationFn: (id: string) => api.makeBase(id),
    onSuccess: (d) => (after(d, 'Base updated', 'Base’s previous model is kept in scenarios/.deleted. Every other scenario has taken the change.'), setConfirm(null)),
    onError: fail('Couldn’t make it the Base'),
  })
  const remove = useMutation({
    mutationFn: ({ id, branch }: { id: string; branch: boolean }) => api.deleteScenario(id, branch),
    onSuccess: (d) => (after(d, 'Deleted', 'Its folder was moved to scenarios/.deleted, so it can still be recovered.'), setConfirm(null), setFocus(null)),
    onError: fail('Couldn’t delete'),
  })
  const runStale = useMutation({
    mutationFn: () => api.startBatch(stale.map((s) => ({ scenario: s.id, storm: 'model' }))),
    onSuccess: () => (toast({ title: `Running ${stale.length} scenario${stale.length === 1 ? '' : 's'}`, tone: 'success' }), navigate('/runs'), onOpenChange(false)),
    onError: fail('Couldn’t start the runs'),
  })

  const actions = (s: Scenario): { label: string; icon: ReactNode; on: () => void; danger?: boolean; hide?: boolean }[] => [
    { label: 'Switch to it', icon: <Play className="h-3.5 w-3.5" />, on: () => activate.mutate(s.id), hide: s.id === data?.active },
    { label: 'New child…', icon: <GitBranchPlus className="h-3.5 w-3.5" />, on: () => setAsk({ kind: 'child', s }) },
    { label: 'Duplicate…', icon: <Copy className="h-3.5 w-3.5" />, on: () => setAsk({ kind: 'duplicate', s }), hide: !s.parent },
    { label: 'Add a parent above…', icon: <GitBranch className="h-3.5 w-3.5" />, on: () => setAsk({ kind: 'insert', s }), hide: !s.parent },
    { label: 'Rename…', icon: <Pencil className="h-3.5 w-3.5" />, on: () => setAsk({ kind: 'rename', s }), hide: !s.parent },
    { label: s.locked ? 'Unlock' : 'Lock', icon: s.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />, on: () => lock.mutate({ id: s.id, locked: !s.locked }), hide: !s.parent },
    { label: 'Make this the Base…', icon: <Crown className="h-3.5 w-3.5" />, on: () => setConfirm({ kind: 'base', s }), hide: !s.parent },
    { label: s.children?.length ? 'Delete with its children…' : 'Delete…', icon: <Trash2 className="h-3.5 w-3.5" />, on: () => setConfirm({ kind: s.children?.length ? 'branch' : 'delete', s }), danger: true, hide: !s.parent },
  ]

  const canDrop = (target: string) => {
    if (!drag || !data || drag === target) return false
    // Not into its own branch.
    let cur = byId(target)
    while (cur) {
      if (cur.id === drag) return false
      cur = byId(cur.parent)
    }
    return byId(drag)?.parent !== target
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Scenarios"
        description="Each scenario is a full SWMM model that follows its parent: a change in a parent reaches every scenario below it, except where one has its own value."
        className="w-[min(1000px,calc(100vw-2rem))]"
      >
        {!data ? (
          <p className="text-sm text-muted">{list.isError ? (list.error as Error).message : 'Loading…'}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[20rem_1fr]">
            <div className="min-w-0">
              <ul className="m-0 list-none space-y-0.5 p-0" aria-label="Scenario tree">
                {rows.map(({ s, depth }) => (
                  <li
                    key={s.id}
                    draggable={Boolean(s.parent)}
                    onDragStart={(e) => {
                      setDrag(s.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => (setDrag(null), setOver(null))}
                    onDragOver={(e) => {
                      if (canDrop(s.id)) {
                        e.preventDefault()
                        setOver(s.id)
                      }
                    }}
                    onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (drag && canDrop(s.id)) reparent.mutate({ id: drag, parent: s.id })
                      setDrag(null)
                      setOver(null)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setFocus(s.id)
                      setMenu({ s, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <div
                      className={cn(
                        'group flex items-center gap-1.5 rounded-md py-1.5 pr-1 text-[13px]',
                        selected?.id === s.id ? 'bg-accent/15 text-fg' : 'text-fg-soft hover:bg-fg/5',
                        over === s.id && 'ring-2 ring-accent',
                        drag === s.id && 'opacity-50',
                      )}
                      style={{ paddingLeft: 8 + depth * 16 }}
                    >
                      {depth > 0 && <span className="h-3 w-2 shrink-0 rounded-bl border-b border-l border-border-strong" aria-hidden />}
                      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setFocus(s.id)} onDoubleClick={() => s.id !== data.active && activate.mutate(s.id)} title={s.parent ? 'Drag onto another scenario to move it there. Right-click for more.' : 'Right-click for more'}>
                        <span className={cn(data.active === s.id && 'font-semibold text-fg')}>{s.name}</span>
                        {data.active === s.id && <span className="ml-1.5 text-[10px] text-accent-soft">open</span>}
                      </button>
                      <ScenarioBadges s={s} />
                      <button
                        type="button"
                        aria-label={`More for ${s.name}`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted opacity-0 hover:bg-fg/[0.08] hover:text-fg group-hover:opacity-100"
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setFocus(s.id)
                          setMenu({ s, x: r.left, y: r.bottom + 4 })
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-2 px-1 text-[11px] text-muted">Drag a scenario onto another to move it. Right-click for more.</p>
              {stale.length > 0 && (
                <Button className="mt-3 w-full justify-center" size="sm" variant="outline" disabled={runStale.isPending} onClick={() => runStale.mutate()}>
                  <Play className="h-3.5 w-3.5" /> Run the {stale.length} out-of-date scenario{stale.length === 1 ? '' : 's'}
                </Button>
              )}
            </div>
            {selected && (
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] text-muted">
                      {scenarioPath(data.scenarios, selected.id)
                        .map((x) => x.name)
                        .join(' / ')}
                    </div>
                    <h3 className="m-0 flex items-center gap-2 truncate text-base font-semibold text-fg">
                      {selected.name}
                      {selected.locked && (
                        <Tooltip content="Locked: it can’t be changed, and waits for its parent’s changes until unlocked">
                          <Lock className="h-3.5 w-3.5 text-muted" />
                        </Tooltip>
                      )}
                    </h3>
                  </div>
                  {data.active !== selected.id && (
                    <Button size="sm" variant="primary" disabled={activate.isPending} onClick={() => activate.mutate(selected.id)}>
                      Switch to it
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setAsk({ kind: 'child', s: selected })}>
                    <Plus className="h-3.5 w-3.5" /> New child
                  </Button>
                </div>
                {selected.parent ? (
                  <ChangesPanel
                    sid={selected.id}
                    parentName={byId(selected.parent)?.name ?? 'its parent'}
                    locked={selected.locked}
                    onShow={
                      selected.id === data.active
                        ? (c) => {
                            onOpenChange(false)
                            if (!c.object) return
                            navigate('/map')
                            window.setTimeout(() => window.dispatchEvent(new CustomEvent('saturday-swmm-select', { detail: { object_type: c.object, id: c.id } })), 400)
                          }
                        : undefined
                    }
                  />
                ) : (
                  <p className="m-0 text-[12.5px] leading-relaxed text-fg-soft">
                    Base is the project’s own model. Every change made here reaches the scenarios below it, except where one has its own value.
                    {selected.children?.length ? ` ${selected.children.length} scenario${selected.children.length === 1 ? ' follows' : 's follow'} it directly.` : ' Make a child to try a change without touching it.'}
                  </p>
                )}
                <p className="m-0 text-[11px] text-muted">
                  File: <code>{selected.inp}</code>, a complete SWMM model that opens in any SWMM tool.
                </p>
              </div>
            )}
          </div>
        )}

        {menu && (
          <div
            role="menu"
            className="fixed z-[200] min-w-[14rem] rounded-lg border border-border bg-elevated p-1 text-[13px] shadow-[var(--shadow-panel)]"
            style={{ left: menu.x, top: menu.y }}
            ref={(el) => {
              // The dialog is transformed, so "fixed" is relative to it: measure and move into view.
              if (!el || el.dataset.placed === `${menu.x},${menu.y}`) return
              el.dataset.placed = `${menu.x},${menu.y}`
              const r = el.getBoundingClientRect()
              const wantX = Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8))
              const wantY = Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8))
              el.style.left = `${menu.x + (wantX - r.left)}px`
              el.style.top = `${menu.y + (wantY - r.top)}px`
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {actions(menu.s)
              .filter((a) => !a.hide)
              .map((a) => (
                <button
                  key={a.label}
                  type="button"
                  role="menuitem"
                  onClick={() => (setMenu(null), a.on())}
                  className={cn('flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-fg/[0.06]', a.danger ? 'text-danger hover:bg-danger/10' : 'text-fg')}
                >
                  <span className="text-muted">{a.icon}</span>
                  {a.label}
                </button>
              ))}
          </div>
        )}

        <NameDialog
          open={ask?.kind === 'child'}
          title="New child scenario"
          description={`It starts as an exact copy of “${ask?.s.name}” and follows its changes, except where you change it.`}
          initial={ask ? `${ask.s.name} – option` : ''}
          action="Create"
          busy={create.isPending}
          onCancel={() => setAsk(null)}
          onSubmit={(name) => ask && create.mutate({ name, parent: ask.s.id })}
        />
        <NameDialog
          open={ask?.kind === 'duplicate'}
          title="Duplicate scenario"
          description={`A copy of “${ask?.s.name}” with the same changes, next to it under the same parent.`}
          initial={ask ? `${ask.s.name} copy` : ''}
          action="Duplicate"
          busy={duplicate.isPending}
          onCancel={() => setAsk(null)}
          onSubmit={(name) => ask && duplicate.mutate({ id: ask.s.id, name })}
        />
        <NameDialog
          open={ask?.kind === 'insert'}
          title="Add a parent above"
          description={`A new scenario between “${ask?.s.name}” and “${byId(ask?.s.parent)?.name}”. It starts as a copy of “${byId(ask?.s.parent)?.name}”; changes made in it reach “${ask?.s.name}”.`}
          initial={ask ? `${byId(ask.s.parent)?.name ?? 'Base'} – shared` : ''}
          action="Add"
          busy={insert.isPending}
          onCancel={() => setAsk(null)}
          onSubmit={(name) => ask && insert.mutate({ id: ask.s.id, name })}
        />
        <NameDialog
          open={ask?.kind === 'rename'}
          title="Rename scenario"
          description="Only the name changes; its folder stays where it is."
          initial={ask?.s.name ?? ''}
          action="Rename"
          busy={rename.isPending}
          onCancel={() => setAsk(null)}
          onSubmit={(name) => ask && rename.mutate({ id: ask.s.id, name })}
        />
        <AlertDialog
          open={Boolean(confirm)}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={
            confirm?.kind === 'base'
              ? `Make “${confirm.s.name}” the Base?`
              : confirm?.kind === 'branch'
                ? `Delete “${confirm?.s.name}” and the ${confirm?.s.children?.length ?? 0} below it?`
                : `Delete “${confirm?.s.name}”?`
          }
          description={
            confirm?.kind === 'base'
              ? 'Base’s model becomes this scenario’s, and every other scenario takes that change, keeping its own values. Base’s current model is saved in scenarios/.deleted, and Undo in Base takes it back.'
              : 'Its folder (model and results) is moved to scenarios/.deleted inside the project, so it can still be recovered from there.'
          }
          confirmLabel={confirm?.kind === 'base' ? 'Make it the Base' : 'Delete'}
          confirming={remove.isPending || makeBase.isPending}
          onConfirm={() => {
            if (!confirm) return
            if (confirm.kind === 'base') makeBase.mutate(confirm.s.id)
            else remove.mutate({ id: confirm.s.id, branch: confirm.kind === 'branch' })
          }}
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
