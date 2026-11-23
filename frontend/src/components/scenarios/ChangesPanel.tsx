/** A scenario's own changes from its parent, element by element, with what can be done with each. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpToLine, Copy, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, type ChangeRef, type InheritedChange, type InheritFlag } from '../../api/client'
import { cn } from '../../lib/cn'
import { invalidateProjectQueries } from '../../lib/projectQueries'
import { Button, Tooltip, useToast } from '../ui'

const fmt = (v: string | string[] | null | undefined) => (Array.isArray(v) ? `${v.length} line${v.length === 1 ? '' : 's'}` : v == null || v === '' ? '—' : v)
const ref = (c: { section: string; id: string; field: number | null }): ChangeRef => ({ section: c.section, id: c.id, field: c.field })
const KIND_LABEL: Record<string, string> = { node: 'Node', link: 'Link', subcatchment: 'Subcatchment' }

export function useScenarioActions(sid: string) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const done = (title: string, description?: string) => {
    for (const k of ['inheritance', 'scenarios', 'run-matrix']) void qc.invalidateQueries({ queryKey: [k] })
    invalidateProjectQueries(qc)
    toast({ title, description, tone: 'success' })
  }
  const fail = (title: string) => (e: Error) => toast({ title, error: e, description: e.message, tone: 'danger' })
  const n = (items: ChangeRef[]) => `${items.length} change${items.length === 1 ? '' : 's'}`
  return {
    reset: useMutation({
      mutationFn: (items: ChangeRef[]) => api.resetChanges(sid, items),
      onSuccess: (r, items) => done(`Reset ${n(items)}`, `They follow ${r.parent_name ?? 'the parent'} again.`),
      onError: fail('Couldn’t reset'),
    }),
    keep: useMutation({
      mutationFn: (items: ChangeRef[]) => api.keepMine(sid, items),
      onSuccess: () => done('Kept your values'),
      onError: fail('Couldn’t keep them'),
    }),
    push: useMutation({
      mutationFn: (items: ChangeRef[]) => api.pushToParent(sid, items),
      onSuccess: (r, items) => done(`Moved ${n(items)} up to ${r.parent_name ?? 'the parent'}`, 'Its other children now have them too.'),
      onError: fail('Couldn’t move them up'),
    }),
    siblings: useMutation({
      mutationFn: (items: ChangeRef[]) => api.applyToSiblings(sid, items),
      onSuccess: (r, items) => done(r.applied_to.length ? `Made ${n(items)} in ${r.applied_to.join(', ')}` : 'There are no other unlocked scenarios beside this one'),
      onError: fail('Couldn’t apply them'),
    }),
  }
}

function FlagRow({ f, sid }: { f: InheritFlag; sid: string }) {
  const a = useScenarioActions(sid)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning/40 bg-warning/[0.07] px-3 py-2 text-[12.5px]">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg">{f.id}</span> <span className="text-muted">· {f.label}</span>
        <span className="block text-[11.5px] text-fg-soft">
          {f.kind === 'removed_in_parent'
            ? 'The parent removed this element, so your changes to it went with it.'
            : <>The parent changed it from {fmt(f.parent_old)} to <strong>{fmt(f.parent_new)}</strong>; yours is <strong>{fmt(f.mine)}</strong>.</>}
        </span>
      </span>
      {f.kind !== 'removed_in_parent' && (
        <Button size="sm" variant="outline" disabled={a.reset.isPending} onClick={() => a.reset.mutate([ref(f)])}>
          Take parent’s
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={a.keep.isPending} onClick={() => a.keep.mutate([ref(f)])}>
        {f.kind === 'removed_in_parent' ? 'OK' : 'Keep mine'}
      </Button>
    </li>
  )
}

export function ChangesPanel({ sid, parentName, locked, onShow }: { sid: string; parentName: string; locked?: boolean; onShow?: (c: InheritedChange) => void }) {
  const q = useQuery({ queryKey: ['inheritance', sid], queryFn: () => api.scenarioInheritance(sid), retry: false })
  const a = useScenarioActions(sid)
  const nChanges = useMemo(
    () => new Set((q.data?.changes ?? []).map((c) => `${c.object ?? c.section}|${c.id}|${c.change === 'modified' ? c.key ?? c.field : c.change}`)).size,
    [q.data],
  )
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const key = (c: InheritedChange) => `${c.section}|${c.id}|${c.field ?? '*'}`
  const changes = useMemo(() => {
    const all = q.data?.changes ?? []
    const f = filter.trim().toLowerCase()
    return f ? all.filter((c) => `${c.id} ${c.label ?? ''} ${c.section}`.toLowerCase().includes(f)) : all
  }, [q.data, filter])
  // Group by element.
  const groups = useMemo(() => {
    const m = new Map<string, InheritedChange[]>()
    for (const c of changes) {
      const k = `${c.object ?? c.section}:${c.id}`
      m.set(k, [...(m.get(k) ?? []), c])
    }
    return [...m.entries()]
  }, [changes])
  const items = (cs: InheritedChange[]) => cs.map(ref)
  const sel = changes.filter((c) => picked.has(key(c)))
  const busy = a.reset.isPending || a.push.isPending || a.siblings.isPending

  if (q.isLoading) return <p className="m-0 text-xs text-muted">Loading…</p>
  const flags = q.data?.flags ?? []
  return (
    <div className="space-y-3">
      {q.data?.behind ? (
        <p className="m-0 rounded-lg border border-border bg-fg/[0.03] px-3 py-2 text-[12px] text-fg-soft">
          Locked: {q.data.behind} change{q.data.behind === 1 ? '' : 's'} in {parentName} {q.data.behind === 1 ? 'is' : 'are'} waiting. Unlock to take {q.data.behind === 1 ? 'it' : 'them'}.
        </p>
      ) : null}
      {flags.length > 0 && (
        <div>
          <h4 className="m-0 mb-1.5 text-[12px] font-semibold text-fg">{parentName} changed {flags.length === 1 ? 'something' : `${flags.length} things`} you had changed too</h4>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {flags.map((f) => (
              <FlagRow key={`${f.section}|${f.id}|${f.field}`} f={f} sid={sid} />
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="m-0 flex-1 text-[12px] font-semibold text-fg">
          {nChanges ? `${nChanges} change${nChanges === 1 ? '' : 's'} from ${parentName}` : q.data?.locked && q.data.behind ? 'No changes of its own' : `Same as ${parentName}`}
        </h4>
        {(q.data?.changes.length ?? 0) > 8 && (
          <input className="field h-7 w-40 text-[12px]" placeholder="Filter by ID" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter changes" />
        )}
      </div>
      {!q.data?.changes.length ? (
        <p className="m-0 text-[12px] text-muted">Everything here comes from {parentName}: change a value in this scenario and it shows up here.</p>
      ) : (
        <>
          {sel.length > 0 && !locked && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/[0.07] px-2.5 py-1.5 text-[12px]">
              <span className="font-medium text-fg">{sel.length} selected</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => (a.reset.mutate(items(sel)), setPicked(new Set()))}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset to {parentName}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => (a.push.mutate(items(sel)), setPicked(new Set()))}>
                <ArrowUpToLine className="h-3.5 w-3.5" /> Push to {parentName}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => (a.siblings.mutate(items(sel)), setPicked(new Set()))}>
                <Copy className="h-3.5 w-3.5" /> Apply to siblings
              </Button>
            </div>
          )}
          <ul className="m-0 max-h-[22rem] list-none divide-y divide-border/70 overflow-y-auto rounded-lg border border-border p-0">
            {groups.map(([g, cs]) => {
              const first = cs[0]
              return (
                <li key={g} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-fg hover:text-accent-soft" onClick={() => onShow?.(first)} disabled={!onShow || first.change === 'removed'}>
                      {first.object ? `${KIND_LABEL[first.object]} ` : `[${first.section}] `}
                      {first.id === '*' ? 'whole section' : first.id}
                    </button>
                    {first.change !== 'modified' && (
                      <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-medium', first.change === 'added' ? 'bg-success/15 text-success' : 'bg-danger/12 text-danger')}>
                        {first.change === 'added' ? 'Added here' : 'Removed here'}
                      </span>
                    )}
                  </div>
                  {cs.some((c) => c.change === 'modified') && (
                    <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                      {cs.map((c) => (
                        <li key={key(c)} className="group flex items-center gap-2 text-[12px]">
                          {!locked && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${c.id} ${c.label ?? ''}`}
                              checked={picked.has(key(c))}
                              onChange={(e) =>
                                setPicked((p) => {
                                  const n = new Set(p)
                                  if (e.target.checked) n.add(key(c))
                                  else n.delete(key(c))
                                  return n
                                })
                              }
                              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                            />
                          )}
                          <span className="w-36 shrink-0 truncate text-fg-soft">{c.label ?? c.section}</span>
                          <span className="min-w-0 flex-1 truncate tabular-nums">
                            <span className="text-muted line-through decoration-muted/50">{fmt(c.parent)}</span>
                            <span className="mx-1.5 text-muted">→</span>
                            <span className="font-medium text-fg">{fmt(c.value)}</span>
                          </span>
                          {!locked && (
                            <span className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                              <Tooltip content={`Reset: use ${parentName}’s value`}>
                                <button type="button" aria-label="Reset to parent" onClick={() => a.reset.mutate([ref(c)])} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-fg/[0.08] hover:text-fg">
                                  <RotateCcw className="h-3 w-3" />
                                </button>
                              </Tooltip>
                              <Tooltip content={`Push to ${parentName}: it and its other children take this value`}>
                                <button type="button" aria-label="Push to parent" onClick={() => a.push.mutate([ref(c)])} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-fg/[0.08] hover:text-fg">
                                  <ArrowUpToLine className="h-3 w-3" />
                                </button>
                              </Tooltip>
                              <Tooltip content="Make the same change in the scenarios beside this one">
                                <button type="button" aria-label="Apply to siblings" onClick={() => a.siblings.mutate([ref(c)])} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-fg/[0.08] hover:text-fg">
                                  <Copy className="h-3 w-3" />
                                </button>
                              </Tooltip>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {cs.every((c) => c.change !== 'modified') && !locked && (
                    <div className="mt-1 flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => a.reset.mutate(items(cs))}>
                        <RotateCcw className="h-3 w-3" /> {first.change === 'added' ? 'Remove' : 'Put back'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => a.push.mutate(items(cs))}>
                        <ArrowUpToLine className="h-3 w-3" /> Push to {parentName}
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
