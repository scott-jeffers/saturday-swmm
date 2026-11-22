import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { onBackendProgress } from './backend'

/** A small note while the in-browser editor starts (first edit only, a few seconds). */
export default function EditorStatus() {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => onBackendProgress(setText), [])
  if (!text) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-[5.75rem] left-1/2 z-[100] flex -translate-x-1/2 items-center whitespace-nowrap gap-2 rounded-full border border-border bg-elevated px-4 py-2 text-[12px] text-fg-soft shadow-[var(--shadow-panel)]"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-soft" aria-hidden />
      {text}… <span className="text-muted">first edit only</span>
    </div>
  )
}
