import { useRef, useState } from 'react'
import { Music, Volume2, VolumeX } from 'lucide-react'
import type { BroadcastAudio } from '../hooks/useBroadcastAudio'
import { BroadcastMusicPicker } from './BroadcastMusicPicker'
import { cn } from '../lib/cn'

/** Compact station + mute controls for the app header. */
export function BroadcastControls({ audio }: { audio: BroadcastAudio }) {
  const {
    toggleMute,
    setStation,
    stationId,
    stationShortLabel,
    muted,
    awaitingGesture,
  } = audio
  const [musicOpen, setMusicOpen] = useState(false)
  const musicButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <button
        ref={musicButtonRef}
        type="button"
        onClick={() => setMusicOpen((o) => !o)}
        className={cn(
          'inline-flex h-7 max-w-[9rem] items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors',
          musicOpen
            ? 'border-accent/50 bg-accent-strong/20 text-accent-soft'
            : 'border-border-strong bg-elevated text-fg-soft hover:border-accent hover:text-fg',
        )}
        aria-label={`Music station: ${stationShortLabel}`}
        aria-expanded={musicOpen}
        title={stationShortLabel}
      >
        <Music className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="hidden truncate sm:inline">{stationShortLabel}</span>
      </button>
      <button
        type="button"
        onClick={toggleMute}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors',
          awaitingGesture
            ? 'border-amber-400/50 bg-amber-400/20 text-amber-100'
            : muted
              ? 'border-border-strong bg-elevated text-fg-soft hover:border-accent hover:text-fg'
              : 'border-accent/40 bg-accent-strong/15 text-accent-soft',
        )}
        aria-label={
          awaitingGesture ? 'Tap to play music' : muted ? 'Unmute music' : 'Mute music'
        }
        title={awaitingGesture ? 'Tap for sound' : muted ? 'Unmute' : 'Mute'}
      >
        {muted ? (
          <VolumeX className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Volume2 className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
      {musicOpen && (
        <BroadcastMusicPicker
          stationId={stationId}
          stationShortLabel={stationShortLabel}
          onSelect={setStation}
          onClose={() => setMusicOpen(false)}
          anchorRef={musicButtonRef}
        />
      )}
    </div>
  )
}
