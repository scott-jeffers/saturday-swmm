/** Engine errors and warnings in plain language, each with a "Show on map" link. */
import { AlertCircle, AlertTriangle, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { explainEngineMessage } from '../lib/engineErrors'
import { focusOnMap } from '../lib/mapFocus'
import { cn } from '../lib/cn'
import { MANUAL } from '../lib/manual'
import { ManualLink } from './ManualLink'

export function EngineIssueList({ messages, className, limit = 30 }: { messages: string[]; className?: string; limit?: number }) {
  const navigate = useNavigate()
  const items = messages.slice(0, limit).map(explainEngineMessage)
  return (
    <ul className={cn('m-0 list-none space-y-1.5 overflow-y-auto p-0 text-[12px]', className)}>
      {items.map((e, i) => (
        <li key={i} className="flex items-start gap-2" title={e.raw}>
          {e.severity === 'error' ? (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-fg">{e.text}</div>
            {e.hint && <div className="text-muted">{e.hint}</div>}
          </div>
          {e.objectId && e.objectType && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded px-1 text-accent-soft hover:bg-fg/[0.06]"
              onClick={() => {
                focusOnMap({ object_type: e.objectType!, id: e.objectId! })
                navigate('/map')
              }}
            >
              <MapPin className="h-3 w-3" /> Show
            </button>
          )}
        </li>
      ))}
      {messages.length > limit && <li className="text-muted">and {messages.length - limit} more in the report</li>}
      {messages.length > 0 && (
        <li>
          <ManualLink href={MANUAL.errors} className="text-[11px]">
            Every error and warning explained
          </ManualLink>
        </li>
      )}
    </ul>
  )
}
