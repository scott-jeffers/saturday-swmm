/** Screen-size checks that re-render when the screen changes (rotation, resize). */
import { useSyncExternalStore } from 'react'

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Phone-sized screens (below Tailwind's md breakpoint). */
export const PHONE_QUERY = '(max-width: 767px)'
export const useIsPhone = () => useMedia(PHONE_QUERY)
export const isPhoneNow = () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches
/** Touch is the main pointer: no hover, pinch to zoom. */
export const useCoarsePointer = () => useMedia('(pointer: coarse)')
