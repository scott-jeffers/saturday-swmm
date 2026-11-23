/** A small, fast fingerprint of a text (FNV-1a with the length): equal texts, equal prints. */
export function fingerprint(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return `${s.length}:${(h >>> 0).toString(36)}`
}
