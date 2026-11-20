/** Ask the map page to tick something in its Graphs tab and open it. */
type Fn = (keys: string[]) => void
const subs = new Set<Fn>()
export function requestGraph(...keys: string[]) {
  subs.forEach((f) => f(keys))
}
export function subscribeGraphRequests(f: Fn) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
