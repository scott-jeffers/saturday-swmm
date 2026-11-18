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
import { cn } from '../../lib/cn'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function parseSim(t: string | null | undefined) {
  const m = t?.match(/^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/)
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) }
}
/** "2024-06-01T00:55:00" → "Jun 1, 00:55". */
export function formatSimTime(t: string | null | undefined) {
  const p = parseSim(t)
  if (!p) return t ?? null
  return `${MONTHS[p.mo - 1]} ${p.d}, ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`
}
/** Elapsed since the first period, e.g. "+1:05" or "+2d 3:00". */
export function elapsed(start: string | null | undefined, now: string | null | undefined, second?: string | null) {
  const a = parseSim(start)
  const b = parseSim(now)
  if (!a || !b) return null
  const s2 = parseSim(second)
  const step = s2 ? s2.ms - a.ms : 0
  const mins = Math.round((b.ms - a.ms + step) / 60000)
  if (mins < 0) return null
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  return `+${d ? `${d}d ` : ''}${h}:${String(m).padStart(2, '0')}`
}

interface TimeSliderProps {
  period: number
  periodCount: number
  timeLabel?: string | null
  /** Time of the first period, for showing elapsed time. */
  startTime?: string | null
  /** Time of the second period: the gap is added so the first period reads +1 step. */
  secondTime?: string | null
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
  startTime = null,
  secondTime = null,
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

  const iconBtn =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-soft hover:bg-fg/[0.06] hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className={cn(iconBtn, playing && 'bg-accent/15 text-accent-soft')}
          disabled={disabled || showAllPeaks || periodCount < 2}
          title={playing ? 'Pause' : 'Play through time'}
          aria-label={playing ? 'Pause' : 'Play'}
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
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="Previous time step"
          title="Previous time step"
          disabled={scrubDisabled || period <= 0}
          onClick={() => {
            onPlayingChange?.(false)
            onChange(Math.max(0, period - 1))
          }}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="Next time step"
          title="Next time step"
          disabled={scrubDisabled || period >= periodCount - 1}
          onClick={() => {
            onPlayingChange?.(false)
            onChange(Math.min(periodCount - 1, period + 1))
          }}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, periodCount - 1)}
        value={period}
        disabled={scrubDisabled}
        aria-label="Time step"
        onChange={(e) => {
          onPlayingChange?.(false)
          onChange(Number(e.target.value))
        }}
        className="min-w-40 flex-1"
      />
      <span className="min-w-[13rem] shrink-0 text-[12px] tabular-nums text-fg-soft">
        {showAllPeaks ? (
          'Maximum of each element'
        ) : (
          <>
            {formatSimTime(timeLabel) ?? `Step ${period + 1}`}
            {elapsed(startTime, timeLabel, secondTime) && <span className="ml-1.5 text-muted">{elapsed(startTime, timeLabel, secondTime)}</span>}
            <span className="ml-1.5 text-muted">
              {period + 1}/{periodCount}
            </span>
          </>
        )}
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          active={atPeak}
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
          variant="ghost"
          active={showAllPeaks}
          disabled={disabled}
          title="Show each element's maximum over the whole run instead of one time step"
          onClick={() => {
            onPlayingChange?.(false)
            onShowAllPeaksChange?.(!showAllPeaks)
          }}
        >
          <Layers2 className="h-3.5 w-3.5" />
          All peaks
        </Button>
        {onSonifyToggle && (
          <Button
            size="sm"
            variant="ghost"
            active={sonifyPlaying}
            disabled={disabled || !sonifyAvailable}
            title={
              sonifyPlaying
                ? 'Stop depth melody'
                : sonifyAvailable
                  ? `Play each profile junction as one note from its peak depth${sonifyLabel ? ` (${sonifyLabel})` : ''}`
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
      </div>
    </div>
  )
}
