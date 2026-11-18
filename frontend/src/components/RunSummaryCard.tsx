/**
 * What a modeller checks first after a run: continuity errors, flooding,
 * surcharge, warnings and errors — read from the report.
 */

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type RptSummary } from '../api/client'

/** Continuity error over 5% is a common "look into this" threshold; over 10% a "don't trust it". */
function continuityTone(v?: number | null) {
  if (v == null) return 'text-muted'
  const a = Math.abs(v)
  return a > 10 ? 'text-danger' : a > 5 ? 'text-amber-300' : 'text-emerald-300'
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone ?? 'text-fg'}`}>{value}</div>
    </div>
  )
}

export function useRunSummary(key: unknown) {
  return useQuery({
    queryKey: ['rpt-summary', key],
    queryFn: api.getRptSummary,
    retry: false,
    staleTime: 30_000,
  })
}

export function RunSummaryBody({ s }: { s: RptSummary }) {
  const pct = (v?: number | null) => (v == null ? '—' : `${v.toFixed(2)} %`)
  const issues = [...(s.errors ?? []), ...(s.warnings ?? [])]
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Stat label="Runoff continuity error" value={pct(s.runoff_continuity_pct)} tone={continuityTone(s.runoff_continuity_pct)} />
        <Stat label="Routing continuity error" value={pct(s.routing_continuity_pct)} tone={continuityTone(s.routing_continuity_pct)} />
        <Stat
          label="Flooded nodes"
          value={`${s.flooded_nodes ?? 0}${s.flooded_nodes ? ` · ${s.flood_volume} ${s.flood_volume_units}` : ''}`}
          tone={s.flooded_nodes ? 'text-amber-300' : undefined}
        />
        <Stat label="Surcharged nodes" value={String(s.surcharged_nodes ?? 0)} />
        <Stat label="Surcharged conduits" value={String(s.surcharged_conduits ?? 0)} />
        <Stat label="Run time" value={s.elapsed ?? '—'} />
      </div>
      {issues.length > 0 && (
        <ul className="mt-3 max-h-28 list-none space-y-1 overflow-y-auto p-0 text-[11px]">
          {issues.slice(0, 20).map((w, i) => (
            <li key={i} className={w.startsWith('ERROR') ? 'text-danger' : 'text-amber-200'}>
              {w}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function RunSummaryCard({ runKey, onClose }: { runKey: unknown; onClose: () => void }) {
  const q = useRunSummary(runKey)
  const s = q.data
  if (!s?.available) return null
  const bad =
    (s.errors?.length ?? 0) > 0 ||
    Math.abs(s.routing_continuity_pct ?? 0) > 10 ||
    Math.abs(s.runoff_continuity_pct ?? 0) > 10
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-30 w-[22rem] rounded-xl border border-border bg-elevated/95 p-4 shadow-[var(--shadow-panel)] backdrop-blur">
      <div className="mb-3 flex items-center gap-2">
        {bad ? (
          <AlertTriangle className="h-4 w-4 text-amber-300" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        )}
        <span className="flex-1 text-sm font-semibold text-fg">Run summary</span>
        <Link to="/results" className="text-xs text-accent-soft hover:underline">
          Report tables
        </Link>
        <button type="button" aria-label="Close run summary" onClick={onClose} className="rounded p-0.5 text-muted hover:text-fg">
          <X className="h-4 w-4" />
        </button>
      </div>
      <RunSummaryBody s={s} />
    </div>
  )
}
