/**
 * Element panel tabs for model inputs that live outside the element's own
 * row: a node's inflows ([DWF], [INFLOWS], [RDII]) and a subcatchment's LID
 * controls ([LID_USAGE]).
 */
import { useQuery } from '@tanstack/react-query'
import { ChartLine, Sprout } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { dwfProfile, parseDwf, parseInflows, parsePatterns, parseRdii } from '../../lib/inflows'
import { LID_TYPES, parseLidControls, parseLidUsage } from '../../lib/lid'

const sec = (name: string) => ({ queryKey: ['section', name], queryFn: () => api.getSection(name), retry: false, staleTime: 30_000 })
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()
const num = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : Number(v.toPrecision(4)).toString())

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1e-12)
  const W = 220
  const H = 36
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - (v / max) * (H - 4) - 2}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 block h-9 w-full" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-fg/[0.02] p-2.5">
      <h4 className="m-0 mb-1 text-[12px] font-semibold text-fg">{title}</h4>
      {children}
    </section>
  )
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 text-[12px]">
    <span className="text-muted">{k}</span>
    <span className="text-right font-mono text-fg">{v}</span>
  </div>
)

export function NodeInflows({ id, flowUnits, onShowInGraphs }: { id: string; flowUnits?: string | null; onShowInGraphs?: (key: string) => void }) {
  const dwfQ = useQuery(sec('DWF'))
  const infQ = useQuery(sec('INFLOWS'))
  const rdiiQ = useQuery(sec('RDII'))
  const patQ = useQuery(sec('PATTERNS'))
  const patterns = useMemo(() => parsePatterns(patQ.data?.rows ?? []), [patQ.data])
  const dwf = useMemo(() => parseDwf(dwfQ.data?.rows ?? []).filter((d) => same(d.node, id)), [dwfQ.data, id])
  const inf = useMemo(() => parseInflows(infQ.data?.rows ?? []).filter((d) => same(d.node, id)), [infQ.data, id])
  const rdii = useMemo(() => parseRdii(rdiiQ.data?.rows ?? []).filter((d) => same(d.node, id)), [rdiiQ.data, id])
  const fu = (flowUnits ?? '').toUpperCase()

  if (dwfQ.isLoading || infQ.isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (!dwf.length && !inf.length && !rdii.length)
    return <p className="text-[12px] text-muted">No inflows enter the network here. Runoff from subcatchments that drain to this node is not listed.</p>

  return (
    <div className="space-y-2">
      {dwf.map((d, i) => {
        const prof = dwfProfile(d, patterns)
        const peak = Math.max(...prof.values)
        return (
          <Card key={`dwf${i}`} title={`Dry-weather flow${same(d.constituent, 'FLOW') ? '' : ` · ${d.constituent}`}`}>
            <Row k="Average" v={`${num(d.baseline)} ${same(d.constituent, 'FLOW') ? fu : ''}`} />
            {same(d.constituent, 'FLOW') && <Row k="Peak hour" v={`${num(peak)} ${fu}`} />}
            <Row k="Patterns" v={d.patterns.length ? d.patterns.join(', ') : 'none'} />
            {same(d.constituent, 'FLOW') && <Spark values={prof.values} />}
            {same(d.constituent, 'FLOW') && onShowInGraphs && (
              <button type="button" onClick={() => onShowInGraphs(`dwf:${d.node}`)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline">
                <ChartLine className="h-3 w-3" /> Daily profile in Graphs
              </button>
            )}
          </Card>
        )
      })}
      {inf.map((f, i) => (
        <Card key={`inf${i}`} title={`External inflow${same(f.constituent, 'FLOW') ? '' : ` · ${f.constituent}`}`}>
          {f.series && <Row k="Time series" v={f.series} />}
          {f.baseline !== 0 && <Row k="Baseline" v={num(f.baseline)} />}
          {(f.mfactor !== 1 || f.sfactor !== 1) && <Row k="Scale" v={`× ${num(f.mfactor * f.sfactor)}`} />}
          {f.basePattern && <Row k="Baseline pattern" v={f.basePattern} />}
          {onShowInGraphs && (
            <button type="button" onClick={() => onShowInGraphs(`inflow:${f.node}`)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline">
              <ChartLine className="h-3 w-3" /> Show in Graphs
            </button>
          )}
        </Card>
      ))}
      {rdii.map((r, i) => (
        <Card key={`rdii${i}`} title="Rainfall-dependent I&I">
          <Row k="Unit hydrograph" v={r.unitHydrograph} />
          <Row k="Sewershed area" v={num(r.area)} />
        </Card>
      ))}
    </div>
  )
}

export function SubcatchmentLid({ id, areaUnitUs }: { id: string; areaUnitUs: boolean }) {
  const useQ = useQuery(sec('LID_USAGE'))
  const ctlQ = useQuery(sec('LID_CONTROLS'))
  const uses = useMemo(() => parseLidUsage(useQ.data?.rows ?? []).filter((u) => same(u.subcatchment, id)), [useQ.data, id])
  const designs = useMemo(() => parseLidControls(ctlQ.data?.rows ?? []), [ctlQ.data])
  if (useQ.isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (!uses.length)
    return (
      <p className="text-[12px] text-muted">
        No LID controls in this subcatchment.{' '}
        <Link to="/lid" className="text-accent-soft hover:underline">
          LID controls
        </Link>
      </p>
    )
  return (
    <div className="space-y-2">
      {uses.map((u, i) => {
        const d = designs.find((x) => same(x.name, u.lid))
        const t = d ? LID_TYPES[d.type] : null
        return (
          <section key={i} className="rounded-lg border border-border bg-fg/[0.02] p-2.5">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded text-[9px] font-semibold text-white" style={{ background: t?.color ?? '#64748b' }}>
                {d?.type ?? '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-fg">{u.lid}</span>
                <span className="block text-[11px] text-muted">{t?.label ?? 'Unknown design'}</span>
              </span>
            </div>
            <Row k="Units × area each" v={`${u.number} × ${u.area} ${areaUnitUs ? 'ft²' : 'm²'}`} />
            <Row k="Impervious area treated" v={`${u.fromImp} %`} />
            {u.fromPerv && u.fromPerv !== '0' && <Row k="Pervious area treated" v={`${u.fromPerv} %`} />}
            {u.drainTo && u.drainTo !== '*' && <Row k="Underdrain to" v={u.drainTo} />}
          </section>
        )
      })}
      <Link to="/lid" className="inline-flex items-center gap-1 text-[11px] text-accent-soft hover:underline">
        <Sprout className="h-3 w-3" /> Open LID controls
      </Link>
    </div>
  )
}
