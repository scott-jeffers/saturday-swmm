import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { PageHeader } from './ui'
import { ManualLink } from './ManualLink'
import { MANUAL } from '../lib/manual'

/** The viewer's Simulation options: what the model is set to run with, read-only. */
export function SimOptionsReadOnly() {
  const opts = useQuery({ queryKey: ['sim-options'], queryFn: api.getSimOptions })
  const twod = useQuery({ queryKey: ['section', '2D_OPTIONS'], queryFn: () => api.getSection('2D_OPTIONS'), retry: false })
  const twodRows = (twod.data?.rows ?? []).filter((r) => r.values.length >= 2)
  const other = Object.entries(opts.data?.other ?? {})
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Simulation options"
          description="How this model is set to run: units, routing, dates and time steps. Change them in the Saturday-SWMM app."
          actions={<ManualLink href={MANUAL.running}>Simulation options in the manual</ManualLink>}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {(opts.data?.groups ?? []).map((g) => {
            const set = g.options.filter((o) => o.value)
            if (!set.length) return null
            return <Card key={g.name} title={g.name} rows={set.map((o) => [o.label, o.value, o.key])} />
          })}
          {twodRows.length > 0 && <Card title="2D surface" rows={twodRows.map((r) => [pretty(r.values[0]!), r.values.slice(1).join(' '), r.values[0]!])} />}
          {other.length > 0 && <Card title="Other options" rows={other.map(([k, v]) => [pretty(k), v, k])} />}
        </div>
        {opts.isLoading && <p className="text-sm text-muted">Loading…</p>}
      </div>
    </div>
  )
}

const pretty = (k: string) => k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ')

function Card({ title, rows }: { title: string; rows: [string, string, string][] }) {
  return (
    <section className="rounded-xl border border-border bg-elevated p-4">
      <h2 className="m-0 mb-3 text-[13px] font-semibold text-fg">{title}</h2>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[12px]">
        {rows.map(([label, value, key]) => (
          <div key={key} className="contents">
            <dt className="truncate text-muted" title={key}>
              {label}
            </dt>
            <dd className="m-0 text-right font-mono text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
