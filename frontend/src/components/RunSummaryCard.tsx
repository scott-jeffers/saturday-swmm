/**
 * What a modeller checks first after a run: continuity errors, flooding,
 * surcharge, warnings and errors — read from the report.
 */

import { formatVolume } from '../lib/units'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type RptSummary } from '../api/client'
import { EngineIssueList } from './EngineIssueList'

/** Continuity error over 5% is a common "look into this" threshold; over 10% a "don't trust it". */
function continuityTone(v?: number | null) {
  if (v == null) return 'text-muted'
  const a = Math.abs(v)
  return a > 10 ? 'text-danger' : a > 5 ? 'text-warning' : 'text-success'
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

/** "EPA SWMM 5.2" / "OpenSWMM 6 (pre-release)" from the report's banner line. */
export function engineFromReport(banner?: string | null): string | null {
  if (!banner) return null
  if (/OPENSWMM/i.test(banner)) {
    const v = /VERSION\s+([\w.-]+)/i.exec(banner)?.[1] ?? ''
    return `OpenSWMM ${v.split('.')[0] || '6'}${/alpha|beta|rc|dev/i.test(v) ? ' (pre-release)' : ''}`
  }
  const epa = /VERSION\s+(\d+\.\d+)/i.exec(banner)
  if (/EPA|STORM WATER/i.test(banner) && epa) return `EPA SWMM ${epa[1]}`
  return banner.trim()
}

/**
 * Errors are shown; warnings fold into one line. A run that worked should lead
 * with its numbers, not with a wall of engine notes.
 */
function IssueFold({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  const [open, setOpen] = useState(false)
  if (!errors.length && !warnings.length) return null
  return (
    <div className="mt-3">
      {errors.length > 0 && <EngineIssueList messages={errors} className="max-h-40" />}
      {warnings.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            {warnings.length} engine warning{warnings.length > 1 ? 's' : ''}
          </button>
          {open && <EngineIssueList messages={warnings} className="mt-1 max-h-40" />}
        </>
      )}
    </div>
  )
}

export function RunSummaryBody({ s }: { s: RptSummary }) {
  const engine = engineFromReport(s.engine)
  const pct = (v?: number | null) => (v == null ? '—' : `${v.toFixed(2)} %`)
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Stat label="Runoff continuity error" value={pct(s.runoff_continuity_pct)} tone={continuityTone(s.runoff_continuity_pct)} />
        <Stat label="Routing continuity error" value={pct(s.routing_continuity_pct)} tone={continuityTone(s.routing_continuity_pct)} />
        <Stat label="Flooded nodes" value={String(s.flooded_nodes ?? 0)} tone={s.flooded_nodes ? 'text-warning' : undefined} />
        <Stat label="Surcharged nodes" value={String(s.surcharged_nodes ?? 0)} />
        <Stat label="Surcharged conduits" value={String(s.surcharged_conduits ?? 0)} />
        <Stat
          label="Flood volume"
          value={s.flooded_nodes ? formatVolume(s.flood_volume, s.flood_volume_units, { nonZero: true }) : '0'}
          tone={s.flooded_nodes ? 'text-warning' : undefined}
        />
      </div>
      <IssueFold errors={s.errors ?? []} warnings={s.warnings ?? []} />
      {(engine || s.elapsed) && (
        <p className="mb-0 mt-3 text-[11px] text-muted">
          {[engine && `Results from ${engine}`, s.elapsed && `run time ${s.elapsed}`].filter(Boolean).join(', ')}
        </p>
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
    <div className="map-overlay pointer-events-auto absolute right-3 top-3 z-30 w-[22rem] p-4">
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
