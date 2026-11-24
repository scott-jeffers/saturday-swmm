/**
 * "What went wrong, where, how bad": flooded nodes and surcharged pipes,
 * worst first, each a click away on the map. Built from the parsed report so
 * it works for every engine. The full report tables stay below it.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Droplets, Gauge } from 'lucide-react'
import { api, type RptSummary, type RptTable } from '../../api/client'
import { useQuery } from '@tanstack/react-query'
import { focusOnMap } from '../../lib/mapFocus'
import { formatVolume } from '../../lib/units'

export interface Problem {
  kind: 'flooding' | 'surcharge'
  objectType: 'node' | 'link'
  id: string
  /** Sort key: flood volume for nodes, hours surcharged for pipes. */
  severity: number
  headline: string
  detail: string
}

function col(t: RptTable | undefined, name: string): number {
  return t ? t.columns.indexOf(name) : -1
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const hrs = (h: number) => `${h < 10 ? h.toFixed(2) : h.toFixed(1)} h`

/** Exported for tests. */
export function problemsFromSummary(s: RptSummary, pressurized: Set<string> = new Set()): Problem[] {
  const tables = s.tables ?? []
  const byTitle = (title: string) => tables.find((t) => t.title === title)
  const out: Problem[] = []

  const flood = byTitle('Node Flooding Summary')
  if (flood) {
    const iv = col(flood, 'Total Flood Volume')
    const ih = col(flood, 'Hours Flooded')
    const ir = col(flood, 'Max Rate')
    const ip = col(flood, 'Max Ponded Depth')
    const vu = iv >= 0 ? flood.units[iv] : ''
    for (const r of flood.rows) {
      const vol = num(r[iv])
      const parts = [`for ${hrs(num(r[ih]))}`]
      if (ir >= 0 && num(r[ir]) > 0) parts.push(`peak ${num(r[ir])} ${flood.units[ir] || ''}`.trim())
      if (ip >= 0 && num(r[ip]) > 0) parts.push(`ponded ${num(r[ip])} ${flood.units[ip] || ''}`.trim())
      out.push({
        kind: 'flooding',
        objectType: 'node',
        id: String(r[0]),
        severity: vol * 1e6 + num(r[ih]),
        headline: `Floods ${formatVolume(vol, vu, { nonZero: true })}`,
        detail: parts.join(' · '),
      })
    }
  }

  const sur = byTitle('Conduit Surcharge Summary')
  if (sur) {
    const ib = col(sur, 'Hours Full Both Ends')
    const ia = col(sur, 'Hours Above Full Normal Flow')
    const ic = col(sur, 'Hours Capacity Limited')
    for (const r of sur.rows) {
      const both = num(r[ib])
      const above = num(r[ia])
      const limited = num(r[ic])
      const full = Math.max(both, above)
      if (full <= 0 && limited <= 0) continue
      // Force mains run full by design.
      if (pressurized.has(String(r[0]))) continue
      out.push({
        kind: 'surcharge',
        objectType: 'link',
        id: String(r[0]),
        severity: Math.max(full, limited),
        headline: `Full for ${hrs(Math.max(full, limited))}`,
        detail: [
          limited > 0 ? `over capacity ${hrs(limited)}` : '',
          both > 0 ? `both ends full ${hrs(both)}` : '',
          above > 0 ? `above full flow ${hrs(above)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  // Flooding first (it reaches the street), then pipes; worst first in each.
  return out.sort((a, b) => (a.kind === b.kind ? b.severity - a.severity : a.kind === 'flooding' ? -1 : 1))
}

export function ProblemsList({ summary }: { summary: RptSummary }) {
  const navigate = useNavigate()
  const network = useQuery({ queryKey: ['network'], queryFn: () => api.getNetwork(), staleTime: 60_000 })
  const forceMains = useMemo(
    () => new Set((network.data?.geojson.features ?? []).filter((f) => String(f.properties?.shape ?? '').toUpperCase() === 'FORCE_MAIN').map((f) => String(f.properties?.id))),
    [network.data],
  )
  const problems = useMemo(() => problemsFromSummary(summary, forceMains), [summary, forceMains])
  const [all, setAll] = useState(false)
  const shown = all ? problems : problems.slice(0, 12)

  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-soft">
        <CheckCircle2 className="h-4 w-4 text-success" />
        No node flooded and no pipe ran full in this run.
      </div>
    )
  }
  return (
    <div>
      <ul className="m-0 grid list-none gap-1 p-0">
        {shown.map((p) => {
          const Icon = p.kind === 'flooding' ? Droplets : Gauge
          return (
            <li key={`${p.kind}-${p.id}`}>
              <button
                type="button"
                title="Show on the map"
                onClick={() => {
                  focusOnMap({ object_type: p.objectType, id: p.id })
                  navigate('/map')
                }}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-fg/5"
              >
                <Icon className={`h-4 w-4 shrink-0 ${p.kind === 'flooding' ? 'text-danger' : 'text-warning'}`} />
                <span className="w-28 shrink-0 truncate font-medium text-accent-soft">{p.id}</span>
                <span className="w-48 shrink-0 text-sm text-fg">{p.headline}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{p.detail}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {problems.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-accent-soft hover:underline">
          {all ? 'Show the worst 12' : `Show all ${problems.length}`}
        </button>
      )}
    </div>
  )
}
