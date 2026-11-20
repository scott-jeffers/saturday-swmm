import { IS_VIEWER } from '../lib/mode'
import { ELEMENT_COLOR } from '../lib/elementColors'
import { networkCounts } from '../lib/units'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Circle, Hexagon, Pentagon, Search, Spline, Triangle } from 'lucide-react'
import { api, type ModelObjectPatch } from '../api/client'
import { featuresByType, upsertNetworkObject } from '../lib/networkCache'
import { Button, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '../components/ui'
import type { ModelNetwork } from '../api/client'
import type { Feature } from 'geojson'
import { cn } from '../lib/cn'

type TabKind =
  | 'junctions'
  | 'outfalls'
  | 'storage'
  | 'conduits'
  | 'pumps'
  | 'orifices'
  | 'weirs'
  | 'outlets'
  | 'subcatchments'

const JUNCTION_COLS = ['id', 'x', 'y', 'elevation', 'max_depth', 'init_depth', 'sur_depth', 'aponded'] as const
const OUTFALL_COLS = ['id', 'x', 'y', 'elevation', 'type', 'stage_data', 'gated', 'route_to'] as const
const STORAGE_COLS = [
  'id',
  'x',
  'y',
  'elevation',
  'max_depth',
  'init_depth',
  'shape',
  'curve',
  'fevap',
] as const
const CONDUIT_COLS = [
  'id',
  'link_kind',
  'from_node',
  'to_node',
  'length',
  'roughness',
  'in_offset',
  'out_offset',
  'diameter',
  'shape',
] as const
const PUMP_COLS = [
  'id',
  'link_kind',
  'from_node',
  'to_node',
  'pump_curve',
  'status',
  'startup',
  'shutoff',
] as const
const ORIFICE_COLS = [
  'id',
  'link_kind',
  'from_node',
  'to_node',
  'orifice_type',
  'offset',
  'qcoeff',
  'gated',
  'diameter',
] as const
const WEIR_COLS = [
  'id',
  'link_kind',
  'from_node',
  'to_node',
  'weir_type',
  'crest_height',
  'qcoeff',
  'gated',
  'diameter',
] as const
const OUTLET_COLS = [
  'id',
  'link_kind',
  'from_node',
  'to_node',
  'offset',
  'outlet_type',
  'qcoeff_or_curve',
  'qexpon',
  'gated',
] as const
const SUB_COLS = [
  'id',
  'raingage',
  'outlet',
  'area',
  'pct_imperv',
  'width',
  'slope',
  'curb_len',
] as const

const COLS: Record<TabKind, readonly string[]> = {
  junctions: JUNCTION_COLS,
  outfalls: OUTFALL_COLS,
  storage: STORAGE_COLS,
  conduits: CONDUIT_COLS,
  pumps: PUMP_COLS,
  orifices: ORIFICE_COLS,
  weirs: WEIR_COLS,
  outlets: OUTLET_COLS,
  subcatchments: SUB_COLS,
}

const COL_LABELS: Record<string, string> = {
  id: 'ID',
  x: 'X',
  y: 'Y',
  elevation: 'Invert elev.',
  max_depth: 'Max depth',
  init_depth: 'Initial depth',
  sur_depth: 'Surcharge depth',
  aponded: 'Ponded area',
  stage_data: 'Stage data',
  route_to: 'Route to',
  fevap: 'Evap. factor',
  link_kind: 'Type',
  from_node: 'From',
  to_node: 'To',
  in_offset: 'Inlet offset',
  out_offset: 'Outlet offset',
  diameter: 'Height / dia.',
  pump_curve: 'Pump curve',
  orifice_type: 'Orifice type',
  qcoeff: 'Discharge coeff.',
  weir_type: 'Weir type',
  crest_height: 'Crest height',
  outlet_type: 'Rating type',
  qcoeff_or_curve: 'Coeff. / curve',
  qexpon: 'Exponent',
  raingage: 'Rain gage',
  pct_imperv: '% impervious',
  curb_len: 'Curb length',
}
const colLabel = (c: string) => COL_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ')

const LINK_KIND_TABS = new Set<TabKind>(['conduits', 'pumps', 'orifices', 'weirs', 'outlets'])

const EDITABLE: Record<TabKind, Set<string>> = {
  junctions: new Set(['x', 'y', 'elevation', 'max_depth', 'init_depth', 'sur_depth', 'aponded']),
  outfalls: new Set(['x', 'y', 'elevation', 'type', 'stage_data', 'gated', 'route_to']),
  storage: new Set([
    'x',
    'y',
    'elevation',
    'max_depth',
    'init_depth',
    'shape',
    'curve',
    'fevap',
  ]),
  conduits: new Set([
    'link_kind',
    'from_node',
    'to_node',
    'length',
    'roughness',
    'in_offset',
    'out_offset',
    'diameter',
  ]),
  pumps: new Set([
    'link_kind',
    'from_node',
    'to_node',
    'pump_curve',
    'status',
    'startup',
    'shutoff',
  ]),
  orifices: new Set([
    'link_kind',
    'from_node',
    'to_node',
    'orifice_type',
    'offset',
    'qcoeff',
    'gated',
    'diameter',
  ]),
  weirs: new Set([
    'link_kind',
    'from_node',
    'to_node',
    'weir_type',
    'crest_height',
    'qcoeff',
    'gated',
    'diameter',
  ]),
  outlets: new Set([
    'link_kind',
    'from_node',
    'to_node',
    'offset',
    'outlet_type',
    'qcoeff_or_curve',
    'qexpon',
    'gated',
  ]),
  subcatchments: new Set([
    'raingage',
    'outlet',
    'area',
    'pct_imperv',
    'width',
    'slope',
    'curb_len',
  ]),
}

const NUMBER_FIELDS = new Set([
  'x',
  'y',
  'elevation',
  'max_depth',
  'init_depth',
  'sur_depth',
  'aponded',
  'fevap',
  'length',
  'roughness',
  'in_offset',
  'out_offset',
  'diameter',
  'startup',
  'shutoff',
  'offset',
  'qcoeff',
  'crest_height',
  'qexpon',
  'area',
  'pct_imperv',
  'width',
  'slope',
  'curb_len',
])

type UnitKind = 'len' | 'area' | 'subarea' | 'pct' | 'flow'
const COL_UNIT: Record<string, UnitKind> = {
  elevation: 'len', max_depth: 'len', init_depth: 'len', sur_depth: 'len', length: 'len', in_offset: 'len',
  out_offset: 'len', diameter: 'len', startup: 'len', shutoff: 'len', offset: 'len', crest_height: 'len',
  width: 'len', curb_len: 'len', aponded: 'area', area: 'subarea', pct_imperv: 'pct', slope: 'pct',
}
function unitLabel(kind: UnitKind | undefined, us: boolean) {
  if (!kind) return ''
  return { len: us ? 'ft' : 'm', area: us ? 'ft²' : 'm²', subarea: us ? 'ac' : 'ha', pct: '%', flow: us ? 'cfs' : 'm³/s' }[kind]
}

/** Values that SWMM will reject or that are almost certainly wrong. */
function cellProblem(col: string, raw: string, nodeIds: Set<string>): string | null {
  const v = raw.trim()
  if ((col === 'from_node' || col === 'to_node' || col === 'outlet') && v && col !== 'outlet' && !nodeIds.has(v))
    return `No node called ${v}`
  if (!NUMBER_FIELDS.has(col) || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return 'Not a number'
  if (['length', 'roughness', 'area', 'width'].includes(col) && n <= 0) return 'Must be greater than zero'
  if (['max_depth', 'init_depth', 'sur_depth', 'aponded', 'diameter', 'pct_imperv', 'slope', 'curb_len'].includes(col) && n < 0)
    return 'Cannot be negative'
  if (col === 'pct_imperv' && n > 100) return 'Cannot exceed 100 %'
  if (col === 'roughness' && n > 0.1) return "Unusually high Manning's n (> 0.1)"
  return null
}

const LINK_KIND_SELECT = ['conduit', 'pump', 'orifice', 'weir', 'outlet'] as const

function rowValues(
  props: Record<string, unknown> | null | undefined,
  cols: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of cols) {
    const v = props?.[c]
    out[c] = v == null ? '' : String(v)
  }
  return out
}

function filterNodes(features: Feature[], kind: string) {
  return features.filter((f) => String(f.properties?.node_kind ?? '') === kind)
}

function filterLinks(features: Feature[], kind: string) {
  return features.filter((f) => String(f.properties?.link_kind ?? '') === kind)
}

export function TablePage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [tab, setTab] = useState<TabKind>('junctions')
  const [filter, setFilter] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())

  const network = useQuery({
    queryKey: ['network'],
    queryFn: () => api.getNetwork(),
  })

  const grouped = useMemo(() => {
    if (!network.data) {
      return {
        junctions: [],
        outfalls: [],
        storage: [],
        conduits: [],
        pumps: [],
        orifices: [],
        weirs: [],
        outlets: [],
        subs: [],
      }
    }
    const { nodes, links, subs } = featuresByType(network.data.geojson)
    return {
      junctions: filterNodes(nodes, 'junction'),
      outfalls: filterNodes(nodes, 'outfall'),
      storage: filterNodes(nodes, 'storage'),
      conduits: filterLinks(links, 'conduit'),
      pumps: filterLinks(links, 'pump'),
      orifices: filterLinks(links, 'orifice'),
      weirs: filterLinks(links, 'weir'),
      outlets: filterLinks(links, 'outlet'),
      subs,
    }
  }, [network.data])

  const cols = COLS[tab]
  const rows =
    tab === 'junctions'
      ? grouped.junctions
      : tab === 'outfalls'
        ? grouped.outfalls
        : tab === 'storage'
          ? grouped.storage
          : tab === 'conduits'
            ? grouped.conduits
            : tab === 'pumps'
              ? grouped.pumps
              : tab === 'orifices'
                ? grouped.orifices
                : tab === 'weirs'
                  ? grouped.weirs
                  : tab === 'outlets'
                    ? grouped.outlets
                    : grouped.subs

  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null)
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject, retry: false })
  const us = !['CMS', 'LPS', 'MLD'].includes(String(project.data?.flow_units ?? 'CFS').toUpperCase())
  const nodeIds = useMemo(
    () => new Set([...grouped.junctions, ...grouped.outfalls, ...grouped.storage].map((f) => String(f.properties?.id ?? ''))),
    [grouped],
  )
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const out = q ? rows.filter((f) => String(f.properties?.id ?? '').toLowerCase().includes(q)) : [...rows]
    if (sort) {
      const num = NUMBER_FIELDS.has(sort.col)
      out.sort((a, b) => {
        const av = a.properties?.[sort.col]
        const bv = b.properties?.[sort.col]
        if (num) return ((Number(av) || 0) - (Number(bv) || 0)) * sort.dir
        return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * sort.dir
      })
    }
    return out
  }, [rows, filter, sort])
  const problemCount = useMemo(() => {
    let n = 0
    for (const f of rows) for (const c of cols) if (cellProblem(c, String(f.properties?.[c] ?? ''), nodeIds)) n++
    return n
  }, [rows, cols, nodeIds])

  const getRow = (id: string, props: Record<string, unknown> | null | undefined) =>
    drafts[id] ?? rowValues(props, cols)

  const setCell = (
    id: string,
    props: Record<string, unknown> | null | undefined,
    key: string,
    value: string,
  ) => {
    setDrafts((prev) => {
      const base = prev[id] ?? rowValues(props, cols)
      return { ...prev, [id]: { ...base, [key]: value } }
    })
    setDirtyIds((prev) => new Set(prev).add(id))
  }

  const save = useMutation({
    mutationFn: async (id: string) => {
      const draft = drafts[id]
      if (!draft) throw new Error('Nothing to save')
      const objectType = LINK_KIND_TABS.has(tab)
        ? 'link'
        : tab === 'subcatchments'
          ? 'subcatchment'
          : 'node'
      const patch: ModelObjectPatch = {}
      for (const key of EDITABLE[tab]) {
        const raw = draft[key]
        if (raw == null) continue
        if (NUMBER_FIELDS.has(key)) {
          if (raw === '') continue
          const n = Number(raw)
          if (!Number.isFinite(n)) continue
          ;(patch as Record<string, unknown>)[key] = n
        } else if (raw !== '') {
          ;(patch as Record<string, unknown>)[key] = raw
        }
      }
      return api.patchObject(objectType, id, patch)
    },
    onSuccess: (obj, id) => {
      queryClient.setQueryData<ModelNetwork>(['network'], (prev) =>
        prev ? upsertNetworkObject(prev, obj) : prev,
      )
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      void queryClient.invalidateQueries({ queryKey: ['object'] })
      void queryClient.invalidateQueries({ queryKey: ['network'] })
    },
    onError: (err) =>
      toast({ title: 'Save failed', description: (err as Error).message, tone: 'danger' }),
  })

  const tabMeta: Array<{
    value: TabKind
    label: string
    count: number
    icon: typeof Circle
    color: string
    mapColor: string
  }> = [
    {
      value: 'junctions',
      mapColor: ELEMENT_COLOR.junction,
      label: 'Junctions',
      count: grouped.junctions.length,
      icon: Circle,
      color: 'text-slate-300',
    },
    {
      value: 'outfalls',
      mapColor: ELEMENT_COLOR.outfall,
      label: 'Outfalls',
      count: grouped.outfalls.length,
      icon: Triangle,
      color: 'text-red-400',
    },
    {
      value: 'storage',
      mapColor: ELEMENT_COLOR.storage,
      label: 'Storage',
      count: grouped.storage.length,
      icon: Hexagon,
      color: 'text-emerald-400',
    },
    {
      value: 'conduits',
      mapColor: ELEMENT_COLOR.conduit,
      label: 'Conduits',
      count: grouped.conduits.length,
      icon: Spline,
      color: 'text-blue-400',
    },
    {
      value: 'pumps',
      mapColor: ELEMENT_COLOR.pump,
      label: 'Pumps',
      count: grouped.pumps.length,
      icon: Spline,
      color: 'text-pink-400',
    },
    {
      value: 'orifices',
      mapColor: ELEMENT_COLOR.orifice,
      label: 'Orifices',
      count: grouped.orifices.length,
      icon: Spline,
      color: 'text-violet-400',
    },
    {
      value: 'weirs',
      mapColor: ELEMENT_COLOR.weir,
      label: 'Weirs',
      count: grouped.weirs.length,
      icon: Spline,
      color: 'text-yellow-500',
    },
    {
      value: 'outlets',
      mapColor: ELEMENT_COLOR.outlet,
      label: 'Outlets',
      count: grouped.outlets.length,
      icon: Spline,
      color: 'text-orange-400',
    },
    {
      value: 'subcatchments',
      mapColor: ELEMENT_COLOR.subcatchment,
      label: 'Subcatchments',
      count: grouped.subs.length,
      icon: Pentagon,
      color: 'text-green-500',
    },
  ]

  const linkTotal =
    grouped.conduits.length +
    grouped.pumps.length +
    grouped.orifices.length +
    grouped.weirs.length +
    grouped.outlets.length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <PageHeader
        className="pb-1"
        title="Elements"
        description={
          network.data
            ? `${networkCounts({ junctions: grouped.junctions.length, outfalls: grouped.outfalls.length, storage: grouped.storage.length, links: linkTotal, subcatchments: grouped.subs.length })}.${IS_VIEWER ? '' : ' Click a value to edit it; Enter saves the row.'}${problemCount ? ` ${problemCount} value${problemCount === 1 ? ' looks' : 's look'} wrong on this tab (red).` : ''}`
            : undefined
        }
        actions={
          <>
            {!IS_VIEWER && dirtyIds.size > 0 && (
              <>
                <Button
                  size="md"
                  variant="ghost"
                  onClick={() => {
                    setDrafts({})
                    setDirtyIds(new Set())
                  }}
                >
                  Discard
                </Button>
                <Button size="md" variant="primary" disabled={save.isPending} onClick={() => dirtyIds.forEach((id) => save.mutate(id))}>
                  Save {dirtyIds.size} {dirtyIds.size === 1 ? 'change' : 'changes'}
                </Button>
              </>
            )}
            <label className="relative block w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by ID"
                aria-label="Filter by ID"
                className="field h-8 w-full pl-8"
              />
            </label>
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as TabKind)
          setSort(null)
          setFilter('')
          setDrafts({})
          setDirtyIds(new Set())
        }}
      >
        <TabsList className="flex h-auto flex-wrap gap-1">
          {tabMeta.map(({ value, label, count, icon: Icon, mapColor }) => (
            <TabsTrigger key={value} value={value} className={cn('gap-1.5', count === 0 && 'opacity-40')}>
              <Icon className="h-3.5 w-3.5" style={{ color: mapColor }} strokeWidth={2.2} />
              {label}
              <span className="text-[11px] tabular-nums text-muted">{count}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {tabMeta.map(({ value: kind }) => (
          <TabsContent key={kind} value={kind} className="min-h-0 flex-1">
            <div className="mt-3 flex h-[calc(100vh-210px)] min-h-[320px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border bg-elevated">
              {network.isLoading && (
                <p className="p-4 text-sm text-muted">Loading network…</p>
              )}
              {network.isError && (
                <p className="p-4 text-sm text-danger">{(network.error as Error).message}</p>
              )}
              {network.data && kind === tab && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                    <thead className="sticky top-0 z-10 bg-elevated">
                      <tr className="border-b border-border text-[12px] text-muted">
                        {cols.map((c) => (
                          <th
                            key={c}
                            aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                            className={cn(
                              'whitespace-nowrap px-3 py-2 font-medium',
                              NUMBER_FIELDS.has(c) && 'text-right',
                              c === 'id' && 'sticky left-0 z-20 bg-elevated',
                            )}
                          >
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:text-fg"
                              onClick={() =>
                                setSort((p) => (p?.col === c ? (p.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))
                              }
                            >
                              {colLabel(c)}
                              {unitLabel(COL_UNIT[c], us) && <span className="font-normal text-muted/70">{unitLabel(COL_UNIT[c], us)}</span>}
                              {sort?.col === c && <span aria-hidden>{sort.dir === 1 ? '↑' : '↓'}</span>}
                            </button>
                          </th>
                        ))}
                        {!IS_VIEWER && <th className="w-20 px-3 py-2" aria-label="Row actions" />}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((f) => {
                        const id = String(f.properties?.id ?? '')
                        const values = getRow(id, f.properties as Record<string, unknown>)
                        const dirty = dirtyIds.has(id)
                        return (
                          <tr
                            key={id}
                            className={cn('group border-b border-border/60 hover:bg-fg/[0.025]', dirty && 'bg-accent/[0.06] hover:bg-accent/[0.08]')}
                          >
                            {cols.map((c) => {
                              const editable = !IS_VIEWER && EDITABLE[kind].has(c)
                              const problem = cellProblem(c, values[c] ?? '', nodeIds)
                              return (
                                <td
                                  key={c}
                                  title={problem ?? undefined}
                                  className={cn(
                                    'px-1 py-0.5',
                                    NUMBER_FIELDS.has(c) && 'text-right [&_input]:text-right',
                                    c === 'id' && 'sticky left-0 z-10 bg-elevated px-3 font-medium text-fg',
                                    problem && '[&_input]:border-danger/60 [&_input]:text-danger [&_span]:text-danger',
                                  )}
                                >
                                  {editable && c === 'link_kind' ? (
                                    <select
                                      value={values[c] ?? ''}
                                      onChange={(e) =>
                                        setCell(
                                          id,
                                          f.properties as Record<string, unknown>,
                                          c,
                                          e.target.value,
                                        )
                                      }
                                      className="h-7 w-full min-w-[5rem] rounded border border-transparent bg-transparent px-2 tabular-nums text-fg hover:border-border focus:border-accent focus:bg-surface focus:outline-none"
                                    >
                                      {LINK_KIND_SELECT.map((k) => (
                                        <option key={k} value={k}>
                                          {k}
                                        </option>
                                      ))}
                                    </select>
                                  ) : editable ? (
                                    <input
                                      value={values[c] ?? ''}
                                      onChange={(e) =>
                                        setCell(
                                          id,
                                          f.properties as Record<string, unknown>,
                                          c,
                                          e.target.value,
                                        )
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && dirty) save.mutate(id)
                                      }}
                                      className="h-7 w-full min-w-[5rem] rounded border border-transparent bg-transparent px-2 tabular-nums text-fg hover:border-border focus:border-accent focus:bg-surface focus:outline-none"
                                    />
                                  ) : (
                                    <span className={cn('px-1', c === 'id' ? 'text-fg' : 'text-fg-soft')}>
                                      {values[c]}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                            {!IS_VIEWER && (
                              <td className="px-2 py-0.5 text-right">
                                {dirty && (
                                  <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate(id)}>
                                    Save
                                  </Button>
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                      {filtered.length === 0 && (
                        <tr>
                          <td
                            colSpan={cols.length + 1}
                            className="px-3 py-8 text-center text-sm text-muted"
                          >
                            {filter.trim() ? (
                              `Nothing matches “${filter.trim()}”.`
                            ) : (
                              <>
                                No {tabMeta.find((m) => m.value === kind)?.label.toLowerCase()} in this model yet.
                                {!IS_VIEWER && (
                                  <>
                                    {' '}
                                    <Link to="/map" className="text-accent-soft hover:underline">
                                      Draw one on the map
                                    </Link>
                                    .
                                  </>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
