/**
 * The header's breadcrumb: what you're looking at, and where to change it.
 *
 *   App:     Project ▾ / Scenario ▾ / Storm ▾
 *   Viewer:  Model ▾ / Results ▾
 *
 * A scenario is a version of the model (what you build); a storm is the
 * rainfall it's run under. Every scenario × storm pair has its own results:
 * the Runs page shows them all as a grid.
 */
import * as DM from '@radix-ui/react-dropdown-menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, BarChart3, Check, ChevronDown, CloudRain, FolderOpen, GitBranch, GitCompareArrows, LayoutGrid, Pencil, Plus, Settings2, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ProjectInfo } from '../../api/client'
import { useCompare } from '../../lib/compare'
import { openNewModel } from '../../lib/newModel'
import { cn } from '../../lib/cn'
import { IS_VIEWER } from '../../lib/mode'
import { invalidateProjectQueries } from '../../lib/projectQueries'
import { readRecentProjects } from '../../lib/recentProjects'
import { ScenarioBadges, ScenarioManager, scenarioPath, scenarioTree } from '../ScenarioManager'
import { Button, Dialog, DialogContent, useToast } from '../ui'

// ------------------------------------------------------------------ parts

function Trigger({ icon, label, title, strong }: { icon?: ReactNode; label: string; title: string; strong?: boolean }) {
  return (
    <DM.Trigger
      title={title}
      className={cn(
        'group inline-flex h-7 min-w-[3.25rem] items-center gap-1.5 rounded-md px-1.5 outline-none transition-colors hover:bg-fg/[0.06] focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=open]:bg-fg/[0.08]',
        // The project name keeps its room; the others shorten first.
        strong ? 'max-w-[16rem] shrink-0' : 'shrink',
        strong ? 'text-[14px] font-semibold text-fg' : 'text-[13px] text-fg-soft hover:text-fg',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      <ChevronDown className="h-3 w-3 shrink-0 text-muted" aria-hidden />
    </DM.Trigger>
  )
}

function Menu({ children, label }: { children: ReactNode; label: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align="start"
        sideOffset={6}
        aria-label={label}
        className="z-[70] max-h-[min(560px,calc(100vh-5rem))] w-72 overflow-y-auto rounded-xl border border-border bg-elevated p-1.5 text-[13px] shadow-[var(--shadow-panel)]"
      >
        {children}
      </DM.Content>
    </DM.Portal>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted">{children}</DM.Label>
}

function Item({ children, onSelect, checked, hint, icon, inset }: { children: ReactNode; onSelect: () => void; checked?: boolean; hint?: ReactNode; icon?: ReactNode; inset?: number }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className="flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1 outline-none data-[highlighted]:bg-fg/[0.06]"
      style={inset ? { paddingLeft: 8 + inset * 14 } : undefined}
    >
      <span className="grid w-4 shrink-0 place-items-center text-muted">{checked ? <Check className="h-3.5 w-3.5 text-accent-soft" /> : icon}</span>
      <span className={cn('min-w-0 flex-1 truncate', checked ? 'font-medium text-fg' : 'text-fg-soft')}>{children}</span>
      {hint ? <span className="shrink-0 text-[11px] text-muted">{hint}</span> : null}
    </DM.Item>
  )
}

const Sep = () => <DM.Separator className="my-1 h-px bg-border" />

function Slash() {
  return (
    <span className="shrink-0 select-none text-[14px] text-border-strong" aria-hidden>
      /
    </span>
  )
}

/** Small dot: has results (filled) or not (ring). */
function ResultDot({ has, stale }: { has: boolean; stale?: boolean }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full border', has ? (stale ? 'border-warning bg-warning' : 'border-success bg-success') : 'border-muted/70')}
      title={has ? (stale ? 'Results are older than the model' : 'Has results') : 'Not run yet'}
    />
  )
}

// ---------------------------------------------------------------- project

function ProjectMenu({ project }: { project: ProjectInfo }) {
  const navigate = useNavigate()
  const examples = useQuery({ queryKey: ['examples'], queryFn: api.examples, staleTime: Infinity, enabled: !IS_VIEWER })
  const recent = useMemo(() => (IS_VIEWER ? [] : readRecentProjects().slice(0, 6)), [project.path])
  const name = project.inp_name.replace(/\.inp$/i, '')
  const open = (path: string) => navigate(path === project.path ? '/overview' : `/?open=${encodeURIComponent(path)}`)
  return (
    <DM.Root>
      <Trigger strong label={IS_VIEWER ? name : project.path.split(/[/\\]/).pop() || name} title={project.path} />
      <Menu label="Project">
        {IS_VIEWER ? (
          <>
            <Item icon={<Plus className="h-3.5 w-3.5" />} onSelect={openNewModel}>
              New model…
            </Item>
            <Item icon={<FolderOpen className="h-3.5 w-3.5" />} onSelect={() => navigate('/')}>
              Open files…
            </Item>
            <Sep />
            <Heading>Examples</Heading>
            {[
              ['lid', 'LID example'],
              ['drexel', 'Drexel campus (with and without LID)'],
              ['1d', 'Bellinge'],
              ['2d', 'Bellinge 2D flood'],
            ].map(([k, label]) => (
              <Item key={k} onSelect={() => navigate(`/?example=${k}`)}>
                {label}
              </Item>
            ))}
          </>
        ) : (
          <>
            {recent.length ? <Heading>Recent</Heading> : null}
            {recent.map((r) => (
              <Item key={r.path} checked={r.path === project.path} onSelect={() => open(r.path)} hint={r.path === project.path ? 'open' : undefined}>
                <span title={r.path}>{r.path.split(/[/\\]/).pop() || r.name}</span>
              </Item>
            ))}
            {recent.length ? <Sep /> : null}
            <Item icon={<Plus className="h-3.5 w-3.5" />} onSelect={openNewModel}>
              New model…
            </Item>
            <Item icon={<FolderOpen className="h-3.5 w-3.5" />} onSelect={() => navigate('/')}>
              Open a project…
            </Item>
            {examples.data?.length ? (
              <>
                <Sep />
                <Heading>Examples</Heading>
                {examples.data.map((e) => (
                  <Item key={e.path} checked={e.path === project.path} onSelect={() => open(e.path)}>
                    {e.name}
                  </Item>
                ))}
              </>
            ) : null}
          </>
        )}
      </Menu>
    </DM.Root>
  )
}

// --------------------------------------------------------------- scenario

function ScenarioMenu({ project }: { project: ProjectInfo }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const scen = useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios, retry: false })
  const matrix = useQuery({ queryKey: ['run-matrix'], queryFn: api.runMatrix, retry: false })
  const [manage, setManage] = useState(false)
  const [naming, setNaming] = useState<string | null>(null)
  const storm = project.storm_id ?? 'model'
  const cell = (sid: string) => matrix.data?.cells.find((c) => c.scenario === sid && c.storm === storm)

  const activate = useMutation({
    mutationFn: (id: string) => api.setActiveScenario(id),
    onSuccess: (d) => {
      qc.setQueryData(['scenarios'], d)
      invalidateProjectQueries(qc)
    },
    onError: (e: Error) => toast({ title: 'Couldn’t switch scenario', description: e.message, tone: 'danger' }),
  })
  const create = useMutation({
    mutationFn: (name: string) => api.createScenario(name, project.scenario_id ?? 'base'),
    onSuccess: (d) => {
      qc.setQueryData(['scenarios'], d)
      setNaming(null)
      invalidateProjectQueries(qc)
      toast({ title: `Created “${d.scenarios.find((s) => s.id === d.active)?.name}” and switched to it`, description: 'Change the model here; its parent stays as it was.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t create the scenario', description: e.message, tone: 'danger' }),
  })

  return (
    <>
      <DM.Root>
        <Trigger
          icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-ic-scen" />}
          label={(() => {
            const path = scenarioPath(scen.data?.scenarios ?? [], scen.data?.active ?? '')
            return path.length > 1 ? path.map((p) => p.name).join(' › ') : project.scenario_name ?? 'Base'
          })()}
          title="Scenario: the version of the model you're working in, and the scenarios it inherits from"
        />
        <Menu label="Scenario">
          <Heading>Scenarios: versions of the model</Heading>
          {scenarioTree(scen.data?.scenarios ?? []).map(({ s, depth }) => {
            const c = cell(s.id)
            return (
              <Item key={s.id} checked={s.id === scen.data?.active} inset={depth} onSelect={() => s.id !== scen.data?.active && activate.mutate(s.id)} hint={<ResultDot has={Boolean(c?.has_results)} stale={c?.stale} />}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{s.name}</span>
                  <ScenarioBadges s={s} dot={false} />
                </span>
              </Item>
            )
          })}
          {!scen.data && <p className="m-0 px-2 py-1.5 text-[12.5px] text-muted">{scen.isError ? 'Couldn’t load the scenarios.' : 'Loading the scenarios…'}</p>}
          <Sep />
          <Item icon={<Plus className="h-3.5 w-3.5" />} onSelect={() => setNaming(`${project.scenario_name ?? 'Base'} copy`)}>
            New scenario from “{project.scenario_name ?? 'Base'}”…
          </Item>
          <Item icon={<Settings2 className="h-3.5 w-3.5" />} onSelect={() => setManage(true)}>
            Manage scenarios…
          </Item>
          <Item icon={<LayoutGrid className="h-3.5 w-3.5" />} onSelect={() => navigate('/runs')}>
            All runs
          </Item>
        </Menu>
      </DM.Root>
      {manage ? <ScenarioManager open={manage} onOpenChange={setManage} /> : null}
      <NameDialog
        open={naming !== null}
        title="New scenario"
        description={`A copy of “${project.scenario_name ?? 'Base'}” to change. It keeps its own results under every storm.`}
        value={naming ?? ''}
        busy={create.isPending}
        onCancel={() => setNaming(null)}
        onSubmit={(v) => create.mutate(v)}
        action="Create"
      />
    </>
  )
}

function NameDialog({ open, title, description, value, busy, onCancel, onSubmit, action }: { open: boolean; title: string; description: string; value: string; busy: boolean; onCancel: () => void; onSubmit: (v: string) => void; action: string }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent title={title} description={description}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) onSubmit(text.trim())
          }}
        >
          <input autoFocus className="field w-full" aria-label="Name" value={text} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)} />
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={!text.trim() || busy}>
              {action}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ storm

function StormMenu({ project }: { project: ProjectInfo }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const storms = useQuery({ queryKey: ['storms'], queryFn: api.listStorms, retry: false })
  const matrix = useQuery({ queryKey: ['run-matrix'], queryFn: api.runMatrix, retry: false })
  const sid = project.scenario_id ?? 'base'
  const cell = (storm: string) => matrix.data?.cells.find((c) => c.scenario === sid && c.storm === storm)
  const activate = useMutation({
    mutationFn: (id: string) => api.setActiveStorm(id),
    onSuccess: () => invalidateProjectQueries(qc),
    onError: (e: Error) => toast({ title: 'Couldn’t switch storm', description: e.message, tone: 'danger' }),
  })
  const list = storms.data?.storms ?? []
  return (
    <DM.Root>
      <Trigger icon={<CloudRain className="h-3.5 w-3.5 shrink-0 text-ic-rain" />} label={project.storm_name ?? 'Model rainfall'} title="Storm: the rainfall the results are for" />
      <Menu label="Storm">
        <Heading>Storms: rainfall to run the model under</Heading>
        {list.map((s) => {
          const c = cell(s.id)
          return (
            <Item
              key={s.id}
              checked={s.id === (project.storm_id ?? 'model')}
              onSelect={() => s.id !== project.storm_id && activate.mutate(s.id)}
              hint={
                <span className="inline-flex items-center gap-2">
                  {s.total != null ? `${s.total.toFixed(2)} ${s.units === 'MM' ? 'mm' : 'in'}` : null}
                  <ResultDot has={Boolean(c?.has_results)} stale={c?.stale} />
                </span>
              }
            >
              {s.name}
            </Item>
          )
        })}
        {list.length <= 1 ? (
          <p className="m-0 px-2 py-1.5 text-[12px] leading-snug text-muted">
            Add design storms (2-, 10-, 100-year…) on the Rainfall page to run every scenario under each without editing the model.
          </p>
        ) : null}
        <Sep />
        <Item icon={<Plus className="h-3.5 w-3.5" />} onSelect={() => navigate('/storm')}>
          New design storm or rain record…
        </Item>
        <Item icon={<LayoutGrid className="h-3.5 w-3.5" />} onSelect={() => navigate('/runs')}>
          All runs
        </Item>
      </Menu>
    </DM.Root>
  )
}

// ---------------------------------------------------------------- viewer

/** One result set in the menu: click to show it; right-click, double-click or the pencil to rename; × removes it. */
function ResultRow({ r, onShow, onRename, onRemove }: { r: { id: string; label: string; current: boolean }; onShow: () => void; onRename: (label: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(r.label)
  const commit = () => {
    setEditing(false)
    const v = value.trim()
    if (v && v !== r.label) onRename(v)
    else setValue(r.label)
  }
  if (editing)
    return (
      <div className="flex min-h-8 items-center gap-2 px-2 py-1">
        <span className="w-4 shrink-0" />
        <input
          autoFocus
          aria-label="Name for these results"
          className="field h-7 min-w-0 flex-1 text-[13px]"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            // Keep the menu's type-to-find and arrow keys out of the box.
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setValue(r.label)
              setEditing(false)
            }
          }}
        />
      </div>
    )
  return (
    <DM.Item
      onSelect={(e) => {
        if (r.current) e.preventDefault()
        else onShow()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setEditing(true)
      }}
      onDoubleClick={() => setEditing(true)}
      title="Right-click to rename"
      className="group flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1 outline-none data-[highlighted]:bg-fg/[0.06]"
    >
      <span className="grid w-4 shrink-0 place-items-center text-muted">{r.current ? <Check className="h-3.5 w-3.5 text-accent-soft" /> : null}</span>
      <span className={cn('min-w-0 flex-1 truncate', r.current ? 'font-medium text-fg' : 'text-fg-soft')}>{r.label || 'Results'}</span>
      <button
        type="button"
        aria-label={`Rename ${r.label}`}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted opacity-0 hover:bg-fg/[0.08] hover:text-fg group-hover:opacity-100 group-data-[highlighted]:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setEditing(true)
        }}
      >
        <Pencil className="h-3 w-3" />
      </button>
      {!r.current && (
        <button
          type="button"
          aria-label={`Remove ${r.label} from this list`}
          title="Remove from this list"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 group-data-[highlighted]:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </DM.Item>
  )
}

function ResultsMenu() {
  const qc = useQueryClient()
  const compare = useCompare()
  const navigate = useNavigate()
  const cur = compare.current
  const sets = [...(cur ? [{ id: cur.id, label: cur.label, current: true }] : []), ...compare.targets.map((t) => ({ id: t.id, label: t.label, current: false }))]
  if (!sets.length) return null
  const store = () => import('../../viewer/store')
  return (
    <DM.Root>
      <Trigger icon={<BarChart3 className="h-3.5 w-3.5 shrink-0 text-ic-results" />} label={cur?.label ?? 'Results'} title="The results shown" />
      <Menu label="Results">
        <Heading>Results opened here</Heading>
        {sets.map((r) => (
          <ResultRow
            key={r.id}
            r={r}
            onShow={async () => {
              await (await store()).makeCurrent(r.id)
              await qc.invalidateQueries()
            }}
            onRename={async (label) => {
              await (await store()).updateResult(r.id, { label })
              await qc.invalidateQueries()
            }}
            onRemove={async () => {
              await (await store()).removeResult(r.id)
              await qc.invalidateQueries()
            }}
          />
        ))}
        <p className="m-0 px-2 pb-1 pt-0.5 text-[11px] text-muted">Right-click a name to rename it.</p>
        <Sep />
        <Item icon={<Plus className="h-3.5 w-3.5" />} onSelect={() => navigate('/')}>
          Add results (.rpt, .out)…
        </Item>
        <Item icon={<LayoutGrid className="h-3.5 w-3.5" />} onSelect={() => navigate('/results')}>
          Compare runs
        </Item>
      </Menu>
    </DM.Root>
  )
}

// ------------------------------------------------------------- compare

/** The dashed line other scenarios are drawn with on the map, Graphs and Profile. */
const Dashed = () => (
  <svg width="16" height="4" className="shrink-0 text-ic-scen" aria-hidden>
    <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
  </svg>
)

/**
 * "vs …": what the current results are compared with, on the map (dashed),
 * in Graphs and in the Profile. Part of what you're looking at, so it sits in
 * the breadcrumb, not floating over the map.
 */
function CompareMenu() {
  const cmp = useCompare()
  const ready = cmp.targets.filter((t) => t.has_results)
  if (!cmp.current || !ready.length) return null
  const scen = cmp.targets.filter((t) => t.kind === 'scenario')
  const runs = cmp.targets.filter((t) => t.kind === 'run')
  const pick = (id: string | null) => {
    cmp.setTarget(id)
    // The map shows results only in Results mode: switch it there when comparing starts.
    if (id) window.dispatchEvent(new Event('saturday-swmm-compare-started'))
  }
  const target = cmp.target
  // "No LID · Model rainfall" vs "With LID · Model rainfall": say only what differs.
  const short = (label: string) => {
    const a = label.split(' · ')
    const b = (cmp.current?.label ?? '').split(' · ')
    while (a.length > 1 && b.length > 1 && a[a.length - 1] === b[b.length - 1]) {
      a.pop()
      b.pop()
    }
    return a.join(' · ')
  }
  const canSwap = Boolean(target) && (IS_VIEWER || target?.kind === 'scenario')
  return (
    <DM.Root>
      {target ? (
        <DM.Trigger
          className="inline-flex h-7 min-w-0 max-w-[14rem] shrink-[3] items-center gap-1.5 rounded-md border border-ic-scen/30 bg-ic-scen/[0.07] px-2 text-[12.5px] text-fg outline-none hover:bg-ic-scen/[0.12] focus-visible:ring-2 focus-visible:ring-accent/40"
          title={`Compared with ${target.label}: dashed on the map, in Graphs and in the Profile`}
        >
          <span className="text-[11.5px] text-muted">vs</span>
          <Dashed />
          <span className="truncate max-lg:hidden">{short(target.label)}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted max-lg:hidden" />
        </DM.Trigger>
      ) : (
        <DM.Trigger
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted outline-none hover:bg-fg/[0.06] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/40"
          title="Compare these results with another scenario or run, on the map, in Graphs and in the Profile"
        >
          <GitCompareArrows className="h-3.5 w-3.5 text-ic-scen" />
          <span className="max-lg:hidden">Compare</span>
        </DM.Trigger>
      )}
      <Menu label="Compare">
        <Heading>Compare {cmp.current.label} with</Heading>
        {scen.length > 0 && runs.length > 0 && <Heading>Scenarios</Heading>}
        {scen.map((t) => (
          <Item key={t.id} checked={t.id === target?.id} onSelect={() => t.has_results && pick(t.id)} hint={t.has_results ? undefined : 'not run yet'}>
            {t.label}
          </Item>
        ))}
        {runs.length > 0 && <Heading>{scen.length ? 'Earlier runs' : 'Results'}</Heading>}
        {runs.slice(0, 12).map((t) => (
          <Item key={t.id} checked={t.id === target?.id} onSelect={() => t.has_results && pick(t.id)} hint={t.has_results ? undefined : 'not run yet'}>
            {t.label}
          </Item>
        ))}
        {target && (
          <>
            <Sep />
            {canSwap && (
              <Item icon={<ArrowLeftRight className="h-3.5 w-3.5" />} onSelect={() => void cmp.swap()}>
                Make {target.label} the current one
              </Item>
            )}
            <Item icon={<X className="h-3.5 w-3.5" />} onSelect={() => pick(null)}>
              Stop comparing
            </Item>
          </>
        )}
      </Menu>
    </DM.Root>
  )
}

// ------------------------------------------------------------------ bar

export function ContextBar({ project }: { project: ProjectInfo }) {
  return (
    <nav aria-label="What you're looking at" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      <ProjectMenu project={project} />
      <Slash />
      <ScenarioMenu project={project} />
      {/* Phones: project and scenario only; storm and comparison are on their pages. */}
      <span className="contents max-md:hidden">
        <Slash />
        <StormMenu project={project} />
      </span>
      {/* Online, results are runs kept in this browser: pick which one the pages show. */}
      {IS_VIEWER && (
        <span className="contents max-md:hidden">
          <Slash />
          <ResultsMenu />
        </span>
      )}
      <span className="contents max-md:hidden">
        <span className="w-1.5 shrink-0" aria-hidden />
        <CompareMenu />
      </span>
    </nav>
  )
}
