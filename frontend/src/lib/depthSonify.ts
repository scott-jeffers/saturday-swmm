/**
 * Profile depth sonifier: one discrete note per junction, pitched from
 * that junction's peak depth. AudioContext is created only on user gesture.
 */

const ROOT_MIDI = 52 // E3
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const
const NOTE_SEC_DEFAULT = 0.28
const NOTE_SEC_MIN = 0.16
const NOTE_SEC_MAX = 0.4
const GAP_SEC = 0.06

export type ProfileJunctionSeries = {
  id: string
  values: number[]
}

export type DepthSonifyHandle = {
  stop: () => void
}

function getAudioContextConstructor(): typeof AudioContext {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  )
}

/** Call synchronously inside a click handler so later awaits still have audio. */
export function createUnlockedAudioContext(): AudioContext {
  const ctx = new (getAudioContextConstructor())()
  void ctx.resume()
  return ctx
}

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/** Peak depth and the report period index where it occurs. */
export function peakDepth(values: number[]): { depth: number; periodIndex: number } {
  let depth = 0
  let periodIndex = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v) && (v as number) > depth) {
      depth = v as number
      periodIndex = i
    }
  }
  return { depth, periodIndex }
}

export function profilePeakMax(junctions: ProfileJunctionSeries[]): number {
  let max = 0
  for (const j of junctions) {
    const { depth } = peakDepth(j.values)
    if (depth > max) max = depth
  }
  return max
}

export function noteDurationSec(junctionCount: number, preferred = NOTE_SEC_DEFAULT): number {
  if (junctionCount <= 0) return preferred
  const targetTotal = Math.min(8, Math.max(2.5, junctionCount * preferred))
  return Math.min(NOTE_SEC_MAX, Math.max(NOTE_SEC_MIN, targetTotal / junctionCount))
}

/** Map peak depth (relative to profile max) onto a pentatonic degree. */
export function peakToMidi(depth: number, depthMax: number): number {
  const t = depthMax > 0 ? Math.min(1, Math.max(0, depth / depthMax)) : 0
  const degree = Math.min(
    PENTATONIC.length - 1,
    Math.round(t * (PENTATONIC.length - 1)),
  )
  return ROOT_MIDI + PENTATONIC[degree]!
}

export function peakToGain(depth: number, depthMax: number): number {
  const t = depthMax > 0 ? Math.min(1, Math.max(0, depth / depthMax)) : 0
  return 0.04 + t * 0.14
}

/**
 * One note per profile junction, pitched by that junction's peak depth.
 * Pass an AudioContext unlocked in the same click turn if you await data first.
 */
export function playProfileDepthSequence(
  junctions: ProfileJunctionSeries[],
  opts?: {
    noteSec?: number
    audioContext?: AudioContext
    onJunction?: (id: string, index: number) => void
    onPeriod?: (periodIndex: number) => void
    onDone?: () => void
  },
): DepthSonifyHandle {
  const alive = junctions.filter((j) => j.values.length > 0)
  if (!alive.length) {
    opts?.audioContext?.close().catch(() => undefined)
    opts?.onDone?.()
    return { stop: () => undefined }
  }

  const noteSec = opts?.noteSec ?? noteDurationSec(alive.length)
  const stepSec = noteSec + GAP_SEC
  const depthMax = Math.max(profilePeakMax(alive), 1e-6)

  const ctx = opts?.audioContext ?? new (getAudioContextConstructor())()
  const ownsContext = !opts?.audioContext
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)

  const timers: number[] = []
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    for (const id of timers) window.clearTimeout(id)
    timers.length = 0
    void ctx.close().catch(() => undefined)
  }

  const schedule = () => {
    if (stopped) return
    const t0 = ctx.currentTime + 0.04

    alive.forEach((junction, ji) => {
      const { depth, periodIndex } = peakDepth(junction.values)
      const start = t0 + ji * stepSec
      const end = start + noteSec
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = midiToFreq(peakToMidi(depth, depthMax))
      const gain = Math.max(0.001, peakToGain(depth, depthMax))
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(gain, start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(g)
      g.connect(master)
      osc.start(start)
      osc.stop(end + 0.02)

      const wallMs = ji * stepSec * 1000
      timers.push(
        window.setTimeout(() => {
          if (stopped) return
          opts?.onJunction?.(junction.id, ji)
          opts?.onPeriod?.(periodIndex)
        }, Math.max(0, wallMs)),
      )
    })

    const totalMs = alive.length * stepSec * 1000 + 80
    timers.push(
      window.setTimeout(() => {
        if (stopped) return
        stop()
        opts?.onDone?.()
      }, totalMs),
    )
  }

  if (ownsContext || ctx.state !== 'running') {
    void ctx.resume().then(schedule)
  } else {
    schedule()
  }

  return { stop }
}
