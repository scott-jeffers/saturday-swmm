/** Inspector tabs beyond properties: the element's results and what it connects to, plus a model overview. */
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { Feature } from 'geojson'
import { api, type ModelNetwork } from '../../api/client'
import { focusOnMap } from '../../lib/mapFocus'
import { useRunSummary, RunSummaryBody } from '../RunSummaryCard'
import { Button, Panel } from '../ui'
import { noteKey, useNotes } from '../../lib/notes'
import { convertTable, useUnitSystem } from '../../lib/units'
import { useEffect, useState } from 'react'

type Sel = { object_type: 'node' | 'link' | 'subcatchment'; id: string }

const fmt = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(1) : String(Number(v.toPrecision(4)))) : String(v ?? '—'))

export function ElementResults({ selection }: { selection: Sel }) {
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const s = useRunSummary(project.data?.has_out ? project.data.path : null)
  const system = useUnitSystem()
  if (!project.data?.has_out) return <p className="m-0 text-[12px] text-muted">No results yet. Run the model to see this element’s peaks.</p>
  const tables = (s.data?.tables ?? []).filter((t) => t.object === selection.object_type).map((t) => convertTable(t, system))
  const rows = tables
    .map((t) => ({ t, row: t.rows.find((r) => String(r[0]) === selection.id) }))
    .filter((x) => x.row)
  if (!rows.length) return <p className="m-0 text-[12px] text-muted">The report has no rows for {selection.id}.</p>
  return (
    <div className="space-y-3">
      {rows.map(({ t, row }) => (
        <div key={t.title}>
          <div className="mb-1 text-[11px] font-medium text-muted">{t.title.replace(/ Summary$/, '')}</div>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[12px]">
            {t.columns.slice(1).map((c, i) => (
              <div key={c} className="contents">
                <dt className="text-fg-soft">{c}</dt>
                <dd className="m-0 text-right tabular-nums text-fg">
                  {fmt(row![i + 1])}
                  {t.units?.[i + 1] ? <span className="ml-1 text-muted">{t.units[i + 1]}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

export function ElementConnections({ selection }: { selection: Sel }) {
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const feats = (network.data?.geojson.features ?? []) as Feature[]
  const go = (object_type: Sel['object_type'], id: string) => focusOnMap({ object_type, id })
  const Item = ({ t, id, note }: { t: Sel['object_type']; id: string; note?: string }) => (
    <li>
      <button type="button" onClick={() => go(t, id)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-fg/5">
        <span className="font-medium text-accent-soft">{id}</span>
        {note && <span className="text-muted">{note}</span>}
      </button>
    </li>
  )
  if (selection.object_type === 'link') {
    const f = feats.find((x) => x.properties?.object_type === 'link' && String(x.properties?.id) === selection.id)
    const p = f?.properties ?? {}
    return (
      <ul className="m-0 list-none space-y-0.5 p-0 text-[12px]">
        <Item t="node" id={String(p.from_node ?? '')} note="from (upstream)" />
        <Item t="node" id={String(p.to_node ?? '')} note="to (downstream)" />
      </ul>
    )
  }
  if (selection.object_type === 'subcatchment') {
    const f = feats.find((x) => x.properties?.object_type === 'subcatchment' && String(x.properties?.id) === selection.id)
    const out = String(f?.properties?.outlet ?? '')
    const isSub = feats.some((x) => x.properties?.object_type === 'subcatchment' && String(x.properties?.id) === out)
    return <ul className="m-0 list-none p-0 text-[12px]">{out && <Item t={isSub ? 'subcatchment' : 'node'} id={out} note="drains to" />}</ul>
  }
  const links = feats.filter((x) => x.properties?.object_type === 'link')
  const inflow = links.filter((l) => String(l.properties?.to_node) === selection.id)
  const outflow = links.filter((l) => String(l.properties?.from_node) === selection.id)
  const subs = feats.filter((x) => x.properties?.object_type === 'subcatchment' && String(x.properties?.outlet) === selection.id)
  const Group = ({ title, icon, list, t, note }: { title: string; icon: ReactNode; list: Feature[]; t: Sel['object_type']; note?: (f: Feature) => string }) => (
    <div>
      <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-muted">
        {icon}
        {title} <span className="tabular-nums">{list.length}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {list.map((l) => (
          <Item key={String(l.properties?.id)} t={t} id={String(l.properties?.id)} note={note?.(l)} />
        ))}
        {!list.length && <li className="px-1.5 text-[12px] text-muted">None</li>}
      </ul>
    </div>
  )
  return (
    <div className="space-y-3">
      <Group title="Inflow links" icon={<ArrowDownRight className="h-3 w-3" />} list={inflow} t="link" note={(l) => `from ${l.properties?.from_node}`} />
      <Group title="Outflow links" icon={<ArrowUpRight className="h-3 w-3" />} list={outflow} t="link" note={(l) => `to ${l.properties?.to_node}`} />
      {subs.length > 0 && <Group title="Subcatchments draining here" icon={null} list={subs} t="subcatchment" />}
    </div>
  )
}

export function ModelOverview() {
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const s = useRunSummary(project.data?.has_out ? project.data.path : null)
  const c = network.data?.counts ?? {}
  const links = c.links ?? 0
  return (
    <Panel title="Model">
      <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        {(
          [
            ['Junctions', c.junctions],
            ['Outfalls', c.outfalls],
            ['Storage units', c.storage],
            ['Links', links],
            ['Subcatchments', c.subcatchments],
            ['Flow units', project.data?.flow_units],
          ] as [string, unknown][]
        ).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 text-right tabular-nums text-fg">{String(v ?? 0)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-t border-border pt-3">
        {s.data?.available ? (
          <>
            {project.data?.results_stale && <p className="mb-2 mt-0 text-[12px] text-warning">The model changed after this run.</p>}
            <RunSummaryBody s={s.data} />
          </>
        ) : (
          <p className="m-0 text-[12px] text-muted">No run yet. Press Run (Ctrl+Enter) to simulate the model.</p>
        )}
      </div>
      <p className="mb-0 mt-3 text-[11px] text-muted">Click an element to see its properties, results and connections.</p>
    </Panel>
  )
}

export function ElementNotes({ selection }: { selection: Sel }) {
  const { notes, save } = useNotes()
  const key = noteKey(selection.object_type, selection.id)
  const [text, setText] = useState(notes[key]?.text ?? '')
  useEffect(() => setText(notes[key]?.text ?? ''), [key, notes])
  const dirty = text.trim() !== (notes[key]?.text ?? '')
  return (
    <div className="space-y-2">
      <textarea
        className="field h-28 py-1.5 text-[12px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="A review comment, a site observation, a question for the designer…"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted">{notes[key] ? `Saved ${new Date(notes[key].updated).toLocaleString()}` : 'Notes are kept in the project folder.'}</span>
        <Button size="sm" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate({ key, text })}>
          {text.trim() || !notes[key] ? 'Save note' : 'Remove note'}
        </Button>
      </div>
    </div>
  )
}
