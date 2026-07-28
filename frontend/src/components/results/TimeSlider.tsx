import { ChevronLeft, ChevronRight, Mountain } from 'lucide-react'
import { Button } from '../ui'

interface TimeSliderProps {
  period: number
  periodCount: number
  timeLabel?: string | null
  onChange: (period: number) => void
  disabled?: boolean
  hasExistingOut?: boolean
  peakPeriod?: number | null
  peakTime?: string | null
  peakDepthMax?: number | null
}

export function TimeSlider({
  period,
  periodCount,
  timeLabel,
  onChange,
  disabled,
  hasExistingOut = false,
  peakPeriod = null,
  peakTime = null,
  peakDepthMax = null,
}: TimeSliderProps) {
  if (periodCount < 1) {
    return (
      <div>
        <p className="m-0 text-xs text-muted">
          {hasExistingOut
            ? 'Results file found but periods could not be loaded yet.'
            : 'No output periods. Run a simulation to enable results symbology.'}
        </p>
      </div>
    )
  }

  const atPeak = peakPeriod != null && period === peakPeriod
  const peakTitle =
    peakPeriod != null
      ? `Jump to peak depth (period ${peakPeriod + 1}${
          peakTime ? ` · ${peakTime}` : ''
        }${peakDepthMax != null ? ` · max ${peakDepthMax.toFixed(3)}` : ''})`
      : 'Peak time unavailable'

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
        <strong>Time</strong>
        <span className="text-xs text-muted">
          {period + 1} / {periodCount}
          {timeLabel ? ` — ${timeLabel}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, periodCount - 1)}
        value={period}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || period <= 0}
          onClick={() => onChange(Math.max(0, period - 1))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || period >= periodCount - 1}
          onClick={() => onChange(Math.min(periodCount - 1, period + 1))}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={atPeak ? 'primary' : 'outline'}
          disabled={disabled || peakPeriod == null}
          title={peakTitle}
          onClick={() => peakPeriod != null && onChange(peakPeriod)}
        >
          <Mountain className="h-3.5 w-3.5" />
          Peak
        </Button>
      </div>
    </div>
  )
}
