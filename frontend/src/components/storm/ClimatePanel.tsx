/**
 * SWMM-CAT climate projections for a location: monthly temperature, rainfall
 * and evaporation changes to write to [ADJUSTMENTS], and 24-hour design storm
 * changes to use as a depth uplift. Shared by the app's Rainfall page and the
 * viewer's Rain gages page; the page supplies the location picker and what
 * "apply" does.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Panel } from '../ui'
import { cn } from '../../lib/cn'
import {
  adjustmentRows,
  CAT_SCENARIOS,
  isUsUnits,
  loadClimate,
  MONTHS,
  SCENARIO_LABEL,
  type AdjustmentKind,
  type CatData,
  type CatScenario,
  type CatYear,
} from '../../lib/swmmCat'

const SCEN_COLOR: Record<CatScenario, string> = { HotDry: '#e07a2f', Central: '#8b7fd8', WetWarm: '#1f9bd1' }
const KINDS: { k: AdjustmentKind; label: string }[] = [
  { k: 'RAINFALL', label: 'Rainfall' },
  { k: 'TEMPERATURE', label: 'Temperature' },
  { k: 'EVAPORATION', label: 'Evaporation' },
]

export type AdjustmentRow = { kind: AdjustmentKind; values: number[] }

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-border p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            'h-7 flex-1 rounded-md px-2.5 text-[12px] whitespace-nowrap',
            value === o.v ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:bg-fg/5 hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const signed = (v: number, dp: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`

export function ClimatePanel({
  lat,
  lon,
  flowUnits,
  location,
  applyLabel,
  onApply,
  onUseUplift,
  footer,
}: {
  lat: number | null
  lon: number | null
  flowUnits: string
  /** The page's location picker. */
  location: ReactNode
  applyLabel: string
  onApply: (rows: AdjustmentRow[], summary: string) => Promise<void> | void
  /** Use a design storm change as the design storm's climate uplift (app only). */
  onUseUplift?: (pct: number, rp: number) => void
  footer?: ReactNode
}) {
  const us = isUsUnits(flowUnits)
  const [year, setYear] = useState<CatYear>(2060)
  const [scenario, setScenario] = useState<CatScenario>('Central')
  const [shown, setShown] = useState<AdjustmentKind>('RAINFALL')
  const [kinds, setKinds] = useState<Set<AdjustmentKind>>(new Set(['RAINFALL', 'TEMPERATURE', 'EVAPORATION']))
  const [future, setFuture] = useState<'stormy' | 'lessStormy'>('stormy')
  const [data, setData] = useState<CatData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (lat == null || lon == null) return
    let live = true
    const t = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      loadClimate(lat, lon)
        .then((d) => live && setData(d))
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => live && setLoading(false))
    }, 250)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [lat, lon])

  const unit = (k: AdjustmentKind) =>
    k === 'RAINFALL' ? '%' : k === 'TEMPERATURE' ? (us ? '°F' : '°C') : us ? 'in/day' : 'mm/day'
  // Chart values: rainfall as % change, the others in the model's units.
  const series = (d: CatData, k: AdjustmentKind, s: CatScenario) => {
    if (k === 'RAINFALL') return d.rainfallPct(year, s)
    if (k === 'TEMPERATURE') return d.temperatureF(year, s).map((v) => (us ? v : (v * 5) / 9))
    return d.evaporationIn(year, s)?.map((v) => (us ? v : v * 25.4)) ?? null
  }
  const chart = useMemo(() => {
    if (!data) return []
    const cols = CAT_SCENARIOS.map((s) => series(data, shown, s))
    return MONTHS.map((m, i) => ({ m, ...Object.fromEntries(CAT_SCENARIOS.map((s, j) => [s, cols[j]?.[i] ?? null])) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, shown, year, us])

  const rows = useMemo(
    () => (data ? adjustmentRows(data, year, scenario, KINDS.map((k) => k.k).filter((k) => kinds.has(k)), us) : []),
    [data, year, scenario, kinds, us],
  )
  const storm = data?.storm(year) ?? []
  const depth = (mm: number) => (us ? (mm / 25.4).toFixed(2) : mm.toFixed(0))
  const dUnit = us ? 'in' : 'mm'
  const far = data && data.station.distanceKm > 100
  const dist = (km: number) => (us ? `${(km * 0.6214).toFixed(km < 16 ? 1 : 0)} mi` : `${km.toFixed(km < 10 ? 1 : 0)} km`)
  const tick = { fontSize: 10, fill: 'var(--color-muted)' }
  const dp = shown === 'EVAPORATION' ? (us ? 3 : 2) : shown === 'TEMPERATURE' ? 1 : 0

  const apply = async () => {
    setBusy(true)
    try {
      await onApply(rows, `${SCENARIO_LABEL[scenario]} ${year}, station ${data?.station.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Panel title="Location">
          {location}
          <p className="mt-2 text-[12px] text-muted" aria-live="polite">
            {lat == null || lon == null
              ? 'Pick a location to load projections.'
              : loading
                ? 'Finding the nearest climate station…'
                : error
                  ? <span className="text-danger">{error}</span>
                  : data
                    ? <>Nearest climate station <span className="font-medium text-fg">{data.station.id}</span>, {dist(data.station.distanceKm)} away
                        {data.evapStation && data.evapStation.id !== data.station.id ? <> (evaporation from {data.evapStation.id}, {dist(data.evapStation.distanceKm)})</> : null}.</>
                    : null}
          </p>
          {far ? (
            <p className="mt-1 text-[12px] text-warning">
              That is far from this point. SWMM-CAT data covers the United States only; outside it, these numbers don't describe this site.
            </p>
          ) : null}
        </Panel>

        <Panel title="Projection">
          <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
            <span className="text-[12px] font-medium text-fg-soft">Period</span>
            <Segmented
              label="Projection period"
              value={year}
              onChange={setYear}
              options={[
                { v: 2035, label: '2035 (2025–2045)' },
                { v: 2060, label: '2060 (2050–2070)' },
              ]}
            />
            <span className="text-[12px] font-medium text-fg-soft">Scenario</span>
            <Segmented
              label="Climate scenario"
              value={scenario}
              onChange={setScenario}
              options={CAT_SCENARIOS.map((s) => ({ v: s, label: SCENARIO_LABEL[s] }))}
            />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Three CMIP5 model groups under a high-emissions path (RCP 8.5): hot/dry has the most warming and least rain, warm/wet the least warming and most rain, central is nearest the median.
          </p>
        </Panel>

        <Panel title="Monthly adjustments">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {KINDS.map(({ k, label }) => (
              <label key={k} className="flex items-center gap-1.5 text-[12px] text-fg-soft">
                <input
                  type="checkbox"
                  checked={kinds.has(k)}
                  onChange={(e) =>
                    setKinds((prev) => {
                      const n = new Set(prev)
                      if (e.target.checked) n.add(k)
                      else n.delete(k)
                      return n
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 text-left font-medium">Month</th>
                  {rows.map((r) => (
                    <th key={r.kind} className="py-1 pl-3 text-right font-medium whitespace-nowrap">
                      {r.kind === 'RAINFALL' ? 'Rainfall ×' : r.kind === 'TEMPERATURE' ? `Temperature ${unit('TEMPERATURE')}` : `Evaporation ${unit('EVAPORATION')}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MONTHS.map((m, i) => (
                  <tr key={m} className="border-t border-border">
                    <td className="py-0.5 text-fg-soft">{m}</td>
                    {rows.map((r) => (
                      <td key={r.kind} className="py-0.5 pl-3 text-right">
                        {r.kind === 'RAINFALL' ? r.values[i]!.toFixed(3) : signed(r.values[i]!, r.kind === 'TEMPERATURE' ? 1 : us ? 3 : 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Rainfall is a multiplier; temperature and evaporation are added. Temperature only matters with a [TEMPERATURE] climate file, evaporation with [EVAPORATION] data.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void apply()} disabled={!rows.length || busy || loading}>
              {applyLabel}
            </Button>
            {footer}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-3">
        <Panel
          title="Monthly change by scenario"
          actions={
            <Segmented
              label="Variable"
              value={shown}
              onChange={setShown}
              options={KINDS.map((k) => ({ v: k.k, label: k.label }))}
            />
          }
        >
          <div className="h-56" aria-label={`Monthly ${shown.toLowerCase()} change for ${year}`}>
            {data ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="m" tick={tick} />
                  <YAxis width={56} tick={tick} tickFormatter={(v) => `${signed(Number(v), dp)}${shown === 'RAINFALL' ? ' %' : shown === 'TEMPERATURE' ? '°' : ''}`} />
                  <ReferenceLine y={0} stroke="var(--color-muted)" strokeOpacity={0.5} />
                  <Tooltip
                    formatter={(v, name) => [`${signed(Number(v), dp)} ${unit(shown)}`, SCENARIO_LABEL[name as CatScenario]]}
                    contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', fontSize: 11 }}
                  />
                  {CAT_SCENARIOS.map((s) => (
                    <Line
                      key={s}
                      dataKey={s}
                      stroke={SCEN_COLOR[s]}
                      strokeWidth={s === scenario ? 2.5 : 1.25}
                      strokeOpacity={s === scenario ? 1 : 0.55}
                      dot={s === scenario ? { r: 2.5 } : false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-[12px] text-muted">{loading ? 'Loading…' : 'No projections yet'}</div>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted">
            {CAT_SCENARIOS.map((s) => (
              <button key={s} type="button" onClick={() => setScenario(s)} className={cn('flex items-center gap-1.5', s === scenario && 'font-medium text-fg')}>
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: SCEN_COLOR[s] }} />
                {SCENARIO_LABEL[s]}
              </button>
            ))}
            <span className="ml-auto">Change from historical, {year}</span>
          </div>
        </Panel>

        <Panel
          title="24-hour design storm"
          actions={
            <Segmented
              label="Storm future"
              value={future}
              onChange={setFuture}
              options={[
                { v: 'stormy', label: 'Stormy' },
                { v: 'lessStormy', label: 'Less stormy' },
              ]}
            />
          }
        >
          <table className="w-full text-[12px] tabular-nums">
            <thead>
              <tr className="text-muted">
                <th className="py-1 text-left font-medium">Return period</th>
                <th className="py-1 text-right font-medium">Historical</th>
                <th className="py-1 text-right font-medium">{year} {future === 'stormy' ? 'stormy' : 'less stormy'}</th>
                <th className="py-1 text-right font-medium">Change</th>
                {onUseUplift ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {storm.map((r) => {
                const f = future === 'stormy' ? r.stormyMm : r.lessStormyMm
                const pct = r.historicalMm > 0 ? (f / r.historicalMm - 1) * 100 : 0
                return (
                  <tr key={r.rp} className="border-t border-border">
                    <td className="py-1">{r.rp}-year</td>
                    <td className="py-1 text-right">{depth(r.historicalMm)} {dUnit}</td>
                    <td className="py-1 text-right">{depth(f)} {dUnit}</td>
                    <td className="py-1 text-right font-medium">{signed(pct, 1)} %</td>
                    {onUseUplift ? (
                      <td className="py-1 pl-2 text-right">
                        <button
                          type="button"
                          className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10 disabled:text-muted"
                          disabled={pct <= 0}
                          title={pct > 0 ? `Set the design storm's climate uplift to ${Math.round(pct)} %` : 'No increase to apply'}
                          onClick={() => onUseUplift(Math.round(pct), r.rp)}
                        >
                          Use as uplift
                        </button>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Annual maximum 24-hour rainfall. Stormy and less stormy futures bracket how much heavier extreme rain gets per degree of warming.
          </p>
        </Panel>

        <p className="px-1 text-[11px] leading-relaxed text-muted">
          Data from EPA's SWMM-CAT 1.1 (CREAT 3.1, CMIP5), as in{' '}
          <a className="underline hover:text-fg" href="https://github.com/scott-jeffers/swmm-cat-online" target="_blank" rel="noreferrer">
            SWMM-CAT Online
          </a>
          . Newer guidance, such as NOAA Atlas 15, may supersede these projections; check what your reviewing agency expects.
        </p>
      </div>
    </div>
  )
}
