/** Small per-browser preferences with change notifications. */
import { useSyncExternalStore } from 'react'

const EVENT = 'saturday-swmm-prefs'

export function getPref(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(`saturday-swmm.${key}`) ?? fallback
  } catch {
    return fallback
  }
}

export function setPref(key: string, value: string) {
  try {
    localStorage.setItem(`saturday-swmm.${key}`, value)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function usePref(key: string, fallback = ''): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb)
      window.addEventListener('storage', cb)
      return () => {
        window.removeEventListener(EVENT, cb)
        window.removeEventListener('storage', cb)
      }
    },
    () => getPref(key, fallback),
  )
}
