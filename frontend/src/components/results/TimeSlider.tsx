import { useEffect, useRef } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Layers2,
  Mountain,
  Music,
  Pause,
  Play,
} from 'lucide-react'
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
  /** When true, map shows per-element max-over-time (not a single period). */
  showAllPeaks?: boolean
  onShowAllPeaksChange?: (v: boolean) => void
  /** Auto-advance through periods. */
  playing?: boolean
  onPlayingChange?: (v: boolean) => void
  /** Interval between play steps (ms). */
  playIntervalMs?: number
  /** Sonify depth hydrograph (profile / selected node). */
  sonifyAvailable?: boolean
  sonifyPlaying?: boolean
  sonifyLabel?: string | null
  onSonifyToggle?: () => void
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
  showAllPeaks = false,
  onShowAllPeaksChange,
  playing = false,
  onPlayingChange,
  playIntervalMs = 450,
  sonifyAvailable = false,
  sonifyPlaying = false,
  sonifyLabel = null,
  onSonifyToggle,
}: TimeSliderProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const periodRef = useRef(period)
  periodRef.current = period
  const periodCountRef = useRef(periodCount)
  periodCountRef.current = periodCount
  const onPlayingChangeRef = useRef(onPlayingChange)
  onPlayingChangeRef.current = onPlayingChange

  useEffect(() => {
    if (!playing || disabled || showAllPeaks || periodCount < 1) return
    const id = window.setInterval(() => {
      const next = periodRef.current + 1
      if (next >= periodCountRef.current) {
        onPlayingChangeRef.current?.(false)
        return
      }
      onChangeRef.current(next)
    }, playIntervalMs)
    return () => window.clearInterval(id)
  }, [playing, disabled, showAllPeaks, periodCount, playIntervalMs])

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

  const scrubDisabled = disabled || showAllPeaks
  const atPeak = !showAllPeaks && peakPeriod != null && period === peakPeriod
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
          {showAllPeaks
            ? 'Showing max value of each element'
            : `${period + 1} / ${periodCount}${timeLabel ? ` — ${timeLabel}` : ''}`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, periodCount - 1)}
        value={period}
        disabled={scrubDisabled}
        onChange={(e) => {
          onPlayingChange?.(false)
          onChange(Number(e.target.value))
        }}
        className="w-full"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={playing ? 'primary' : 'outline'}
          disabled={disabled || showAllPeaks || periodCount < 2}
          title={playing ? 'Pause' : 'Play through time series'}
          onClick={() => {
            if (playing) {
              onPlayingChange?.(false)
              return
            }
            onShowAllPeaksChange?.(false)
            if (period >= periodCount - 1) onChange(0)
            onPlayingChange?.(true)
          }}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        {onSonifyToggle && (
          <Button
            size="sm"
            variant={sonifyPlaying ? 'primary' : 'outline'}
            disabled={disabled || !sonifyAvailable}
            title={
              sonifyPlaying
                ? 'Stop depth melody'
                : sonifyAvailable
                  ? `Play each profile junction as one note from its peak depth${
                      sonifyLabel ? ` (${sonifyLabel})` : ''
                    }`
                  : 'Pick a profile with depth results to sonify'
            }
            aria-label={sonifyPlaying ? 'Stop depth melody' : 'Play depth melody'}
            onClick={() => {
              onPlayingChange?.(false)
              onShowAllPeaksChange?.(false)
              onSonifyToggle()
            }}
          >
            <Music className="h-3.5 w-3.5" />
            {sonifyPlaying ? 'Stop' : 'Tune'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={scrubDisabled || period <= 0}
          onClick={() => {
            onPlayingChange?.(false)
            onChange(Math.max(0, period - 1))
          }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={scrubDisabled || period >= periodCount - 1}
          onClick={() => {
            onPlayingChange?.(false)
            onChange(Math.min(periodCount - 1, period + 1))
          }}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={atPeak ? 'primary' : 'outline'}
          disabled={disabled || showAllPeaks || peakPeriod == null}
          title={peakTitle}
          onClick={() => {
            onPlayingChange?.(false)
            onShowAllPeaksChange?.(false)
            peakPeriod != null && onChange(peakPeriod)
          }}
        >
          <Mountain className="h-3.5 w-3.5" />
          Peak
        </Button>
        <Button
          size="sm"
          variant={showAllPeaks ? 'primary' : 'outline'}
          disabled={disabled}
          title="Show each element's maximum value across the full time series (not a single time step)"
          onClick={() => {
            onPlayingChange?.(false)
            onShowAllPeaksChange?.(!showAllPeaks)
          }}
        >
          <Layers2 className="h-3.5 w-3.5" />
          All peaks
        </Button>
      </div>
    </div>
  )
}
