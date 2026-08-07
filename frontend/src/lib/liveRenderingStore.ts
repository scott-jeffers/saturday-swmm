/** Client preference: paint Solver-memory results while a run is in progress. */

const LIVE_RENDERING_KEY = 'saturday-swmm-live-rendering'

let liveRendering = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function readStored(): boolean {
  try {
    return localStorage.getItem(LIVE_RENDERING_KEY) === '1'
  } catch {
    return false
  }
}

liveRendering = readStored()

export function getLiveRendering(): boolean {
  return liveRendering
}

export function setLiveRendering(enabled: boolean): void {
  liveRendering = Boolean(enabled)
  try {
    localStorage.setItem(LIVE_RENDERING_KEY, liveRendering ? '1' : '0')
  } catch {
    /* ignore */
  }
  emit()
}

export function subscribeLiveRendering(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
