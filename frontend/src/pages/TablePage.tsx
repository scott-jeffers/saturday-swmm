import { IS_VIEWER } from '../lib/mode'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Circle, Hexagon, Pentagon, Search, Spline, Triangle } from 'lucide-react'
import { api, type ModelObjectPatch } from '../api/client'
import { featuresByType, upsertNetworkObject } from '../lib/networkCache'
import { Button, Panel, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '../components/ui'
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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((f) => String(f.properties?.id ?? '').toLowerCase().includes(q))
  }, [rows, filter])

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
      toast({ title: 'Saved', description: id, tone: 'success' })
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
  }> = [
    {
      value: 'junctions',
      label: 'Junctions',
      count: grouped.junctions.length,
      icon: Circle,
      color: 'text-slate-300',
    },
    {
      value: 'outfalls',
      label: 'Outfalls',
      count: grouped.outfalls.length,
      icon: Triangle,
      color: 'text-red-400',
    },
    {
      value: 'storage',
      label: 'Storage',
      count: grouped.storage.length,
      icon: Hexagon,
      color: 'text-emerald-400',
    },
    {
      value: 'conduits',
      label: 'Conduits',
      count: grouped.conduits.length,
      icon: Spline,
      color: 'text-blue-400',
    },
    {
      value: 'pumps',
      label: 'Pumps',
      count: grouped.pumps.length,
      icon: Spline,
      color: 'text-pink-400',
    },
    {
      value: 'orifices',
      label: 'Orifices',
      count: grouped.orifices.length,
      icon: Spline,
      color: 'text-violet-400',
    },
    {
      value: 'weirs',
      label: 'Weirs',
      count: grouped.weirs.length,
      icon: Spline,
      color: 'text-yellow-500',
    },
    {
      value: 'outlets',
      label: 'Outlets',
      count: grouped.outlets.length,
      icon: Spline,
      color: 'text-orange-400',
    },
    {
      value: 'subcatchments',
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold">Elements</h1>
          <p className="m-0 text-sm text-muted">
            Same object types as the map layers
            {network.data
              ? ` · ${grouped.junctions.length} junctions · ${grouped.outfalls.length} outfalls · ${grouped.storage.length} storage · ${linkTotal} links · ${grouped.subs.length} subcatchments`
              : ''}
          </p>
        </div>
        <label className="relative block w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by ID…"
            className="w-full rounded-xl border border-border-strong bg-surface py-2 pl-9 pr-3 text-sm focus:border-accent focus:outline-none"
          />
        </label>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as TabKind)
          setFilter('')
          setDrafts({})
          setDirtyIds(new Set())
        }}
      >
        <TabsList className="flex h-auto flex-wrap gap-1">
          {tabMeta.map(({ value, label, count, icon: Icon, color }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5">
              <Icon className={cn('h-3.5 w-3.5', color)} />
              {label} ({count})
            </TabsTrigger>
          ))}
        </TabsList>

        {tabMeta.map(({ value: kind }) => (
          <TabsContent key={kind} value={kind} className="min-h-0 flex-1">
            <Panel className="flex h-[calc(100vh-220px)] min-h-[320px] flex-col overflow-hidden p-0">
              {network.isLoading && (
                <p className="p-4 text-sm text-muted">Loading network…</p>
              )}
              {network.isError && (
                <p className="p-4 text-sm text-danger">{(network.error as Error).message}</p>
              )}
              {network.data && kind === tab && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-elevated">
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                        {cols.map((c) => (
                          <th key={c} className="px-3 py-2 font-medium">
                            {c}
                          </th>
                        ))}
                        {!IS_VIEWER && <th className="px-3 py-2 font-medium">Actions</th>}
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
                            className="border-b border-border/70 hover:bg-border/20"
                          >
                            {cols.map((c) => {
                              const editable = !IS_VIEWER && EDITABLE[kind].has(c)
                              return (
                                <td key={c} className="px-2 py-1">
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
                                      className="w-full min-w-[6rem] rounded-md border border-border-strong bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
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
                                      className="w-full min-w-[5rem] rounded-md border border-border-strong bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
                                    />
                                  ) : (
                                    <span className="px-1 font-mono text-xs text-fg-soft">
                                      {values[c]}
                                    </span>
                                  )}
                                </td>
                              )
                            })}
                            {!IS_VIEWER && <td className="px-2 py-1">
                              <Button
                                size="sm"
                                variant={dirty ? 'primary' : 'outline'}
                                disabled={!dirty || save.isPending}
                                onClick={() => save.mutate(id)}
                              >
                                Save
                              </Button>
                            </td>}
                          </tr>
                        )
                      })}
                      {filtered.length === 0 && (
                        <tr>
                          <td
                            colSpan={cols.length + 1}
                            className="px-3 py-8 text-center text-sm text-muted"
                          >
                            No matching elements
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
