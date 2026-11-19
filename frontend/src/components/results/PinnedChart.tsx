/** A small chart for one element, pinned beside others in the map dock. */
import { ExternalLink, X } from 'lucide-react'
import { useObjectSeries, type SeriesKind } from '../../hooks/useObjectSeries'
import { TimeSeriesChart } from '../TimeSeriesChart'

export function PinnedChart({ kind, id, onUnpin, onPopOut }: { kind: SeriesKind; id: string; onUnpin: () => void; onPopOut?: () => void }) {
  const s = useObjectSeries(kind, id)
  return (
    <div className="relative min-w-[22rem] flex-1 rounded-[var(--radius-panel)] border border-border bg-surface/40 p-2">
      <div className="absolute right-1.5 top-1.5 z-10 flex gap-0.5">
        {onPopOut && (
          <button type="button" onClick={onPopOut} aria-label={`Open ${id} in its own window`} title="Pop out" className="rounded p-0.5 text-muted hover:bg-fg/5 hover:text-fg">
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" onClick={onUnpin} aria-label={`Unpin ${id}`} title="Unpin" className="rounded p-0.5 text-muted hover:bg-fg/5 hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <TimeSeriesChart series={s.series.data} yLabel={s.yLabel} variables={s.variables} variable={s.variable} onVariableChange={s.setVariable} />
    </div>
  )
}

/** The chart alone, for a pop-out window. */
export function ElementChart({ kind, id }: { kind: SeriesKind; id: string }) {
  const s = useObjectSeries(kind, id)
  return <TimeSeriesChart series={s.series.data} yLabel={s.yLabel} variables={s.variables} variable={s.variable} onVariableChange={s.setVariable} />
}
