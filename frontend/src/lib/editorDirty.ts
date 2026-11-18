/** Whether the INP editor holds unsaved text, so the header can say so on any page. */
import { useSyncExternalStore } from 'react'

let dirty = false
/** Draft text kept while the user visits other pages. */
export const editorDraft: { text: string | null } = { text: null }
const subs = new Set<() => void>()

export function setEditorDirty(v: boolean) {
  if (!v) editorDraft.text = null
  if (dirty === v) return
  dirty = v
  subs.forEach((f) => f())
}

export function useEditorDirty() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => dirty,
  )
}
