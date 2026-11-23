import { IS_VIEWER } from '../../lib/mode'
import { ElementConnections, ElementNotes, ElementResults, ModelOverview } from './InspectorExtras'
import { ElementRules, NodeInflows, SubcatchmentLid } from './ElementInputs'
import { requestGraph } from '../../lib/graphRequest'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Circle, RotateCcw, Hexagon, Pentagon, Spline, Triangle, Trash2 } from 'lucide-react'
import { api, type ModelObjectPatch } from '../../api/client'
import type { Selection } from '../map/NetworkMap'
import { Button, Panel } from '../ui'
import { ErrorExplanation } from '../ui/Toast'
import { useInheritance } from '../../hooks/useInheritance'
import { useScenarioActions } from '../scenarios/ChangesPanel'
import { Tooltip } from '../ui'
import { explainError, type Explained } from '../../lib/explainError'

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
  /** Physical quantity, for the unit suffix: L length, Q flow, A area, Ar subcatchment area. */
  unit?: 'L' | 'Q' | 'A' | 'Ar' | 'V' | 'R'
}

const opts = (...v: string[]) => v.map((x) => ({ value: x, label: x }))
const YES_NO = opts('NO', 'YES')
const XSECTION_SHAPES = opts(
  'CIRCULAR', 'FORCE_MAIN', 'FILLED_CIRCULAR', 'RECT_CLOSED', 'RECT_OPEN', 'TRAPEZOIDAL', 'TRIANGULAR',
  'HORIZ_ELLIPSE', 'VERT_ELLIPSE', 'ARCH', 'PARABOLIC', 'POWER', 'RECT_TRIANGULAR', 'RECT_ROUND',
  'MODBASKETHANDLE', 'EGG', 'HORSESHOE', 'GOTHIC', 'CATENARY', 'SEMIELLIPTICAL', 'BASKETHANDLE',
  'SEMICIRCULAR', 'DUMMY', 'CUSTOM', 'IRREGULAR', 'STREET',
)
/** What Geom1-4 mean for each cross-section shape (EPA SWMM 5 manual). */
const GEOM_LABELS: Record<string, string[]> = {
  CIRCULAR: ['Diameter'],
  FORCE_MAIN: ['Diameter', 'Roughness (C or ε)'],
  FILLED_CIRCULAR: ['Diameter', 'Sediment depth'],
  RECT_CLOSED: ['Height', 'Width', 'Corner slots (0-2)'],
  RECT_OPEN: ['Height', 'Width', 'Side walls removed (0-2)'],
  TRAPEZOIDAL: ['Height', 'Bottom width', 'Left slope (H:V)', 'Right slope (H:V)'],
  TRIANGULAR: ['Height', 'Top width'],
  HORIZ_ELLIPSE: ['Height', 'Width', 'Size code'],
  VERT_ELLIPSE: ['Height', 'Width', 'Size code'],
  ARCH: ['Height', 'Width', 'Size code'],
  PARABOLIC: ['Height', 'Top width'],
  POWER: ['Height', 'Top width', 'Exponent'],
  RECT_TRIANGULAR: ['Height', 'Top width', 'Triangle height'],
  RECT_ROUND: ['Height', 'Top width', 'Bottom radius'],
  MODBASKETHANDLE: ['Height', 'Base width', 'Top radius'],
  CUSTOM: ['Height', 'Shape curve name'],
  IRREGULAR: ['Transect name'],
  STREET: ['Street name'],
}
const INFIL_LABELS: Record<string, [string, FieldDef['unit']][]> = {
  HORTON: [['Max infiltration rate', 'R'], ['Min infiltration rate', 'R'], ['Decay constant (1/hr)', undefined], ['Drying time (days)', undefined], ['Max infiltration volume', 'L']],
  GREEN_AMPT: [['Suction head', 'L'], ['Saturated conductivity', 'R'], ['Initial deficit (fraction)', undefined]],
  CURVE_NUMBER: [['Curve number', undefined], ['(not used)', undefined], ['Drying time (days)', undefined]],
}
INFIL_LABELS.MODIFIED_HORTON = INFIL_LABELS.HORTON
INFIL_LABELS.MODIFIED_GREEN_AMPT = INFIL_LABELS.GREEN_AMPT

const US = new Set(['CFS', 'GPM', 'MGD'])
function unitText(u: FieldDef['unit'], flowUnits?: string | null): string {
  if (!u || !flowUnits) return ''
  const us = US.has(flowUnits.toUpperCase())
  switch (u) {
    case 'L': return us ? 'ft' : 'm'
    case 'Q': return flowUnits.toLowerCase()
    case 'A': return us ? 'ft²' : 'm²'
    case 'Ar': return us ? 'ac' : 'ha'
    case 'V': return us ? 'ft/s' : 'm/s'
    case 'R': return us ? 'in/hr' : 'mm/hr'
  }
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
  { key: 'elevation', label: 'Invert elevation', kind: 'number', unit: 'L' },
  { key: 'max_depth', label: 'Max depth', kind: 'number', unit: 'L' },
  { key: 'init_depth', label: 'Initial depth', kind: 'number', unit: 'L' },
  { key: 'sur_depth', label: 'Surcharge depth', kind: 'number', unit: 'L' },
  { key: 'aponded', label: 'Ponded area', kind: 'number', unit: 'A' },
]

const OUTFALL_FIELDS: FieldDef[] = [
  ...NODE_COMMON,
  { key: 'elevation', label: 'Invert elevation', kind: 'number', unit: 'L' },
  { key: 'type', label: 'Outfall type', kind: 'select', options: opts('FREE', 'NORMAL', 'FIXED', 'TIDAL', 'TIMESERIES') },
  { key: 'stage_data', label: 'Stage / curve / series' },
  { key: 'gated', label: 'Flap gate', kind: 'select', options: YES_NO },
  { key: 'route_to', label: 'Route to' },
]

const STORAGE_FIELDS: FieldDef[] = [
  ...NODE_COMMON,
  { key: 'elevation', label: 'Invert elevation', kind: 'number', unit: 'L' },
  { key: 'max_depth', label: 'Max depth', kind: 'number', unit: 'L' },
  { key: 'init_depth', label: 'Initial depth', kind: 'number', unit: 'L' },
  { key: 'shape', label: 'Storage curve', kind: 'select', options: opts('FUNCTIONAL', 'TABULAR', 'CYLINDRICAL', 'CONICAL', 'PARABOLIC', 'PYRAMIDAL') },
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
  { key: 'length', label: 'Length', kind: 'number', unit: 'L' },
  { key: 'roughness', label: "Manning's N", kind: 'number' },
  { key: 'in_offset', label: 'Inlet offset', kind: 'number', unit: 'L' },
  { key: 'out_offset', label: 'Outlet offset', kind: 'number', unit: 'L' },
  { key: 'init_flow', label: 'Initial flow', kind: 'number', unit: 'Q' },
  { key: 'max_flow', label: 'Max flow', kind: 'number', unit: 'Q' },
  { key: 'shape', label: 'Cross-section shape', kind: 'select', options: XSECTION_SHAPES },
  { key: 'geom1', label: 'Geom1', kind: 'number', unit: 'L' },
  { key: 'geom2', label: 'Geom2', kind: 'number' },
  { key: 'geom3', label: 'Geom3', kind: 'number' },
  { key: 'geom4', label: 'Geom4', kind: 'number' },
  { key: 'barrels', label: 'Barrels', kind: 'number' },
]

const PUMP_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'pump_curve', label: 'Pump curve' },
  { key: 'status', label: 'Initial status', kind: 'select', options: opts('ON', 'OFF') },
  { key: 'startup', label: 'Startup depth', kind: 'number', unit: 'L' },
  { key: 'shutoff', label: 'Shutoff depth', kind: 'number', unit: 'L' },
]

const ORIFICE_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'orifice_type', label: 'Orifice type', kind: 'select', options: opts('SIDE', 'BOTTOM') },
  { key: 'offset', label: 'Offset', kind: 'number', unit: 'L' },
  { key: 'qcoeff', label: 'Discharge coeff.', kind: 'number' },
  { key: 'gated', label: 'Flap gate', kind: 'select', options: YES_NO },
  { key: 'close_time', label: 'Close time', kind: 'number' },
  { key: 'shape', label: 'X-section shape' },
  { key: 'geom1', label: 'Geom1', kind: 'number' },
]

const WEIR_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'weir_type', label: 'Weir type', kind: 'select', options: opts('TRANSVERSE', 'SIDEFLOW', 'V-NOTCH', 'TRAPEZOIDAL', 'ROADWAY') },
  { key: 'crest_height', label: 'Crest height', kind: 'number', unit: 'L' },
  { key: 'qcoeff', label: 'Discharge coeff.', kind: 'number' },
  { key: 'gated', label: 'Flap gate', kind: 'select', options: YES_NO },
  { key: 'end_con', label: 'End contractions', kind: 'number' },
  { key: 'end_coeff', label: 'End coeff.', kind: 'number' },
  { key: 'shape', label: 'X-section shape' },
  { key: 'geom1', label: 'Geom1', kind: 'number' },
]

const OUTLET_FIELDS: FieldDef[] = [
  ...LINK_COMMON,
  { key: 'offset', label: 'Offset', kind: 'number', unit: 'L' },
  { key: 'outlet_type', label: 'Rating curve', kind: 'select', options: opts('FUNCTIONAL/DEPTH', 'FUNCTIONAL/HEAD', 'TABULAR/DEPTH', 'TABULAR/HEAD') },
  { key: 'qcoeff_or_curve', label: 'Q coeff / curve' },
  { key: 'qexpon', label: 'Q exponent', kind: 'number' },
  { key: 'gated', label: 'Flap gate', kind: 'select', options: YES_NO },
]

const SUBCATCH_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Name', readOnly: true },
  { key: 'raingage', label: 'Rain gage' },
  { key: 'outlet', label: 'Outlet' },
  { key: 'area', label: 'Area', kind: 'number', unit: 'Ar' },
  { key: 'pct_imperv', label: '% Impervious', kind: 'number' },
  { key: 'width', label: 'Width', kind: 'number', unit: 'L' },
  { key: 'slope', label: '% Slope', kind: 'number' },
  { key: 'curb_len', label: 'Curb length', kind: 'number', unit: 'L' },
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

/** The fields that differ from what's saved, as a patch, and any that can't be saved as typed. */
function buildPatch(
  selection: NonNullable<Selection>,
  form: Record<string, string>,
  fields: FieldDef[],
  saved: Record<string, string>,
): { patch: ModelObjectPatch; errors: Record<string, string> } {
  const patch: ModelObjectPatch = {}
  const errors: Record<string, string> = {}
  for (const { key, readOnly, label } of fields) {
    if (readOnly) continue
    const raw = form[key]
    if (raw == null || raw === (saved[key] ?? '')) continue
    if (NUMBER_KEYS.has(key)) {
      const t = raw.trim().replace(',', '.')
      if (t === '') {
        errors[key] = `${label} can’t be empty. Enter a number, or press Esc to put back ${saved[key] || 'the saved value'}.`
        continue
      }
      const n = Number(t)
      if (!Number.isFinite(n)) {
        errors[key] = `“${raw}” isn’t a number. Enter ${label.toLowerCase()} as a number, like 1.5.`
        continue
      }
      ;(patch as Record<string, unknown>)[key] = n
    } else if (STRING_KEYS.has(key) || typeof raw === 'string') {
      ;(patch as Record<string, unknown>)[key] = raw.trim()
    }
  }
  // Prefer geom1 as diameter for conduits when both present
  if (selection.object_type === 'link' && patch.geom1 != null) {
    patch.diameter = patch.geom1
  }
  return { patch, errors }
}

export function ObjectInspector({
  selection,
  onSaved,
  onDeleteRequest,
}: ObjectInspectorProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Record<string, string>>({})
  /** What the model holds now; the form saves whatever differs from it. */
  const [saved, setSaved] = useState<Record<string, string>>({})
  const savedRef = useRef(saved)
  savedRef.current = saved
  const loadedId = useRef<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, { message: string; fix?: string }>>({})
  const [generalError, setGeneralError] = useState<Explained | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [tab, setTab] = useState<'properties' | 'inflows' | 'lid' | 'results' | 'connections' | 'notes'>('properties')
  // A tab that this element type doesn't have falls back to Properties.
  useEffect(() => {
    if ((tab === 'inflows' && selection?.object_type !== 'node') || (tab === 'lid' && selection?.object_type !== 'subcatchment')) setTab('properties')
  }, [selection?.object_type, tab])

  const projectInfo = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  // In a child scenario: which values are this scenario's own, and which come from its parent.
  const inh = useInheritance(projectInfo.data?.scenario_id)
  const scenarioActions = useScenarioActions(inh?.sid ?? 'base')
  const objKey = selection ? `${selection.object_type}:${selection.id}` : ''
  const ownCount = inh ? (inh.byObject.get(objKey) ?? []).filter((c) => c.change === 'modified').length : 0
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
    const key = `${selection?.object_type}:${detail.data.id}`
    if (loadedId.current !== key) {
      loadedId.current = key
      setForm(next)
      setFieldErrors({})
      setGeneralError(null)
      setSavedAt(null)
    } else {
      // Same element reloaded after a save: keep anything still being typed.
      const before = savedRef.current
      setForm((prev) => {
        const merged = { ...next }
        for (const [k, v] of Object.entries(prev)) if (v !== (before[k] ?? '')) merged[k] = v
        return merged
      })
    }
    setSaved(next)
  }, [detail.data, selection?.object_type])

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
    const shape = String(attrs.shape ?? form.shape ?? '').toUpperCase()
    const infil = INFIL_LABELS[String(projectInfo.data?.infiltration ?? '').toUpperCase()]
    return fieldsFor(selection, attrs).flatMap((f): FieldDef[] => {
      const g = /^geom([1-4])$/.exec(f.key)
      if (g && selection.object_type === 'link' && GEOM_LABELS[shape]) {
        const name = GEOM_LABELS[shape][Number(g[1]) - 1]
        if (!name) return []
        const textual = /name/i.test(name)
        return [{ ...f, label: name, kind: textual ? 'text' : f.kind, unit: /slope|code|slots|removed|exponent|roughness/i.test(name) || textual ? undefined : 'L' }]
      }
      const ip = /^infil_p([1-5])$/.exec(f.key)
      if (ip && infil) {
        const d = infil[Number(ip[1]) - 1]
        return d ? [{ ...f, label: d[0], unit: d[1] }] : []
      }
      return [f]
    })
  }, [selection, detail.data, form, projectInfo.data?.infiltration])

  const save = useMutation({
    mutationFn: async (patch: ModelObjectPatch) => {
      if (!selection) throw new Error('No selection')
      return api.patchObject(selection.object_type, selection.id, patch)
    },
    onSuccess: (_r, patch) => {
      const keys = Object.keys(patch)
      setSaved((prev) => {
        const n = { ...prev }
        for (const k of keys) n[k] = String((patch as Record<string, unknown>)[k])
        return n
      })
      setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !keys.includes(k))))
      setGeneralError(null)
      setSavedAt(Date.now())
      void queryClient.invalidateQueries({ queryKey: ['network'] })
      void queryClient.invalidateQueries({
        queryKey: ['object', selection?.object_type, selection?.id],
      })
      onSaved?.()
    },
    onError: (err, patch) => {
      const e = explainError(err)
      const keys = Object.keys(patch)
      const field = e.field && keys.includes(e.field) ? e.field : keys.length === 1 ? keys[0] : null
      if (field) setFieldErrors((prev) => ({ ...prev, [field]: { message: e.message, fix: e.fix } }))
      else setGeneralError(e)
    },
  })

  /** Save what changed (on leaving a field, Enter, or picking from a list). */
  const commit = (override?: Record<string, string>) => {
    if (!selection) return
    const f = override ? { ...form, ...override } : form
    const { patch, errors } = buildPatch(selection, f, fields, saved)
    setFieldErrors((prev) => {
      const n = { ...prev }
      for (const k of Object.keys(override ?? f)) if (!errors[k] && f[k] === (saved[k] ?? '')) delete n[k]
      for (const [k, m] of Object.entries(errors)) n[k] = { message: m }
      return n
    })
    if (Object.keys(patch).length) save.mutate(patch)
  }
  const fieldRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({})

  if (!selection) return <ModelOverview />

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
      <p className="mb-2 text-[15px] font-semibold text-fg">{selection.id}</p>
      {inh && (
        <p className="-mt-1 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
          {inh.added.has(objKey) ? (
            <span className="rounded bg-success/15 px-1.5 py-0.5 font-medium text-success">Added in this scenario</span>
          ) : ownCount ? (
            <>
              <span className="border-l-2 border-accent pl-1.5">
                {ownCount} value{ownCount === 1 ? '' : 's'} changed here (marked); the rest come from {inh.parentName}
              </span>
              <button
                type="button"
                className="font-medium text-accent-soft hover:underline"
                onClick={() =>
                  scenarioActions.reset.mutate((inh.byObject.get(objKey) ?? []).filter((c) => c.change === 'modified').map((c) => ({ section: c.section, id: c.id, field: c.field })))
                }
              >
                Reset all to {inh.parentName}
              </button>
            </>
          ) : (
            <span>All values come from {inh.parentName}</span>
          )}
          {inh.locked && <span className="rounded bg-fg/[0.06] px-1.5 py-0.5">Locked</span>}
        </p>
      )}
      <ElementRules kind={selection.object_type} id={selection.id} />
      <div className="mb-3 flex gap-1 border-b border-border" role="tablist">
        {([
          'properties',
          ...(selection.object_type === 'node' ? (['inflows'] as const) : []),
          ...(selection.object_type === 'subcatchment' ? (['lid'] as const) : []),
          'results',
          'connections',
          ...(IS_VIEWER ? [] : (['notes'] as const)),
        ] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px h-8 border-b-2 px-2 text-[12px] capitalize ${tab === t ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t === 'lid' ? 'LID' : t}
          </button>
        ))}
      </div>
      {tab === 'inflows' && selection.object_type === 'node' && (
        <NodeInflows id={selection.id} flowUnits={projectInfo.data?.flow_units} onShowInGraphs={(k) => requestGraph(k)} />
      )}
      {tab === 'lid' && selection.object_type === 'subcatchment' && (
        <SubcatchmentLid id={selection.id} areaUnitUs={['CFS', 'GPM', 'MGD'].includes(String(projectInfo.data?.flow_units ?? 'CFS').toUpperCase())} />
      )}
      {tab === 'results' && <ElementResults selection={selection} />}
      {tab === 'connections' && <ElementConnections selection={selection} />}
      {tab === 'notes' && <ElementNotes selection={selection} />}
      {tab === 'properties' && (
      <>
      {detail.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {detail.isError && (
        <p className="text-sm text-danger">{(detail.error as Error).message}</p>
      )}
      {/* Never show the last element's values under this element's name while it loads. */}
      <div className="mb-3 max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto pr-1" hidden={detail.data?.id !== selection?.id}>
        {fields.map(({ key, label, readOnly, kind, options, unit }) => (
          <label
            key={key}
            className={`block text-xs ${inh?.byField.has(`${objKey}:${key}`) ? 'border-l-2 border-accent pl-2' : ''}`}
            data-field={key}
          >
            <span className="mb-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] text-fg-soft">
              <span className="min-w-0 flex-1">
                {label}
                {unitText(unit, projectInfo.data?.flow_units) && (
                  <span className="ml-1 text-[10px] text-muted/80">({unitText(unit, projectInfo.data?.flow_units)})</span>
                )}
              </span>
              {(() => {
                const ch = inh?.byField.get(`${objKey}:${key}`)
                const fl = inh?.flagsByField.get(`${objKey}:${key}`)
                if (!ch && !fl) return null
                const item = { section: (ch ?? fl)!.section, id: selection.id, field: (ch ?? fl)!.field }
                return (
                  <span className="flex w-full min-w-0 flex-wrap items-center gap-1 text-[10.5px]">
                    {fl && (
                      <Tooltip content={`${inh!.parentName} changed this to ${fl.parent_new ?? '—'} (was ${fl.parent_old ?? '—'}); this scenario keeps ${fl.mine ?? '—'}`}>
                        <button
                          type="button"
                          className="rounded bg-warning/20 px-1 font-medium text-warning hover:bg-warning/30"
                          onClick={(e) => {
                            e.preventDefault()
                            scenarioActions.reset.mutate([item])
                          }}
                        >
                          {inh!.parentName} changed · take it
                        </button>
                      </Tooltip>
                    )}
                    {ch && (
                      <Tooltip content={`Changed in this scenario. ${inh!.parentName}: ${Array.isArray(ch.parent) ? 'several lines' : (ch.parent ?? '—')}. Click to use ${inh!.parentName}’s value again.`}>
                        <button
                          type="button"
                          aria-label={`Reset ${label} to ${inh!.parentName}`}
                          className="inline-flex min-w-0 max-w-full items-center gap-0.5 truncate rounded px-1 text-accent-soft hover:bg-accent/10"
                          onClick={(e) => {
                            e.preventDefault()
                            scenarioActions.reset.mutate([item])
                          }}
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden /> {inh!.parentName}: {Array.isArray(ch.parent) ? '…' : (ch.parent ?? '—')}
                        </button>
                      </Tooltip>
                    )}
                  </span>
                )
              })()}
            </span>
            {kind === 'select' && options ? (
              <select
                ref={(el) => {
                  fieldRefs.current[key] = el
                }}
                value={form[key] ?? ''}
                disabled={readOnly}
                aria-invalid={Boolean(fieldErrors[key])}
                onChange={(e) => {
                  const v = e.target.value
                  setForm((f) => ({ ...f, [key]: v }))
                  commit({ [key]: v })
                }}
                className={`field disabled:opacity-60 ${fieldErrors[key] ? 'border-danger ring-1 ring-danger/40' : ''}`}
              >
                {form[key] && !options.some((o) => o.value === String(form[key]).toUpperCase() || o.value === form[key]) && (
                  <option value={form[key]}>{form[key]}</option>
                )}
                {!form[key] && <option value="">—</option>}
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                ref={(el) => {
                  fieldRefs.current[key] = el
                }}
                value={form[key] ?? ''}
                readOnly={readOnly}
                aria-invalid={Boolean(fieldErrors[key])}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                onBlur={() => commit()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') {
                    setForm((f) => ({ ...f, [key]: saved[key] ?? '' }))
                    setFieldErrors(({ [key]: _gone, ...rest }) => rest)
                  }
                }}
                className={`field read-only:opacity-60 ${fieldErrors[key] ? 'border-danger ring-1 ring-danger/40' : ''}`}
              />
            )}
            {fieldErrors[key] && (
              <span role="alert" className="mt-1 block rounded-md bg-danger/[0.08] px-2 py-1.5 text-[11.5px] leading-snug text-danger">
                {fieldErrors[key].message}
                {fieldErrors[key].fix && <span className="mt-0.5 block text-fg-soft">{fieldErrors[key].fix}</span>}
              </span>
            )}
          </label>
        ))}
      </div>
      {(() => {
        const errs = Object.entries(fieldErrors)
        return errs.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              const [k] = errs[0]
              const el = fieldRefs.current[k]
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              el?.focus()
            }}
            className="flex w-full items-start gap-2 rounded-lg border border-danger/40 bg-danger/[0.06] px-3 py-2 text-left text-[12px] text-danger hover:bg-danger/10"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {errs.length === 1 ? `${fields.find((f) => f.key === errs[0][0])?.label ?? errs[0][0]} wasn’t saved.` : `${errs.length} fields weren’t saved.`}{' '}
              <span className="font-medium underline-offset-2 hover:underline">Show me</span>
            </span>
          </button>
        ) : generalError ? (
          <div className="rounded-lg border border-danger/40 bg-danger/[0.06] px-3 py-2">
            <ErrorExplanation e={generalError} />
          </div>
        ) : (
          <p className="m-0 flex items-center gap-1.5 text-[11.5px] text-muted" aria-live="polite">
            {save.isPending ? (
              'Saving…'
            ) : savedAt ? (
              <>
                <Check className="h-3.5 w-3.5 text-success" aria-hidden /> {IS_VIEWER ? 'Saved to the model in this browser' : 'Saved'}. Undo with Ctrl+Z.
              </>
            ) : (
              'Changes save as you make them. Esc puts a field back.'
            )}
          </p>
        )
      })()}
      </>
      )}
    </Panel>
  )
}
