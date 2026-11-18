/** Every [OPTIONS] keyword, grouped the way EPA SWMM's Simulation Options dialog groups them. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Button, Panel, useToast } from './ui'

const field =
  'mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg outline-none focus:border-accent'

export function SimOptionsPanel() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const q = useQuery({ queryKey: ['sim-options'], queryFn: api.getSimOptions })
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [group, setGroup] = useState(0)
  useEffect(() => setEdits({}), [q.data])

  const save = useMutation({
    mutationFn: () => api.putSimOptions(edits),
    onSuccess: (d) => {
      qc.setQueryData(['sim-options'], d)
      for (const k of ['project', 'simulation-window', 'model-check', 'inp', 'section']) void qc.invalidateQueries({ queryKey: [k] })
      toast({ title: 'Simulation options saved', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save options', description: e.message, tone: 'danger' }),
  })

  const groups = q.data?.groups ?? []
  const g = groups[group]
  const dirty = Object.keys(edits).length > 0
  return (
    <Panel title="All simulation options">
      <p className="mb-3 text-[11px] text-muted">
        Every [OPTIONS] setting, grouped like EPA SWMM. Leave a field blank to use the SWMM default.
      </p>
      <div className="mb-3 flex flex-wrap gap-1" role="tablist">
        {groups.map((x, i) => (
          <button
            key={x.name}
            role="tab"
            aria-selected={i === group}
            type="button"
            onClick={() => setGroup(i)}
            className={`rounded-md px-2.5 py-1 text-xs ${i === group ? 'bg-accent/20 text-fg' : 'text-muted hover:bg-white/5'}`}
          >
            {x.name}
          </button>
        ))}
      </div>
      {g && (
        <div className="grid gap-3 sm:grid-cols-2">
          {g.options.map((o) => {
            const v = edits[o.key] ?? o.value
            return (
              <label key={o.key} className="block text-xs text-muted">
                {o.label}
                {o.choices ? (
                  <select className={field} value={v} onChange={(e) => setEdits((p) => ({ ...p, [o.key]: e.target.value }))}>
                    <option value="">(default)</option>
                    {o.choices.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, ' ')}
                      </option>
                    ))}
                    {v && !o.choices.includes(v) && <option value={v}>{v}</option>}
                  </select>
                ) : (
                  <input
                    className={field}
                    value={v}
                    spellCheck={false}
                    placeholder="default"
                    onChange={(e) => setEdits((p) => ({ ...p, [o.key]: e.target.value }))}
                  />
                )}
              </label>
            )
          })}
        </div>
      )}
      {q.data && Object.keys(q.data.other).length > 0 && (
        <p className="mt-3 text-[11px] text-muted">
          Also set: {Object.entries(q.data.other).map(([k, v]) => `${k} ${v}`).join(', ')} (edit in Model data → Options).
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save options'}
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setEdits({})}>
          Discard
        </Button>
      </div>
    </Panel>
  )
}
