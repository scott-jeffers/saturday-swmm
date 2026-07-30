import { useCallback, useRef, useState } from 'react'
import {
  DEFAULT_STATION_ID,
  getStation,
  isValidStationId,
} from '../lib/broadcastStations'
import {
  loadGreatsMusicStation,
  saveGreatsMusicStation,
} from '../lib/broadcastStorage'

/**
 * App-wide broadcast bed — one Audio element persists across navigation.
 * Audio is created lazily on ensureStarted() or the first unmute / station pick.
 *
 * Browsers block unmuted autoplay. Start muted; unmute on the first user gesture.
 */
export function useBroadcastAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingUnmuteRef = useRef(false)
  const fallingBackRef = useRef(false)
  const stationIdRef = useRef(loadGreatsMusicStation())

  const [stationId, setStationIdState] = useState(() => stationIdRef.current)
  const [muted, setMuted] = useState(true)
  const [wantsMusic, setWantsMusic] = useState(false)
  const [ready, setReady] = useState(false)

  const station = getStation(stationId)

  const teardownAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.onerror = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audioRef.current = null
  }, [])

  const stop = useCallback(() => {
    teardownAudio()
    pendingUnmuteRef.current = false
    fallingBackRef.current = false
    setReady(false)
    setMuted(true)
  }, [teardownAudio])

  const attachStation = useCallback(
    (
      id: string,
      opts: { muted: boolean; pendingUnlock: boolean; playUnmuted: boolean },
    ) => {
      const next = getStation(id)
      teardownAudio()

      const audio = new Audio(next.url)
      audio.loop = next.loop
      audio.preload = 'auto'
      audio.muted = opts.muted
      audioRef.current = audio
      stationIdRef.current = next.id
      setStationIdState(next.id)
      setMuted(opts.muted)
      pendingUnmuteRef.current = opts.pendingUnlock
      setReady(true)

      audio.onerror = () => {
        if (fallingBackRef.current) return
        if (next.id === DEFAULT_STATION_ID) return
        fallingBackRef.current = true
        console.warn(`Broadcast station failed: ${next.id}; falling back`)
        saveGreatsMusicStation(DEFAULT_STATION_ID)
        attachStation(DEFAULT_STATION_ID, {
          muted: audio.muted,
          pendingUnlock: pendingUnmuteRef.current,
          playUnmuted: !audio.muted,
        })
        fallingBackRef.current = false
      }

      if (opts.playUnmuted && !opts.muted) {
        void audio.play().catch(() => {})
      } else {
        void audio.play().catch(() => {
          // Muted autoplay can still fail; gesture unlock will retry.
        })
      }
    },
    [teardownAudio],
  )

  /** Idempotent — keeps playing if audio is already active. */
  const ensureStarted = useCallback(
    (opts?: { wantMusicOnShare?: boolean }) => {
      if (audioRef.current) {
        if (opts?.wantMusicOnShare) {
          pendingUnmuteRef.current = true
          setWantsMusic(true)
        }
        return
      }
      const wantMusic = Boolean(opts?.wantMusicOnShare)
      const id = loadGreatsMusicStation()
      setWantsMusic(wantMusic)
      attachStation(id, {
        muted: true,
        pendingUnlock: wantMusic,
        playUnmuted: false,
      })
    },
    [attachStation],
  )

  const applyUnmuted = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return false
    audio.muted = false
    setMuted(false)
    pendingUnmuteRef.current = false
    void audio.play().catch(() => {})
    return true
  }, [])

  const toggleMute = useCallback(() => {
    if (!audioRef.current) ensureStarted()
    const audio = audioRef.current
    if (!audio) return
    if (pendingUnmuteRef.current && audio.muted) {
      applyUnmuted()
      return
    }
    const next = !audio.muted
    audio.muted = next
    setMuted(next)
    pendingUnmuteRef.current = false
    if (!next) {
      void audio.play().catch(() => {})
    }
  }, [applyUnmuted, ensureStarted])

  const setStation = useCallback(
    (id: string) => {
      if (!isValidStationId(id)) return
      saveGreatsMusicStation(id)
      if (id === stationIdRef.current && audioRef.current) return
      if (!audioRef.current) {
        stationIdRef.current = id
        setStationIdState(id)
        return
      }
      const audio = audioRef.current
      const currentlyMuted = audio.muted
      const pending = pendingUnmuteRef.current
      attachStation(id, {
        muted: currentlyMuted,
        pendingUnlock: pending,
        playUnmuted: !currentlyMuted,
      })
    },
    [attachStation],
  )

  const unlockPreferredAudio = useCallback(
    (e?: { target: EventTarget | null }) => {
      if (!pendingUnmuteRef.current) return
      const t = e?.target
      if (
        t instanceof Element &&
        t.closest('button, a, input, textarea, select, [role="button"]')
      ) {
        return
      }
      applyUnmuted()
    },
    [applyUnmuted],
  )

  return {
    ensureStarted,
    stop,
    toggleMute,
    unlockPreferredAudio,
    setStation,
    stationId,
    stationLabel: station.label,
    stationShortLabel: station.shortLabel,
    muted,
    awaitingGesture: wantsMusic && muted && ready,
    ready,
  }
}

export type BroadcastAudio = ReturnType<typeof useBroadcastAudio>
