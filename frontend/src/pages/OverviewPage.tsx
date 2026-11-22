/** Project home: is this model healthy, and what should I do next? */
import { engineFromReport } from '../components/RunSummaryCard'
import { formatVolume } from '../lib/units'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Share2 } from 'lucide-react'
import type { Feature } from 'geojson'
import { api, ENGINE_LABELS, type ModelNetwork } from '../api/client'
import { Button, PageHeader, Panel } from '../components/ui'
import { NetworkPlan } from '../components/NetworkPlan'
import { useRunSummary } from '../components/RunSummaryCard'
import { loadRules } from '../components/map/ReviewPanel'
import { buildAttributes, classify, runChecks } from '../lib/elementAttributes'
import { appEvent } from '../components/CommandPalette'
import { setPref } from '../lib/prefs'
import { useNotes } from '../lib/notes'
import { focusOnMap } from '../lib/mapFocus'
import { IS_VIEWER } from '../lib/mode'
import { cn } from '../lib/cn'

const CAP_COLORS = ['#22c55e', '#eab308', '#f97316', '#dc2626']
const CAP_BREAKS = [0, 0.5, 0.8, 1, Infinity]

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={cn(
          'text-[18px] font-semibold tabular-nums',
          tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : 'text-fg',
        )}
      >
        {value}
      </div>
    </div>
  )
}

export function OverviewPage() {
  const navigate = useNavigate()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const { notes } = useNotes()
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const summary = useRunSummary(project.data?.has_out ? project.data.path : null)
  const check = useQuery({ queryKey: ['model-check', project.data?.inp_path], queryFn: api.checkModel, staleTime: 15_000 })
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: api.listScenarios, enabled: !IS_VIEWER, retry: false })
  const snapshots = useQuery({ queryKey: ['snapshots'], queryFn: api.listSnapshots, enabled: !IS_VIEWER, retry: false })
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const s = summary.data?.available ? summary.data : undefined
  const attrs = useMemo(
    () => (network.data ? buildAttributes(network.data.geojson.features as Feature[], s?.tables, us) : []),
    [network.data, s, us],
  )
  const checks = useMemo(() => runChecks(attrs, loadRules(us)), [attrs, us])
  const failingRules = new Map<string, number>()
  for (const f of checks.failures) failingRules.set(f.rule.label, (failingRules.get(f.rule.label) ?? 0) + 1)
  const cap = attrs.find((a) => a.key === 'r:Link Flow Summary:Max/Full Flow')
  const c = network.data?.counts ?? {}
  const links = c.links ?? 0
  const stale = Boolean(project.data?.results_stale)

  // The one thing to do next.
  const next = (() => {
    if ((check.data?.errors ?? 0) > 0)
      return { text: `The model has ${check.data!.errors} error${check.data!.errors === 1 ? '' : 's'} that will stop a run.`, action: 'Show errors', run: () => appEvent('check'), tone: 'bad' as const }
    if (!project.data?.has_out)
      return IS_VIEWER
        ? { text: 'No results loaded. Add the .rpt and .out from a run to see peaks and checks.', action: 'Open files', run: () => navigate('/'), tone: 'warn' as const }
        : { text: 'The model has not been run yet.', action: 'Run the model', run: () => appEvent('run'), tone: 'warn' as const }
    if (stale && !IS_VIEWER) return { text: 'The model changed after the last run, so results are out of date.', action: 'Run again', run: () => appEvent('run'), tone: 'warn' as const }
    if (checks.failures.length)
      return {
        text: `${checks.failures.length} element${checks.failures.length === 1 ? ' fails' : 's fail'} a design check.`,
        action: 'Review on the map',
        run: () => {
          setPref('map-mode', 'review')
          setPref('review-tab', 'checks')
          appEvent('map-mode', 'review')
          navigate('/map')
        },
        tone: 'warn' as const,
      }
    return { text: 'Results are current and every design check passes.', action: 'Write the report', run: () => navigate('/report'), tone: 'good' as const }
  })()

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          actions={
            !IS_VIEWER && project.data ? (
              <a
                href="/api/projects/package"
                download
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-fg-soft hover:bg-fg/[0.06] hover:text-fg"
                title="One .zip with the model and its results. Anyone can open it at saturday-swmm.com/viewer, nothing to install."
              >
                <Share2 className="h-3.5 w-3.5" /> Share for review
              </a>
            ) : null
          }
          title={project.data?.inp_name.replace(/\.inp$/i, '') ?? 'Overview'}
          description={
            project.data
              ? `${project.data.scenario_name} scenario · ${s ? `results from ${engineFromReport(s.engine) ?? ENGINE_LABELS[project.data.simulation_engine ?? 'pyswmm']}` : ENGINE_LABELS[project.data.simulation_engine ?? 'pyswmm']} · ${project.data.flow_units ?? ''} · ${project.data.crs}`
              : undefined
          }
        />
        <div
          className={cn(
            'mb-4 flex items-center gap-3 rounded-[var(--radius-panel)] border px-4 py-3',
            next.tone === 'bad' ? 'border-danger/40 bg-danger/[0.06]' : next.tone === 'warn' ? 'border-warning/40 bg-warning/[0.06]' : 'border-success/40 bg-success/[0.06]',
          )}
        >
          {next.tone === 'good' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          ) : next.tone === 'bad' ? (
            <CircleAlert className="h-5 w-5 shrink-0 text-danger" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          )}
          <span className="flex-1 text-[14px] text-fg">{next.text}</span>
          <Button variant="primary" onClick={next.run}>
            {next.action} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel title={cap ? 'Network, coloured by pipe capacity used' : 'Network'} className="min-w-0">
            {network.data ? (
              <Link to="/map" title="Open the map" className="block rounded-md bg-surface">
                <NetworkPlan
                  network={network.data}
                  className="h-auto w-full"
                  colorFor={cap ? (k, id) => (k === 'link' && cap.values.has(id) ? CAP_COLORS[classify(cap.values.get(id)!, CAP_BREAKS)] : null) : undefined}
                />
              </Link>
            ) : (
              <p className="text-muted">Loading the network…</p>
            )}
            {cap && (
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
                {['under 50 %', '50–80 %', '80–100 %', 'over capacity'].map((l, i) => (
                  <span key={l} className="inline-flex items-center gap-1.5">
                    <span className="h-1 w-4 rounded" style={{ background: CAP_COLORS[i] }} />
                    {l}
                  </span>
                ))}
              </div>
            )}
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Model">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Junctions" value={c.junctions ?? 0} />
                <Stat label="Outfalls" value={c.outfalls ?? 0} />
                <Stat label="Storage" value={c.storage ?? 0} />
                <Stat label="Links" value={links} />
                <Stat label="Subcatchments" value={c.subcatchments ?? 0} />
                <Stat
                  label="Input errors / warnings"
                  value={check.data ? `${check.data.errors} / ${check.data.warnings}` : '…'}
                  tone={check.data?.errors ? 'bad' : check.data?.warnings ? 'warn' : 'good'}
                />
              </div>
            </Panel>
            <Panel
              title="Last run"
              actions={
                s ? (
                  <Link to="/results" className="text-[12px] text-accent-soft hover:underline">
                    Results
                  </Link>
                ) : null
              }
            >
              {s ? (
                <>
                  {stale && <p className="mb-2 mt-0 text-[12px] text-warning">Out of date: the model changed after this run.</p>}
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Flooded nodes" value={s.flooded_nodes ?? 0} tone={s.flooded_nodes ? 'warn' : 'good'} />
                    <Stat label="Surcharged pipes" value={s.surcharged_conduits ?? 0} tone={s.surcharged_conduits ? 'warn' : undefined} />
                    <Stat label="Run time" value={s.elapsed ?? '—'} />
                    <Stat label="Runoff continuity" value={s.runoff_continuity_pct != null ? `${s.runoff_continuity_pct.toFixed(2)} %` : '—'} tone={Math.abs(s.runoff_continuity_pct ?? 0) > 5 ? 'bad' : undefined} />
                    <Stat label="Routing continuity" value={s.routing_continuity_pct != null ? `${s.routing_continuity_pct.toFixed(2)} %` : '—'} tone={Math.abs(s.routing_continuity_pct ?? 0) > 5 ? 'bad' : undefined} />
                    <Stat label="Flood volume" value={s.flooded_nodes ? formatVolume(s.flood_volume, s.flood_volume_units, { nonZero: true }) : '0'} />
                  </div>
                </>
              ) : (
                <p className="m-0 text-[13px] text-muted">No results yet.</p>
              )}
            </Panel>
            <Panel title="Design checks">
              {failingRules.size ? (
                <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
                  {[...failingRules].map(([label, n]) => (
                    <li key={label} className="flex justify-between">
                      <span className="text-fg-soft">{label}</span>
                      <span className="tabular-nums text-warning">{n}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 text-[13px] text-muted">{s ? 'Every check passes.' : 'Slope and cover pass; run the model to check velocity, capacity and flooding.'}</p>
              )}
            </Panel>
          </div>
        </div>

        {!IS_VIEWER && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel
              title="Scenarios"
              actions={
                <Link to="/scenarios" className="text-[12px] text-accent-soft hover:underline">
                  Manage
                </Link>
              }
            >
              <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
                {(scenarios.data?.scenarios ?? []).map((x) => (
                  <li key={x.id} className="flex items-center justify-between">
                    <span className={x.id === scenarios.data?.active ? 'font-medium text-fg' : 'text-fg-soft'}>
                      {x.name}
                      {x.id === scenarios.data?.active && <span className="ml-2 text-[11px] text-accent-soft">open</span>}
                    </span>
                    <span className="text-[11px] text-muted">{x.has_results ? 'has results' : 'not run'}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Review notes">
              <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
                {Object.entries(notes).slice(0, 8).map(([k, n]) => {
                  const [t, id] = k.split(':') as ['node' | 'link' | 'subcatchment', string]
                  return (
                    <li key={k} className="flex gap-2">
                      <button
                        type="button"
                        className="shrink-0 font-medium text-accent-soft hover:underline"
                        onClick={() => {
                          focusOnMap({ object_type: t, id })
                          navigate('/map')
                        }}
                      >
                        {id}
                      </button>
                      <span className="truncate text-fg-soft" title={n.text}>
                        {n.text}
                      </span>
                    </li>
                  )
                })}
                {!Object.keys(notes).length && <li className="text-muted">No notes. Add one from an element’s Notes tab on the map.</li>}
              </ul>
            </Panel>
            <Panel title="Snapshots">
              <ul className="m-0 list-none space-y-1 p-0 text-[13px]">
                {(snapshots.data?.snapshots ?? []).slice(0, 5).map((x) => (
                  <li key={x.id} className="flex items-center justify-between">
                    <span className={x.auto ? 'text-muted' : 'text-fg-soft'}>{x.label}</span>
                    <span className="text-[11px] text-muted">{new Date(x.created).toLocaleString()}</span>
                  </li>
                ))}
                {!snapshots.data?.snapshots.length && <li className="text-muted">None yet. One is saved before each run; name your own from the history menu next to undo.</li>}
              </ul>
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}
