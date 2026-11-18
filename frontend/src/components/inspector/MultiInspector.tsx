/**
 * Several objects selected: what's in the selection, and bulk edits that
 * set, add to or multiply one field on all of them (one undo step).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, type ModelNetwork } from '../../api/client'
import type { Selection } from '../map/NetworkMap'
import { refreshAfterEdit } from '../UndoRedo'
import { Button, Panel, useToast } from '../ui'

type Item = NonNullable<Selection>
type Field = { key: string; label: string; numeric: boolean; kinds?: string[] }

const FIELDS: Record<Item['object_type'], Field[]> = {
  node: [
    { key: 'elevation', label: 'Invert elevation', numeric: true },
    { key: 'max_depth', label: 'Max depth', numeric: true },
    { key: 'init_depth', label: 'Initial depth', numeric: true },
    { key: 'sur_depth', label: 'Surcharge depth', numeric: true, kinds: ['junction'] },
    { key: 'aponded', label: 'Ponded area', numeric: true, kinds: ['junction'] },
  ],
  link: [
    { key: 'roughness', label: 'Roughness (n)', numeric: true, kinds: ['conduit'] },
    { key: 'diameter', label: 'Diameter / height (geom1)', numeric: true, kinds: ['conduit'] },
    { key: 'in_offset', label: 'Inlet offset', numeric: true, kinds: ['conduit'] },
    { key: 'out_offset', label: 'Outlet offset', numeric: true, kinds: ['conduit'] },
    { key: 'length', label: 'Length', numeric: true, kinds: ['conduit'] },
    { key: 'barrels', label: 'Barrels', numeric: true, kinds: ['conduit'] },
  ],
  subcatchment: [
    { key: 'pct_imperv', label: '% impervious', numeric: true },
    { key: 'width', label: 'Width', numeric: true },
    { key: 'slope', label: '% slope', numeric: true },
    { key: 'n_imperv', label: 'N impervious', numeric: true },
    { key: 'n_perv', label: 'N pervious', numeric: true },
    { key: 'raingage', label: 'Rain gage', numeric: false },
  ],
}
const TYPE_LABEL = { node: 'nodes', link: 'links', subcatchment: 'subcatchments' }

export function MultiInspector({
  items,
  network,
  onClear,
  onDelete,
  readOnly = false,
}: {
  items: Item[]
  network: ModelNetwork | undefined
  onClear: () => void
  onDelete: (items: Item[]) => void
  readOnly?: boolean
}) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const props = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>()
    for (const f of network?.geojson.features ?? []) {
      const p = f.properties ?? {}
      m.set(`${p.object_type}:${p.id}`, p)
    }
    return m
  }, [network])
  const byType = useMemo(() => {
    const g: Record<string, Item[]> = {}
    for (const it of items) (g[it.object_type] ??= []).push(it)
    return g
  }, [items])
  const types = Object.keys(byType) as Item['object_type'][]
  const [type, setType] = useState<Item['object_type']>(types[0] ?? 'node')
  const activeType = byType[type] ? type : types[0]
  const targets = byType[activeType] ?? []
  const kinds = new Set(targets.map((t) => String(props.get(`${t.object_type}:${t.id}`)?.[t.object_type === 'node' ? 'node_kind' : 'link_kind'] ?? '')))
  const fields = (FIELDS[activeType] ?? []).filter((f) => !f.kinds || [...kinds].some((k) => f.kinds!.includes(k)))
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? '')
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0]
  const [mode, setMode] = useState<'set' | 'add' | 'mul'>('set')
  const [value, setValue] = useState('')

  const values = field
    ? targets.map((t) => props.get(`${t.object_type}:${t.id}`)?.[field.key]).filter((v) => typeof v === 'number') as number[]
    : []
  const range = values.length ? [Math.min(...values), Math.max(...values)] : null

  const apply = useMutation({
    mutationFn: () => {
      const v = field?.numeric ? Number(value) : value
      const eligible = targets.filter((t) => {
        if (!field?.kinds) return true
        const p = props.get(`${t.object_type}:${t.id}`)
        return field.kinds.includes(String(p?.[t.object_type === 'node' ? 'node_kind' : 'link_kind'] ?? ''))
      })
      const list = eligible.map((t) => {
        const cur = Number(props.get(`${t.object_type}:${t.id}`)?.[field!.key] ?? 0)
        const next = !field!.numeric || mode === 'set' ? v : mode === 'add' ? cur + (v as number) : cur * (v as number)
        const patch: Record<string, unknown> = { [field!.key]: next }
        if (field!.key === 'diameter') patch.geom1 = next
        return { object_type: t.object_type, id: t.id, patch }
      })
      return api.bulkPatch(list)
    },
    onSuccess: (r) => {
      refreshAfterEdit(qc)
      toast({
        title: `Changed ${r.changed.length} ${TYPE_LABEL[activeType]}`,
        description: r.errors.length ? `${r.errors.length} couldn’t be changed: ${r.errors[0].detail}` : undefined,
        tone: r.errors.length ? 'default' : 'success',
      })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t change them', description: e.message, tone: 'danger' }),
  })

  const ok = field && value.trim() !== '' && (!field.numeric || Number.isFinite(Number(value)))
  return (
    <Panel
      title={`${items.length} selected`}
      actions={
        <button type="button" onClick={onClear} className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg" aria-label="Clear selection">
          <X className="h-4 w-4" />
        </button>
      }
    >
      <p className="m-0 text-xs text-fg-soft">
        {types.map((t) => `${byType[t].length} ${TYPE_LABEL[t]}`).join(', ')}
      </p>
      <p className="mb-3 mt-1 text-[11px] text-muted">Shift- or Ctrl-click to add or remove; Shift-drag on the map to box-select.</p>

      {!readOnly && field && (
        <div className="space-y-2 rounded-lg border border-border p-2.5">
          <div className="text-xs font-medium text-fg">Change all at once</div>
          {types.length > 1 && (
            <select value={activeType} onChange={(e) => setType(e.target.value as Item['object_type'])} className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-xs">
              {types.map((t) => (
                <option key={t} value={t}>
                  The {byType[t].length} {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          )}
          <select value={field.key} onChange={(e) => setFieldKey(e.target.value)} className="h-8 w-full rounded-md border border-border-strong bg-surface px-2 text-xs">
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          {range && (
            <p className="m-0 text-[11px] text-muted">
              Now {range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`}
            </p>
          )}
          <div className="flex gap-1.5">
            {field.numeric && (
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 rounded-md border border-border-strong bg-surface px-1.5 text-xs" aria-label="How to change">
                <option value="set">Set to</option>
                <option value="add">Add</option>
                <option value="mul">Multiply by</option>
              </select>
            )}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode={field.numeric ? 'decimal' : 'text'}
              placeholder={mode === 'add' ? 'e.g. -0.5' : mode === 'mul' ? 'e.g. 1.1' : 'value'}
              className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && ok && apply.mutate()}
            />
          </div>
          <Button size="sm" variant="primary" className="w-full" disabled={!ok || apply.isPending} onClick={() => apply.mutate()}>
            Apply to {targets.length} {TYPE_LABEL[activeType]}
          </Button>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(items.map((i) => i.id).join('\n'))
            toast({ title: `Copied ${items.length} IDs`, tone: 'success' })
          }}
        >
          <Copy className="h-3.5 w-3.5" /> Copy IDs
        </Button>
        {!readOnly && (
          <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => onDelete(items)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete {items.length}
          </Button>
        )}
      </div>
    </Panel>
  )
}
