/** Review notes on elements, kept in the project folder (saturday-swmm-notes.json). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { IS_VIEWER } from './mode'

export const NOTES_FILE = 'saturday-swmm-notes.json'
export type Note = { text: string; updated: string }
export type Notes = Record<string, Note> // key: `${object_type}:${id}`

export const noteKey = (t: string, id: string) => `${t}:${id}`

export function useNotes() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['notes'],
    enabled: !IS_VIEWER,
    retry: false,
    queryFn: async (): Promise<Notes> => {
      try {
        const f = await api.readProjectFile(NOTES_FILE, { optional: true })
        return f.exists === false || !f.content.trim() ? {} : (JSON.parse(f.content) as Notes)
      } catch {
        return {}
      }
    },
  })
  const save = useMutation({
    mutationFn: async ({ key, text }: { key: string; text: string }) => {
      const cur = { ...(q.data ?? {}) }
      if (text.trim()) cur[key] = { text: text.trim(), updated: new Date().toISOString() }
      else delete cur[key]
      await api.writeProjectFile(NOTES_FILE, JSON.stringify(cur, null, 2))
      return cur
    },
    onSuccess: (n) => qc.setQueryData(['notes'], n),
  })
  return { notes: q.data ?? {}, save }
}
