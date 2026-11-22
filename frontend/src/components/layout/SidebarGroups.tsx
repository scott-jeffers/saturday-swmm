/**
 * The sidebar's Open and Scenarios dropdowns.
 *
 * Open: where models come from (files and examples, the model library, or
 * the desktop app's projects and recent projects).
 *
 * Scenarios: the versions of this model and their results. Click one to work
 * in it; the ⇄ toggle picks the one the map, graphs and profile compare
 * against. In the browser viewer these are the result sets that were opened.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, BarChart3, Check, FolderOpen, GitBranch, LibraryBig, MoreHorizontal, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type Scenario } from '../../api/client'
import { useCompare } from '../../lib/compare'
import { cn } from '../../lib/cn'
import { IS_VIEWER } from '../../lib/mode'
import { invalidateProjectQueries } from '../../lib/projectQueries'
import { readRecentProjects } from '../../lib/recentProjects'
import { AlertDialog, useToast } from '../ui'
import { SideGroup, SideRow } from './SideGroup'

// ------------------------------------------------------------------- Open

export function OpenGroup({ expanded, projectPath }: { expanded: boolean; projectPath: string | null }) {
  const navigate = useNavigate()
  const loc = useLocation()
  // re-read when the route changes (opening a project updates the list)
  const recent = useMemo(() => (IS_VIEWER ? [] : readRecentProjects().slice(0, 5)), [loc.pathname, projectPath])
  const onHome = loc.pathname === '/' || loc.pathname === '/library'
  return (
    <SideGroup id="open" label="Open" icon={<FolderOpen className="h-4 w-4 shrink-0" aria-hidden />} expanded={expanded} active={onHome} defaultOpen={!projectPath}>
      {(close) => (
        <>
          <SideRow active={loc.pathname === '/'} onClick={() => (navigate('/'), close())}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <span className="truncate">{IS_VIEWER ? 'Files & examples' : 'Projects & examples'}</span>
          </SideRow>
          {IS_VIEWER ? (
            <SideRow active={loc.pathname === '/library'} onClick={() => (navigate('/library'), close())}>
              <LibraryBig className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="truncate">Model library</span>
            </SideRow>
          ) : null}
          {recent.length ? <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-medium text-muted/80">Recent</div> : null}
          {recent.map((r) => {
            const current = r.path === projectPath
            return (
              <SideRow
                key={r.path}
                active={current && loc.pathname !== '/'}
                title={r.path}
                onClick={() => {
                  close()
                  navigate(current ? '/overview' : `/?open=${encodeURIComponent(r.path)}`)
                }}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', current ? 'bg-accent' : 'bg-transparent')} aria-hidden />
                <span className="truncate">{r.name.replace(/\.inp$/i, '') || r.path.split(/[/\\]/).pop()}</span>
              </SideRow>
            )
          })}
        </>
      )}
    </SideGroup>
  )
}

// -------------------------------------------------------------- Scenarios

type Row = {
  id: string
  name: string
  depth: number
  active: boolean
  hasResults: boolean
  /** Compare target id for this row, when it has results to compare with. */
  compareId: string | null
  canDelete: boolean
  canRename: boolean
  canBranch: boolean
}

function tree(list: Scenario[]) {
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

export function ScenariosGroup({ expanded, projectPath }: { expanded: boolean; projectPath: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const compare = useCompare()
  const scen = useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios, enabled: !IS_VIEWER && Boolean(projectPath), retry: false })
  const [editing, setEditing] = useState<{ kind: 'rename' | 'new'; id: string; text: string } | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Row | null>(null)

  const rows: Row[] = useMemo(() => {
    if (IS_VIEWER) {
      const cur = compare.current
      const list: Row[] = []
      if (cur) list.push({ id: cur.id, name: cur.label, depth: 0, active: true, hasResults: true, compareId: null, canDelete: true, canRename: true, canBranch: false })
      for (const t of compare.targets)
        list.push({ id: t.id, name: t.label, depth: 0, active: false, hasResults: t.has_results, compareId: t.has_results ? t.id : null, canDelete: true, canRename: true, canBranch: false })
      return list
    }
    const d = scen.data
    if (!d) return []
    return tree(d.scenarios).map(({ s, depth }) => {
      const target = compare.targets.find((t) => t.kind === 'scenario' && t.scenario_id === s.id && t.has_results)
      return {
        id: s.id,
        name: s.name,
        depth,
        active: s.id === d.active,
        hasResults: s.has_results,
        compareId: s.id === d.active ? null : (target?.id ?? null),
        canDelete: s.parent !== null,
        canRename: true,
        canBranch: true,
      }
    })
  }, [scen.data, compare.targets, compare.current])

  const activeName = rows.find((r) => r.active)?.name

  const after = async () => {
    if (IS_VIEWER) await qc.invalidateQueries()
    else invalidateProjectQueries(qc)
  }
  const fail = (title: string) => (e: Error) => toast({ title, description: e.message, tone: 'danger' })

  const activate = useMutation({
    mutationFn: async (r: Row) => {
      if (IS_VIEWER) {
        const { makeCurrent } = await import('../../viewer/store')
        await makeCurrent(r.id)
      } else {
        qc.setQueryData(['scenarios'], await api.setActiveScenario(r.id))
      }
      return r
    },
    onSuccess: async (r) => {
      await after()
      toast({ title: IS_VIEWER ? `Showing “${r.name}”` : `Now working in “${r.name}”`, tone: 'success' })
    },
    onError: fail('Couldn’t switch'),
  })
  const rename = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      if (IS_VIEWER) {
        const { updateResult } = await import('../../viewer/store')
        await updateResult(id, { label: text })
      } else qc.setQueryData(['scenarios'], await api.updateScenario(id, { name: text }))
    },
    onSuccess: async () => {
      setEditing(null)
      await qc.invalidateQueries({ queryKey: ['compare-targets'] })
      void qc.invalidateQueries({ queryKey: ['project'] })
    },
    onError: fail('Couldn’t rename'),
  })
  const create = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.createScenario(text, id),
    onSuccess: async (d) => {
      qc.setQueryData(['scenarios'], d)
      setEditing(null)
      await after()
      toast({ title: `Created “${d.scenarios.find((s) => s.id === d.active)?.name}” and switched to it`, description: 'Change the model here; the parent stays as it was.', tone: 'success' })
    },
    onError: fail('Couldn’t create the scenario'),
  })
  const remove = useMutation({
    mutationFn: async (r: Row) => {
      if (IS_VIEWER) {
        const { removeResult } = await import('../../viewer/store')
        await removeResult(r.id)
      } else qc.setQueryData(['scenarios'], await api.deleteScenario(r.id))
      return r
    },
    onSuccess: async (r) => {
      setConfirm(null)
      if (compare.target?.id === r.compareId) compare.setTarget(null)
      await after()
      toast({ title: IS_VIEWER ? 'Results removed' : 'Scenario deleted', description: IS_VIEWER ? undefined : 'Its folder was moved to scenarios/.deleted.', tone: 'success' })
    },
    onError: fail('Couldn’t delete'),
  })

  const submit = () => {
    if (!editing || !editing.text.trim()) return setEditing(null)
    if (editing.kind === 'rename') rename.mutate({ id: editing.id, text: editing.text.trim() })
    else create.mutate({ id: editing.id, text: editing.text.trim() })
  }

  return (
    <SideGroup
      id="scenarios"
      label="Scenarios"
      sublabel={expanded ? activeName : undefined}
      icon={<GitBranch className="h-4 w-4 shrink-0 text-ic-scen" aria-hidden />}
      expanded={expanded}
      active={false}
    >
      {(close) => (
        <>
          {rows.length === 0 ? (
            <p className="m-0 px-2 py-1 text-[11.5px] leading-snug text-muted">
              {IS_VIEWER ? 'Open results (.rpt, .out) to see them here.' : scen.isLoading ? 'Loading…' : 'No scenarios yet.'}
            </p>
          ) : null}
          {rows.map((r) => {
            const isTarget = Boolean(r.compareId && compare.target?.id === r.compareId)
            if (editing?.kind === 'rename' && editing.id === r.id)
              return <InlineInput key={r.id} value={editing.text} onChange={(text) => setEditing({ ...editing, text })} onSubmit={submit} onCancel={() => setEditing(null)} label="Name" />
            return (
              <div key={r.id} className="group relative">
                <div
                  className={cn(
                    'flex h-7 items-center rounded-md pr-1 text-[12.5px] transition-colors',
                    r.active ? 'bg-fg/[0.08] font-medium text-fg' : 'text-fg-soft hover:bg-fg/[0.05] hover:text-fg',
                  )}
                  style={{ paddingLeft: 8 + r.depth * 12 }}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={r.active}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
                    title={`${r.name}: ${r.active ? (IS_VIEWER ? 'showing these results' : 'you’re working in this scenario') : IS_VIEWER ? 'show these results' : 'work in this scenario'}${r.hasResults ? '' : ' (not run yet)'}`}
                    onClick={() => {
                      if (!r.active) activate.mutate(r)
                      close()
                    }}
                  >
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full border', r.hasResults ? 'border-success bg-success' : 'border-muted bg-transparent')}
                      title={r.hasResults ? 'Has results' : 'Not run yet'}
                      aria-hidden
                    />
                    <span className="truncate">{r.name}</span>
                  </button>
                  {r.compareId ? (
                    <IconBtn
                      label={isTarget ? `Stop comparing with ${r.name}` : `Compare with ${r.name}`}
                      pressed={isTarget}
                      className={isTarget ? 'bg-accent/15 text-accent-soft' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}
                      onClick={() => compare.setTarget(isTarget ? null : r.compareId)}
                    >
                      <ArrowLeftRight className="h-3 w-3" />
                    </IconBtn>
                  ) : null}
                  <IconBtn label={`More for ${r.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100" expanded={menu === r.id} onClick={() => setMenu(menu === r.id ? null : r.id)}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </IconBtn>
                </div>
                {menu === r.id ? (
                  <RowMenu onClose={() => setMenu(null)}>
                    {r.canBranch ? (
                      <MenuBtn onClick={() => (setMenu(null), setEditing({ kind: 'new', id: r.id, text: `${r.name} copy` }))}>New scenario from this</MenuBtn>
                    ) : null}
                    {r.canRename ? <MenuBtn onClick={() => (setMenu(null), setEditing({ kind: 'rename', id: r.id, text: r.name }))}>Rename</MenuBtn> : null}
                    {r.canDelete ? (
                      <MenuBtn danger onClick={() => (setMenu(null), setConfirm(r))}>
                        {IS_VIEWER ? 'Remove these results' : 'Delete'}
                      </MenuBtn>
                    ) : null}
                  </RowMenu>
                ) : null}
                {editing?.kind === 'new' && editing.id === r.id ? (
                  <div style={{ paddingLeft: (r.depth + 1) * 12 }}>
                    <InlineInput value={editing.text} onChange={(text) => setEditing({ ...editing, text })} onSubmit={submit} onCancel={() => setEditing(null)} label="New scenario name" />
                  </div>
                ) : null}
              </div>
            )
          })}

          <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
            {IS_VIEWER ? (
              <SideRow onClick={() => (navigate('/'), close())}>
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <span className="truncate">Add results</span>
              </SideRow>
            ) : (
              <SideRow
                onClick={() => {
                  const active = rows.find((r) => r.active)
                  if (active) setEditing({ kind: 'new', id: active.id, text: `${active.name} copy` })
                }}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <span className="truncate">New scenario</span>
              </SideRow>
            )}
            <SideRow onClick={() => (navigate(IS_VIEWER ? '/results' : '/scenarios'), close())}>
              <BarChart3 className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{IS_VIEWER ? 'Compare runs' : 'Compare & details'}</span>
            </SideRow>
          </div>

          <AlertDialog
            open={Boolean(confirm)}
            onOpenChange={(o) => !o && setConfirm(null)}
            title={IS_VIEWER ? `Remove “${confirm?.name}”?` : `Delete “${confirm?.name}”?`}
            description={
              IS_VIEWER
                ? 'These results are removed from this browser. The files on your computer aren’t touched.'
                : 'Its folder (model and results) is moved to scenarios/.deleted inside the project, so you can still recover it from there.'
            }
            confirming={remove.isPending}
            onConfirm={() => confirm && remove.mutate(confirm)}
          />
        </>
      )}
    </SideGroup>
  )
}

function IconBtn({ label, onClick, children, className, pressed, expanded }: { label: string; onClick: () => void; children: ReactNode; className?: string; pressed?: boolean; expanded?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn('grid h-5 w-5 shrink-0 place-items-center rounded text-muted transition-opacity hover:bg-fg/10 hover:text-fg', className)}
    >
      {children}
    </button>
  )
}

function RowMenu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-7 z-20 w-48 rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]">
      {children}
    </div>
  )
}

function MenuBtn({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn('block w-full rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-fg/5', danger ? 'text-danger' : 'text-fg')}>
      {children}
    </button>
  )
}

function InlineInput({ value, onChange, onSubmit, onCancel, label }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void; label: string }) {
  return (
    <form
      className="flex items-center gap-1 py-0.5"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <input
        autoFocus
        aria-label={label}
        className="field h-7 min-w-0 flex-1 px-2 py-0 text-[12px]"
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      <button type="submit" aria-label="Save" title="Save" className="grid h-6 w-6 place-items-center rounded text-success hover:bg-fg/10">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Cancel" title="Cancel" onClick={onCancel} className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-fg/10">
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  )
}
