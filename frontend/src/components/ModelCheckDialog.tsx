/** "Check model" results: errors, warnings and notes, each linked to the map. */

import { AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModelCheck, ModelIssue } from '../api/client'
import { focusOnMap, type FocusTarget } from '../lib/mapFocus'
import { Button, Dialog, DialogContent } from './ui'

const ICON = {
  error: <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Error" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-label="Warning" />,
  info: <Info className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Note" />,
}

export function ModelCheckDialog({
  open,
  onOpenChange,
  check,
  onRunAnyway,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  check: ModelCheck | undefined
  /** When set, the dialog was opened by Run and offers to run regardless. */
  onRunAnyway?: () => void
}) {
  const navigate = useNavigate()
  const issues = check?.issues ?? []
  const ok = check && check.errors === 0 && check.warnings === 0
  const show = (i: ModelIssue) => {
    if (!i.id || !i.object_type || !['node', 'link', 'subcatchment'].includes(i.object_type)) return
    focusOnMap({ object_type: i.object_type as FocusTarget['object_type'], id: i.id })
    navigate('/map')
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(640px,calc(100vw-2rem))]"
        title={onRunAnyway ? 'Fix these before running?' : 'Model check'}
        description={
          !check
            ? 'Checking…'
            : ok
              ? 'No problems found. The model is ready to run.'
              : `${check.errors} error${check.errors === 1 ? '' : 's'}, ${check.warnings} warning${check.warnings === 1 ? '' : 's'}. Click an item to find it on the map.`
        }
      >
        {issues.length > 0 && (
          <ul className="m-0 max-h-[50vh] list-none space-y-0.5 overflow-y-auto p-0">
            {issues.map((i, n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => show(i)}
                  disabled={!i.id}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-soft hover:bg-white/5 disabled:hover:bg-transparent"
                >
                  {ICON[i.severity]}
                  <span>{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {onRunAnyway && (
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                onRunAnyway()
              }}
            >
              Run anyway
            </Button>
          )}
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {onRunAnyway ? 'Fix first' : 'Done'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
