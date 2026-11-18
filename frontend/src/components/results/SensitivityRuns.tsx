/**
 * One-at-a-time sensitivity: scale a parameter across the whole model by a few
 * percentages, run each, then put the model back exactly as it was.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Feature } from 'geojson'
import { api, type ModelNetwork } from '../../api/client'
import { refreshAfterEdit } from '../UndoRedo'
import { Button, Panel, useToast } from '../ui'

const PARAMS = [
  { key: 'roughness', label: "Manning's n of every conduit", target: 'link' as const, kinds: ['conduit'] },
  { key: 'pct_imperv', label: '% impervious of every subcatchment', target: 'subcatchment' as const, clampTo100: true },
  { key: 'width', label: 'Width of every subcatchment', target: 'subcatchment' as const },
  { key: 'slope', label: 'Slope of every subcatchment', target: 'subcatchment' as const },
]

type Row = { pct: number; state: 'waiting' | 'running' | 'done' | 'failed'; summary?: Record<string, number | string | null>; note?: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function SensitivityRuns() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork() })
  const [param, setParam] = useState(PARAMS[0].key)
  const [pcts, setPcts] = useState('-20, -10, 10, 20')
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const p = PARAMS.find((x) => x.key === param)!

  const run = async () => {
    const list = pcts
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n !== 0 && n > -100)
    const feats = ((network.data?.geojson.features ?? []) as Feature[]).filter(
      (f) => f.properties?.object_type === p.target && (!p.kinds || p.kinds.includes(String(f.properties?.link_kind ?? 'conduit'))),
    )
    if (!list.length || !feats.length) return
    setBusy(true)
    setRows(list.map((pct) => ({ pct, state: 'waiting' })))
    const set = (pct: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.pct === pct ? { ...x, ...patch } : x)))
    const base = await api.createSnapshot(`Before sensitivity on ${param}`)
    try {
      for (const pct of list) {
        set(pct, { state: 'running', note: 'Changing the model' })
        try {
          await api.restoreSnapshot(base.id)
          const items = feats.map((f) => {
            const cur = Number(f.properties?.[param] ?? 0)
            let next = cur * (1 + pct / 100)
            if (p.clampTo100) next = Math.min(100, Math.max(0, next))
            return { object_type: p.target, id: String(f.properties?.id), patch: { [param]: Number(next.toPrecision(6)) } }
          })
          await api.bulkPatch(items)
          set(pct, { note: 'Running' })
          await api.startRun({})
          let st = await api.getRunStatus()
          for (let i = 0; i < 7200 && (st.status === 'running' || st.status === 'idle'); i++) {
            await sleep(1000)
            st = await api.getRunStatus()
          }
          if (st.status !== 'completed') throw new Error(st.error?.split('\n')[0] || `Run ${st.status}`)
          await sleep(800)
          const runs = (await api.listRuns()).runs
          const latest = [...runs].sort((a, b) => (b.finished ?? '').localeCompare(a.finished ?? ''))[0]
          if (latest) await api.updateRun(latest.id, { label: `${param} ${pct > 0 ? '+' : ''}${pct}%`, pinned: true })
          set(pct, { state: 'done', summary: latest?.summary, note: undefined })
        } catch (e) {
          set(pct, { state: 'failed', note: (e as Error).message })
        }
      }
    } finally {
      await api.restoreSnapshot(base.id).catch(() => undefined)
      refreshAfterEdit(qc)
      for (const k of ['runStatus', 'project', 'rpt-summary', 'runs-archive', 'periods', 'out-periods']) void qc.invalidateQueries({ queryKey: [k] })
      setBusy(false)
      toast({ title: 'Sensitivity runs finished', description: 'The model is back as it was. The runs are kept under Compare runs. Re-run to refresh the current results.', tone: 'success' })
    }
  }

  const num = (v: unknown, d = 2) => (typeof v === 'number' ? v.toFixed(d) : '—')
  return (
    <Panel title="Sensitivity">
      <p className="mb-3 mt-0 text-[12px] text-muted">
        Scale one parameter across the whole model, run each case, then restore the model. Each run is kept and named under Compare runs.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="block text-[12px] font-medium text-fg-soft">
          Parameter
          <select className="field mt-1 w-72" value={param} onChange={(e) => setParam(e.target.value)} disabled={busy}>
            {PARAMS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[12px] font-medium text-fg-soft">
          Changes (%)
          <input className="field mt-1 w-44" value={pcts} onChange={(e) => setPcts(e.target.value)} disabled={busy} />
        </label>
        <Button variant="primary" disabled={busy || !network.data} onClick={() => void run()}>
          {busy ? 'Running…' : 'Run cases'}
        </Button>
      </div>
      {rows.length > 0 && (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-3 font-medium">Change</th>
              <th className="py-1 pr-3 text-right font-medium">Flooded nodes</th>
              <th className="py-1 pr-3 text-right font-medium">Flood volume</th>
              <th className="py-1 pr-3 text-right font-medium">Surcharged conduits</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pct} className="border-b border-border/60">
                <td className="py-1 pr-3 font-medium text-fg">
                  {r.pct > 0 ? '+' : ''}
                  {r.pct} %
                </td>
                <td className="py-1 pr-3 text-right tabular-nums">{num(r.summary?.flooded_nodes, 0)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{num(r.summary?.flood_volume, 3)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{num(r.summary?.surcharged_conduits, 0)}</td>
                <td className={`py-1 ${r.state === 'failed' ? 'text-danger' : r.state === 'done' ? 'text-success' : 'text-muted'}`}>
                  {r.state === 'done' ? 'Done' : r.state === 'failed' ? r.note : r.note ?? 'Waiting'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
