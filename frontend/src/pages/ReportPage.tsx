/** A printable results report: summary, design checks, flagged elements, plan. Print → Save as PDF. */
import { engineFromReport } from '../components/RunSummaryCard'
import { displayVersion } from '../lib/version'
import { formatVolume, networkCounts } from '../lib/units'
import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import type { Feature } from 'geojson'
import { api, ENGINE_LABELS, type ModelNetwork, type RptTable } from '../api/client'
import { Button } from '../components/ui'
import { NetworkPlan } from '../components/NetworkPlan'
import { useRunSummary } from '../components/RunSummaryCard'
import { loadRules } from '../components/map/ReviewPanel'
import { buildAttributes, classify, runChecks } from '../lib/elementAttributes'
import { explainEngineMessage } from '../lib/engineErrors'
import { useNotes } from '../lib/notes'
import { convertTable, useUnitSystem } from '../lib/units'

const CAP_COLORS = ['#16a34a', '#ca8a04', '#ea580c', '#dc2626']
const CAP_BREAKS = [0, 0.5, 0.8, 1, Infinity]
const fmt = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(1) : String(Number(v.toPrecision(4)))) : String(v ?? ''))

function Table({ t, rows, cols }: { t: RptTable; rows: RptTable['rows']; cols?: number[] }) {
  const idx = cols ?? t.columns.map((_, i) => i)
  return (
    <table className="w-full border-collapse text-[10.5pt]">
      <thead>
        <tr className="border-b-2 border-slate-300 text-left">
          {idx.map((i) => (
            <th key={i} className={`py-1 pr-3 font-semibold ${i ? 'text-right' : ''}`}>
              {t.columns[i]}
              {t.units?.[i] ? <span className="font-normal text-slate-500"> ({t.units[i]})</span> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-slate-200">
            {idx.map((i) => (
              <td key={i} className={`py-0.5 pr-3 tabular-nums ${i ? 'text-right' : 'font-medium'}`}>
                {fmt(r[i])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-7 break-after-avoid border-b border-slate-300 pb-1 text-[14pt] font-semibold">{children}</h2>
}

export function ReportPage() {
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const { notes } = useNotes()
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const info = useQuery({ queryKey: ['app-info-report'], queryFn: api.appInfo, retry: false })
  const summary = useRunSummary(project.data?.has_out ? project.data.path : null)
  const s = summary.data?.available ? summary.data : undefined
  const us = ['CFS', 'GPM', 'MGD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const attrs = useMemo(
    () => (network.data ? buildAttributes(network.data.geojson.features as Feature[], s?.tables, us) : []),
    [network.data, s, us],
  )
  const rules = loadRules(us)
  const checks = useMemo(() => runChecks(attrs, rules), [attrs, rules])
  const cap = attrs.find((a) => a.key === 'r:Link Flow Summary:Max/Full Flow')
  const system = useUnitSystem()
  const table = (title: string) => {
    const t = s?.tables?.find((x) => x.title === title)
    return t ? convertTable(t, system) : undefined
  }
  const flooding = table('Node Flooding Summary')
  const linkFlow = table('Link Flow Summary')
  const runoff = table('Subcatchment Runoff Summary')
  const capCol = linkFlow?.columns.indexOf('Max/Full Flow') ?? -1
  const worstLinks = linkFlow && capCol > 0 ? [...linkFlow.rows].filter((r) => typeof r[capCol] === 'number').sort((x, y) => Number(y[capCol]) - Number(x[capCol])).slice(0, 25) : []
  const issues = [...(s?.errors ?? []), ...(s?.warnings ?? [])].map(explainEngineMessage)
  const c = network.data?.counts ?? {}
  const links = c.links ?? 0
  const name = project.data?.inp_name.replace(/\.inp$/i, '') ?? ''

  return (
    <div className="h-full overflow-auto bg-surface px-6 py-5 print:bg-white print:p-0">
      <div className="print-hidden mx-auto mb-4 flex max-w-[52rem] items-center gap-3">
        <div className="flex-1">
          <h1 className="m-0 text-[19px] font-semibold text-fg">Report</h1>
          <p className="m-0 mt-1 text-[13px] text-muted">A summary of the model and its last run, ready to print or save as PDF. Design checks use the rules from Review mode on the map.</p>
        </div>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print or save as PDF
        </Button>
      </div>
      <article className="mx-auto max-w-[52rem] rounded-md bg-white px-12 py-10 font-sans text-[11pt] leading-snug text-slate-900 shadow-[var(--shadow-panel)] print:max-w-none print:rounded-none print:px-0 print:py-0 print:shadow-none">
        <header className="border-b-2 border-slate-800 pb-3">
          <div className="text-[10pt] uppercase tracking-wide text-slate-500">Stormwater model results</div>
          <h1 className="m-0 mt-1 text-[22pt] font-semibold">{name}</h1>
          <div className="mt-1 text-[10pt] text-slate-600">
            {project.data?.scenario_name} scenario · {ENGINE_LABELS[project.data?.simulation_engine ?? 'pyswmm']} · flow units {project.data?.flow_units} · {project.data?.crs} · printed{' '}
            {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        {!s ? (
          <p className="mt-6 text-slate-600">There are no results for this model yet. Run it, then come back to this page.</p>
        ) : (
          <>
            {project.data?.results_stale && (
              <p className="mt-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-[10pt] text-amber-900">
                The model was changed after this run. Re-run it before relying on these results.
              </p>
            )}
            <H2>Summary</H2>
            <table className="w-full border-collapse text-[10.5pt]">
              <tbody>
                {(
                  [
                    ['Network', networkCounts({ ...c, links })],
                    ['Runoff continuity error', s.runoff_continuity_pct != null ? `${s.runoff_continuity_pct.toFixed(2)} %` : '—'],
                    ['Flow routing continuity error', s.routing_continuity_pct != null ? `${s.routing_continuity_pct.toFixed(2)} %` : '—'],
                    ['Flooded nodes', `${s.flooded_nodes ?? 0}`],
                    ['Flood volume', s.flooded_nodes ? formatVolume(s.flood_volume, s.flood_volume_units, { nonZero: true }) : '0'],
                    ['Surcharged nodes / conduits', `${s.surcharged_nodes ?? 0} / ${s.surcharged_conduits ?? 0}`],
                    ['Design check failures', `${checks.failures.length}`],
                    ['Engine', engineFromReport(s.engine) ?? '—'],
                    ['Run time', s.elapsed ?? '—'],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <tr key={k} className="border-b border-slate-200">
                    <th className="w-64 py-1 pr-3 text-left font-medium text-slate-600">{k}</th>
                    <td className="py-1">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {network.data && (
              <figure className="m-0 mt-6 break-inside-avoid">
                <NetworkPlan
                  network={network.data}
                  className="h-auto w-full rounded border border-slate-200"
                  colorFor={cap ? (k, id) => (k === 'link' && cap.values.has(id) ? CAP_COLORS[classify(cap.values.get(id)!, CAP_BREAKS)] : null) : undefined}
                  title="Network plan coloured by pipe capacity used"
                />
                <figcaption className="mt-1 flex flex-wrap gap-4 text-[9.5pt] text-slate-600">
                  <span>Figure 1. Network plan, pipes coloured by peak flow as a share of full-pipe capacity:</span>
                  {['under 50 %', '50–80 %', '80–100 %', 'over capacity'].map((l, i) => (
                    <span key={l} className="inline-flex items-center gap-1">
                      <span className="inline-block h-1 w-4" style={{ background: CAP_COLORS[i] }} />
                      {l}
                    </span>
                  ))}
                </figcaption>
              </figure>
            )}

            <H2>Design checks</H2>
            <table className="w-full border-collapse text-[10.5pt]">
              <thead>
                <tr className="border-b-2 border-slate-300 text-left">
                  <th className="py-1 pr-3">Check</th>
                  <th className="py-1 pr-3">Fails when</th>
                  <th className="py-1 pr-3 text-right">Failures</th>
                  <th className="py-1">Elements</th>
                </tr>
              </thead>
              <tbody>
                {rules
                  .filter((r) => r.enabled)
                  .map((r) => {
                    const f = checks.failures.filter((x) => x.rule.id === r.id)
                    const na = checks.missing.some((m) => m.id === r.id)
                    return (
                      <tr key={r.id} className="border-b border-slate-200 align-top">
                        <td className="py-1 pr-3">{r.label}</td>
                        <td className="py-1 pr-3 tabular-nums">
                          {r.op} {r.limit} {r.unit}
                        </td>
                        <td className={`py-1 pr-3 text-right tabular-nums ${f.length ? 'font-semibold text-red-700' : ''}`}>{na ? 'n/a' : f.length}</td>
                        <td className="py-1 text-[9.5pt] text-slate-600">{f.map((x) => `${x.id} (${fmt(x.value)})`).join(', ') || (na ? 'Not in these results' : 'All pass')}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>

            {flooding && flooding.rows.length > 0 && (
              <>
                <H2>Flooded nodes</H2>
                <Table t={flooding} rows={flooding.rows} />
              </>
            )}
            {worstLinks.length > 0 && linkFlow && (
              <>
                <H2>Most heavily loaded links</H2>
                <p className="mb-2 mt-0 text-[10pt] text-slate-600">The {worstLinks.length} links with the highest peak flow relative to full-pipe capacity.</p>
                <Table t={linkFlow} rows={worstLinks} />
              </>
            )}
            {runoff && runoff.rows.length > 0 && (
              <>
                <H2>Subcatchment runoff</H2>
                <Table t={runoff} rows={runoff.rows.slice(0, 60)} />
                {runoff.rows.length > 60 && <p className="text-[9.5pt] text-slate-500">First 60 of {runoff.rows.length}; the full table is in the .rpt file.</p>}
              </>
            )}
            {Object.keys(notes).length > 0 && (
              <>
                <H2>Review notes</H2>
                <table className="w-full border-collapse text-[10.5pt]">
                  <tbody>
                    {Object.entries(notes).map(([k, n]) => (
                      <tr key={k} className="border-b border-slate-200 align-top">
                        <th className="w-40 py-1 pr-3 text-left font-medium capitalize">{k.replace(':', ' ')}</th>
                        <td className="whitespace-pre-wrap py-1">{n.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {issues.length > 0 && (
              <>
                <H2>Engine messages</H2>
                <ul className="m-0 list-disc space-y-1 pl-5 text-[10pt]">
                  {issues.slice(0, 40).map((e, i) => (
                    <li key={i}>
                      {e.text}
                      {e.hint ? <span className="text-slate-500"> {e.hint}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <footer className="mt-10 border-t border-slate-300 pt-2 text-[9pt] text-slate-500">
          Made with Saturday-SWMM{info.data?.version ? ` ${displayVersion(info.data.version)}` : ''} · {project.data?.path}
        </footer>
      </article>
    </div>
  )
}
