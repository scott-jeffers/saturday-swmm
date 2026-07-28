import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Circle, Hexagon, Pentagon, Spline, Triangle, Trash2 } from 'lucide-react'
import { api, type ModelObjectPatch } from '../../api/client'
import type { Selection } from '../map/NetworkMap'
import { Button, Panel } from '../ui'

interface ObjectInspectorProps {
  selection: Selection
  onSaved?: () => void
  onDeleteRequest?: (sel: NonNullable<Selection>) => void
}

type FieldDef = {
  key: string
  label: string
  readOnly?: boolean
  kind?: 'number' | 'text' | 'select'
  options?: Array<{ value: string; label: string }>
}

const LINK_KIND_OPTIONS = [
  { value: 'conduit', label: 'Conduit' },
  { value: 'pump', label: 'Pump' },
  { value: 'orifice', label: 'Orifice' },
  { value: 'weir', label: 'Weir' },
  { value: 'outlet', label: 'Outlet' },
]

const NODE_COMMON: FieldDef[] = [
  { key: 'id', label: 'Name', readOnly: true },
  { key: 'node_kind', label: 'Type', readOnly: true },
  { key: 'x', label: 'X', kind: 'number' },
  { key: 'y', label: 'Y', kind: 'number' },
]

const JUNCTION_FIELDS: FieldDef[] = [
  ...NODE_COMMON,
  { key: 'elevation', label: 'Invert elevation', kind: 'number' },
  { key: 'max_depth', label: 'Max depth', kind: 'number' },
  { key: 'init_depth', label: 'Initial depth', kind: 'number' },
  { key: 'sur_depth', label: 'Surcharge depth', kind: 'number' },
  { key: 'aponded', label: 'Ponded area', kind: 'number' },
]

const OUTFALL_FIELDS: FieldDef[] = [
  ...NODE_COMMON,
  { key: 'elevation', label: 'Invert elevation', kind: 'number' },
  { key: 'type', label: 'Outfall type' },
  { key: 'stage_data', label: 'Stage / curve / series' },
  { key: 'gated', label: 'Tide gate (YES/NO)' },
  { key: 'route_to', label: 'Route to' },
]

const STORAGE_FIELDS: FieldDef[] = [
  ...NODE_COMMON,
  { key: 'elevation', label: 'Invert elevation', kind: 'number' },
  { key: 'max_depth', label: 'Max depth', kind: 'number' },
  { key: 'init_depth', label: 'Initial depth', kind: 'number' },
  { key: 'shape', label: 'Shape (TABULAR/FUNCTIONAL)' },
  { key: 'curve', label: 'Curve name' },
  { key: 'coeff_a', label: 'Coeff A', kind: 'number' },
  { key: 'coeff_b', label: 'Coeff B', kind: 'number' },
  { key: 'coeff_c', label: 'Coeff C', kind: 'number' },
  { key: 'coeff_d', label: 'Coeff D', kind: 'number' },
  { key: 'fevap', label: 'Evap. factor', kind: 'number' },
]

const LINK_COMMON: FieldDef[] = [
  { key: 'id', label: 'Name', readOnly: true },
  {
    key: 'link_kind',
    label: 'Type',
    kind: 'select',
    options: LINK_KIND_OPTIONS,
  },
  { key: 'from_node', label: 'From node' },
  { key: 'to_node', label: 'To node' },
]

const CONDUIT_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'length', label: 'Length', kind: 'number' },
  { key: 'roughness', label: "Manning's N", kind: 'number' },
  { key: 'in_offset', label: 'Inlet offset', kind: 'number' },
  { key: 'out_offset', label: 'Outlet offset', kind: 'number' },
  { key: 'init_flow', label: 'Initial flow', kind: 'number' },
  { key: 'max_flow', label: 'Max flow', kind: 'number' },
  { key: 'shape', label: 'X-section shape' },
  { key: 'geom1', label: 'Geom1 (e.g. diameter)', kind: 'number' },
  { key: 'geom2', label: 'Geom2', kind: 'number' },
  { key: 'geom3', label: 'Geom3', kind: 'number' },
  { key: 'geom4', label: 'Geom4', kind: 'number' },
  { key: 'barrels', label: 'Barrels', kind: 'number' },
]

const PUMP_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'pump_curve', label: 'Pump curve' },
  { key: 'status', label: 'Status (ON/OFF)' },
  { key: 'startup', label: 'Startup depth', kind: 'number' },
  { key: 'shutoff', label: 'Shutoff depth', kind: 'number' },
]

const ORIFICE_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'orifice_type', label: 'Type (SIDE/BOTTOM)' },
  { key: 'offset', label: 'Offset', kind: 'number' },
  { key: 'qcoeff', label: 'Discharge coeff.', kind: 'number' },
  { key: 'gated', label: 'Gated (YES/NO)' },
  { key: 'close_time', label: 'Close time', kind: 'number' },
  { key: 'shape', label: 'X-section shape' },
  { key: 'geom1', label: 'Geom1', kind: 'number' },
]

const WEIR_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'weir_type', label: 'Type' },
  { key: 'crest_height', label: 'Crest height', kind: 'number' },
  { key: 'qcoeff', label: 'Discharge coeff.', kind: 'number' },
  { key: 'gated', label: 'Gated (YES/NO)' },
  { key: 'end_con', label: 'End contractions', kind: 'number' },
  { key: 'end_coeff', label: 'End coeff.', kind: 'number' },
  { key: 'shape', label: 'X-section shape' },
  { key: 'geom1', label: 'Geom1', kind: 'number' },
]

const OUTLET_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'offset', label: 'Offset', kind: 'number' },
  { key: 'outlet_type', label: 'Type' },
  { key: 'qcoeff_or_curve', label: 'Q coeff / curve' },
  { key: 'qexpon', label: 'Q exponent', kind: 'number' },
  { key: 'gated', label: 'Gated (YES/NO)' },
]

const SUBCATCH_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Name', readOnly: true },
  { key: 'raingage', label: 'Rain gage' },
  { key: 'outlet', label: 'Outlet' },
  { key: 'area', label: 'Area', kind: 'number' },
  { key: 'pct_imperv', label: '% Impervious', kind: 'number' },
  { key: 'width', label: 'Width', kind: 'number' },
  { key: 'slope', label: '% Slope', kind: 'number' },
  { key: 'curb_len', label: 'Curb length', kind: 'number' },
  { key: 'snow_pack', label: 'Snow pack' },
  { key: 'n_imperv', label: 'N-Imperv', kind: 'number' },
  { key: 'n_perv', label: 'N-Perv', kind: 'number' },
  { key: 's_imperv', label: 'Dstore-Imperv', kind: 'number' },
  { key: 's_perv', label: 'Dstore-Perv', kind: 'number' },
  { key: 'pct_zero', label: '% Zero-Imperv', kind: 'number' },
  { key: 'subarea_route_to', label: 'Subarea route to' },
  { key: 'pct_routed', label: '% Routed', kind: 'number' },
  { key: 'infil_p1', label: 'Infil param 1', kind: 'number' },
  { key: 'infil_p2', label: 'Infil param 2', kind: 'number' },
  { key: 'infil_p3', label: 'Infil param 3', kind: 'number' },
  { key: 'infil_p4', label: 'Infil param 4', kind: 'number' },
  { key: 'infil_p5', label: 'Infil param 5', kind: 'number' },
]

const NUMBER_KEYS = new Set([
  'x',
  'y',
  'elevation',
  'max_depth',
  'init_depth',
  'sur_depth',
  'aponded',
  'ponded_area',
  'coeff_a',
  'coeff_b',
  'coeff_c',
  'coeff_d',
  'fevap',
  'length',
  'roughness',
  'in_offset',
  'out_offset',
  'init_flow',
  'max_flow',
  'diameter',
  'geom1',
  'geom2',
  'geom3',
  'geom4',
  'barrels',
  'startup',
  'shutoff',
  'offset',
  'qcoeff',
  'close_time',
  'crest_height',
  'end_con',
  'end_coeff',
  'qexpon',
  'area',
  'pct_imperv',
  'width',
  'slope',
  'curb_len',
  'n_imperv',
  'n_perv',
  's_imperv',
  's_perv',
  'pct_zero',
  'pct_routed',
  'infil_p1',
  'infil_p2',
  'infil_p3',
  'infil_p4',
  'infil_p5',
])

const STRING_KEYS = new Set([
  'from_node',
  'to_node',
  'link_kind',
  'type',
  'outfall_type',
  'stage_data',
  'gated',
  'route_to',
  'shape',
  'curve',
  'outlet',
  'raingage',
  'snow_pack',
  'subarea_route_to',
  'pump_curve',
  'status',
  'orifice_type',
  'weir_type',
  'outlet_type',
  'qcoeff_or_curve',
])

function linkFieldsFor(kind: string): FieldDef[] {
  switch (kind) {
    case 'pump':
      return PUMP_FIELDS
    case 'orifice':
      return ORIFICE_FIELDS
    case 'weir':
      return WEIR_FIELDS
    case 'outlet':
      return OUTLET_FIELDS
    default:
      return CONDUIT_FIELDS
  }
}

function fieldsFor(selection: NonNullable<Selection>, attrs: Record<string, unknown>): FieldDef[] {
  if (selection.object_type === 'node') {
    const kind = String(attrs.node_kind ?? '')
    if (kind === 'outfall') return OUTFALL_FIELDS
    if (kind === 'storage') {
      const shape = String(attrs.shape ?? 'TABULAR').toUpperCase()
      return STORAGE_FIELDS.filter((f) => {
        if (['coeff_a', 'coeff_b', 'coeff_c', 'coeff_d'].includes(f.key)) {
          return shape === 'FUNCTIONAL'
        }
        if (f.key === 'curve') return shape !== 'FUNCTIONAL'
        return true
      })
    }
    return JUNCTION_FIELDS
  }
  if (selection.object_type === 'link') {
    return linkFieldsFor(String(attrs.link_kind ?? 'conduit'))
  }
  const base = SUBCATCH_FIELDS.filter((f) => {
    if (
      [
        'n_imperv',
        'n_perv',
        's_imperv',
        's_perv',
        'pct_zero',
        'subarea_route_to',
        'pct_routed',
      ].includes(f.key)
    ) {
      return attrs.n_imperv != null
    }
    if (f.key.startsWith('infil_')) {
      return attrs.infil_p1 != null
    }
    return true
  })
  return base
}

function buildPatch(
  selection: NonNullable<Selection>,
  form: Record<string, string>,
  fields: FieldDef[],
): ModelObjectPatch {
  const patch: ModelObjectPatch = {}
  for (const { key, readOnly } of fields) {
    if (readOnly) continue
    const raw = form[key]
    if (raw == null) continue
    if (NUMBER_KEYS.has(key)) {
      if (raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      ;(patch as Record<string, unknown>)[key] = n
    } else if (STRING_KEYS.has(key) || typeof raw === 'string') {
      ;(patch as Record<string, unknown>)[key] = raw
    }
  }
  // Prefer geom1 as diameter for conduits when both present
  if (selection.object_type === 'link' && patch.geom1 != null) {
    patch.diameter = patch.geom1
  }
  return patch
}

export function ObjectInspector({
  selection,
  onSaved,
  onDeleteRequest,
}: ObjectInspectorProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})

  const detail = useQuery({
    queryKey: ['object', selection?.object_type, selection?.id],
    queryFn: () => api.getObject(selection!.object_type, selection!.id),
    enabled: Boolean(selection),
  })

  useEffect(() => {
    if (!detail.data) return
    const a = detail.data.attributes
    const next: Record<string, string> = {}
    for (const [k, v] of Object.entries(a)) {
      if (v == null || typeof v === 'object') continue
      next[k] = String(v)
    }
    // Mirror diameter onto geom1 when only diameter is set
    if (next.diameter != null && (next.geom1 == null || next.geom1 === '')) {
      next.geom1 = next.diameter
    }
    setForm(next)
  }, [detail.data])

  const fields = useMemo(() => {
    if (!selection) return [] as FieldDef[]
    const attrs = {
      ...(detail.data?.attributes ?? {}),
      ...Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v]),
      ),
    }
    if (selection.object_type === 'link' && form.link_kind) {
      attrs.link_kind = form.link_kind
    }
    return fieldsFor(selection, attrs)
  }, [selection, detail.data, form])

  const save = useMutation({
    mutationFn: async () => {
      if (!selection) throw new Error('No selection')
      const patch = buildPatch(selection, form, fields)
      return api.patchObject(selection.object_type, selection.id, patch)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['network'] })
      void queryClient.invalidateQueries({
        queryKey: ['object', selection?.object_type, selection?.id],
      })
      onSaved?.()
    },
  })

  if (!selection) {
    return (
      <Panel title="Inspector">
        <p className="text-sm text-muted">
          Select a node, link, or subcatchment — or use the toolbar to draw new objects.
        </p>
      </Panel>
    )
  }

  const Icon =
    selection.object_type === 'subcatchment'
      ? Pentagon
      : selection.object_type === 'link'
        ? Spline
        : String(detail.data?.attributes?.node_kind ?? '') === 'outfall'
          ? Triangle
          : String(detail.data?.attributes?.node_kind ?? '') === 'storage'
            ? Hexagon
            : Circle

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent-soft" />
          {selection.object_type === 'node'
            ? String(detail.data?.attributes?.node_kind ?? 'node')
            : selection.object_type === 'link'
              ? String(form.link_kind ?? detail.data?.attributes?.link_kind ?? 'link')
              : selection.object_type}
        </span>
      }
      actions={
        onDeleteRequest ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:text-danger"
            onClick={() => onDeleteRequest(selection)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        ) : null
      }
    >
      <p className="mb-3 font-mono text-sm text-fg-soft">{selection.id}</p>
      {detail.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {detail.isError && (
        <p className="text-sm text-danger">{(detail.error as Error).message}</p>
      )}
      <div className="mb-3 max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto pr-1">
        {fields.map(({ key, label, readOnly, kind, options }) => (
          <label key={key} className="block text-xs">
            <span className="mb-1 block text-muted">{label}</span>
            {kind === 'select' && options ? (
              <select
                value={form[key] ?? ''}
                disabled={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-fg disabled:opacity-60 focus:border-accent focus:outline-none"
              >
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form[key] ?? ''}
                readOnly={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-fg read-only:opacity-60 focus:border-accent focus:outline-none"
              />
            )}
          </label>
        ))}
      </div>
      <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
        Apply changes
      </Button>
      {save.isError && (
        <p className="mt-2 text-sm text-danger">{(save.error as Error).message}</p>
      )}
      {save.isSuccess && <p className="mt-2 text-xs text-success">Saved to INP.</p>}
    </Panel>
  )
}
