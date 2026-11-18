/** Ask the map to select an object (e.g. from a results table on another page). */
export type FocusTarget = { object_type: 'node' | 'link' | 'subcatchment'; id: string }

let pending: FocusTarget | null = null
const subs = new Set<() => void>()

export function focusOnMap(t: FocusTarget) {
  pending = t
  subs.forEach((f) => f())
}

export function takeMapFocus(): FocusTarget | null {
  const t = pending
  pending = null
  return t
}

export function subscribeMapFocus(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
