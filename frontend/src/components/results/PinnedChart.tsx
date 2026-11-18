/** A small chart for one element, pinned beside others in the map dock. */
import { X } from 'lucide-react'
import { useObjectSeries, type SeriesKind } from '../../hooks/useObjectSeries'
import { TimeSeriesChart } from '../TimeSeriesChart'

export function PinnedChart({ kind, id, onUnpin }: { kind: SeriesKind; id: string; onUnpin: () => void }) {
  const s = useObjectSeries(kind, id)
  return (
    <div className="relative min-w-[22rem] flex-1 rounded-[var(--radius-panel)] border border-border bg-surface/40 p-2">
      <button type="button" onClick={onUnpin} aria-label={`Unpin ${id}`} className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-muted hover:bg-fg/5 hover:text-fg">
        <X className="h-3.5 w-3.5" />
      </button>
      <TimeSeriesChart series={s.series.data} yLabel={s.yLabel} variables={s.variables} variable={s.variable} onVariableChange={s.setVariable} />
    </div>
  )
}
