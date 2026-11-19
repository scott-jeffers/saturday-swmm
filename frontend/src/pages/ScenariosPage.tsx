/** Scenarios as a tree, and a side-by-side comparison of any two: what changed, listed and on a plan. */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { api, type ModelNetwork, type Scenario } from '../api/client'
import { Button, PageHeader, Panel } from '../components/ui'
import { NetworkPlan } from '../components/NetworkPlan'
import { ScenarioManager } from '../components/ScenarioManager'
import { cn } from '../lib/cn'
import { IS_VIEWER } from '../lib/mode'

const CHANGE_COLOR = { added: '#22c55e', removed: '#ef4444', modified: '#f59e0b' } as const

function tree(list: Scenario[]): { s: Scenario; depth: number }[] {
  const out: { s: Scenario; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const s of list.filter((x) => (x.parent ?? null) === parent)) {
      out.push({ s, depth })
      walk(s.id, depth + 1)
    }
  }
  walk(null, 0)
  // anything orphaned
  for (const s of list) if (!out.some((o) => o.s.id === s.id)) out.push({ s, depth: 0 })
  return out
}

export function ScenariosPage() {
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios })
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const list = scenarios.data?.scenarios ?? []
  const [manage, setManage] = useState(false)
  const [a, setA] = useState('base')
  const [b, setB] = useState('')
  const bId = b || list.find((s) => s.id !== a)?.id || ''
  const cmp = useQuery({ queryKey: ['scenario-compare', a, bId], queryFn: () => api.compareScenarios(a, bId), enabled: Boolean(a && bId && a !== bId) })
  const changes = cmp.data?.changes ?? []
  const colourById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of changes) if (c.object) m.set(`${c.object}:${c.id}`, CHANGE_COLOR[c.change])
    return m
  }, [changes])
  const name = (id: string) => list.find((s) => s.id === id)?.name ?? id
  const bySection = new Map<string, typeof changes>()
  for (const c of changes) bySection.set(c.section, [...(bySection.get(c.section) ?? []), c])

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="Scenarios"
          description="Each scenario is a full SWMM model that inherits from its parent. Compare any two to see exactly what differs; compare their results under Results → Compare runs."
          actions={
            IS_VIEWER ? undefined : (
              <Button variant="primary" onClick={() => setManage(true)}>
                <GitBranch className="h-3.5 w-3.5" /> New scenario
              </Button>
            )
          }
        />
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Panel title="Tree">
            <ul className="m-0 list-none space-y-0.5 p-0 text-[13px]">
              {tree(list).map(({ s, depth }) => (
                <li key={s.id} style={{ paddingLeft: depth * 16 }} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                  {depth > 0 && <span className="text-muted">└</span>}
                  <span className={cn('min-w-0 flex-1 truncate', s.id === scenarios.data?.active ? 'font-medium text-fg' : 'text-fg-soft')} title={s.description || s.name}>
                    {s.name}
                  </span>
                  {s.id === scenarios.data?.active && <span className="text-[11px] text-accent-soft">open</span>}
                  <span className={cn('h-1.5 w-1.5 rounded-full', s.has_results ? 'bg-success' : 'bg-border-strong')} title={s.has_results ? 'Has results' : 'Not run yet'} />
                </li>
              ))}
            </ul>
            <p className="mb-0 mt-3 text-[11px] text-muted">Green dot: the scenario has results.</p>
          </Panel>
          <Panel title="Compare">
            {list.length < 2 ? (
              <p className="m-0 text-[13px] text-muted">
                Only the base model exists. Create a scenario to try a change (a bigger pipe, a new storage tank) without touching the base.
              </p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <label className="block text-[12px] font-medium text-fg-soft">
                    From
                    <select className="field mt-1 w-56" value={a} onChange={(e) => setA(e.target.value)}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    To
                    <select className="field mt-1 w-56" value={bId} onChange={(e) => setB(e.target.value)}>
                      {list
                        .filter((s) => s.id !== a)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <span className="pb-2 text-[12px] text-muted">
                    {cmp.isFetching ? 'Comparing…' : `${changes.length} difference${changes.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                {network.data && changes.length > 0 && (
                  <div className="mb-3 rounded-md bg-surface">
                    <NetworkPlan network={network.data} className="h-auto w-full" height={300} colorFor={(k, id) => colourById.get(`${k}:${id}`) ?? null} />
                    <div className="flex gap-4 px-3 pb-2 text-[11px] text-muted">
                      {Object.entries(CHANGE_COLOR).map(([k, c]) => (
                        <span key={k} className="inline-flex items-center gap-1.5 capitalize">
                          <span className="h-1 w-4 rounded" style={{ background: c }} />
                          {k} in {name(bId)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {cmp.data && !changes.length && <p className="m-0 text-[13px] text-muted">The two scenarios are identical.</p>}
                <div className="space-y-3">
                  {[...bySection].map(([sec, items]) => (
                    <div key={sec}>
                      <div className="mb-1 text-[11px] font-medium text-muted">
                        {sec.charAt(0) + sec.slice(1).toLowerCase().replace(/_/g, ' ')} · {items.length}
                      </div>
                      <table className="w-full border-collapse text-[12px]">
                        <tbody>
                          {items.map((c) => (
                            <tr key={c.id} className="border-t border-border/60 align-top">
                              <td className="w-28 py-1 pr-2 font-medium text-fg">{c.id}</td>
                              <td className="w-20 py-1 pr-2 capitalize" style={{ color: CHANGE_COLOR[c.change] }}>
                                {c.change}
                              </td>
                              <td className="py-1 font-mono text-[11px] text-muted">
                                {c.a.length > 0 && <div className="line-through decoration-danger/60">{c.a.join(' ⏎ ')}</div>}
                                {c.b.length > 0 && <div className="text-fg-soft">{c.b.join(' ⏎ ')}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
                {changes.length > 0 && (
                  <p className="mb-0 mt-3 text-[12px] text-muted">
                    To compare the two runs’ results, open{' '}
                    <Link to="/results" className="text-accent-soft hover:underline">
                      Results → Compare runs
                    </Link>
                    .
                  </p>
                )}
              </>
            )}
          </Panel>
        </div>
      </div>
      {manage && <ScenarioManager open={manage} onOpenChange={setManage} />}
    </div>
  )
}
