/** Climate settings, grouped like EPA SWMM's Climatology editor: evaporation,
 *  temperature, wind speed, snowmelt, areal depletion and monthly adjustments. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CloudSun } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import { climateProblem, climateToText, emptyClimate, MONTHS, parseClimate, type Climate, type EvapSource, type TempSource } from '../lib/climatology'
import { Button, Panel, Switch, useToast } from './ui'

const TABS = ['Evaporation', 'Temperature', 'Wind speed', 'Snowmelt', 'Areal depletion', 'Monthly adjustments'] as const
type Tab = (typeof TABS)[number]

const label = 'block text-[12px] font-medium text-fg-soft'
const field = 'field mt-1.5 block w-full'

function Choice<T extends string>({ value, options, onChange, name }: { value: T; name: string; options: [T, string, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {options.map(([v, title, hint]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-lg border px-3 py-2 text-left transition-colors',
            value === v ? 'border-accent bg-accent/[0.08]' : 'border-border hover:border-border-strong hover:bg-fg/[0.03]',
          )}
        >
          <span className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
            <span className={cn('h-3 w-3 shrink-0 rounded-full border', value === v ? 'border-[3.5px] border-accent' : 'border-border-strong')} aria-hidden />
            {title}
          </span>
          <span className="mt-0.5 block pl-5 text-[11.5px] leading-snug text-muted">{hint}</span>
        </button>
      ))}
    </div>
  )
}

/** Twelve monthly values in a compact grid. */
function MonthGrid({ values, onChange, label: what, placeholder }: { values: string[]; onChange: (v: string[]) => void; label: string; placeholder?: string }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 xl:grid-cols-12" role="group" aria-label={what}>
      {MONTHS.map((m, i) => (
        <label key={m} className="block">
          <span className="block text-center text-[10.5px] font-medium text-muted">{m}</span>
          <input
            className="field mt-0.5 h-8 w-full px-1 text-center text-[12px] tabular-nums"
            inputMode="decimal"
            aria-label={`${what}, ${m}`}
            placeholder={placeholder}
            value={values[i] ?? ''}
            onChange={(e) => onChange(values.map((x, k) => (k === i ? e.target.value : x)))}
          />
        </label>
      ))}
    </div>
  )
}

function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <p className={cn('m-0 flex items-start gap-1.5 text-[11.5px] leading-relaxed', tone === 'warn' ? 'text-warning' : 'text-muted')}>
      {tone === 'warn' && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  )
}

export function ClimatologyPanel({ id, className }: { id?: string; className?: string }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const sec = (name: string) => ({ queryKey: ['section', name], queryFn: () => api.getSection(name).catch(() => null) })
  const evapQ = useQuery(sec('EVAPORATION'))
  const tempQ = useQuery(sec('TEMPERATURE'))
  const adjQ = useQuery(sec('ADJUSTMENTS'))
  const tsQ = useQuery(sec('TIMESERIES'))
  const patQ = useQuery(sec('PATTERNS'))
  const opts = useQuery({ queryKey: ['sim-options'], queryFn: api.getSimOptions })

  const loaded = !evapQ.isLoading && !tempQ.isLoading && !adjQ.isLoading
  const original = useMemo(
    () => (loaded ? parseClimate(evapQ.data?.rows ?? [], tempQ.data?.rows ?? [], adjQ.data?.rows ?? []) : emptyClimate()),
    [loaded, evapQ.data, tempQ.data, adjQ.data],
  )
  const [c, setC] = useState<Climate>(original)
  useEffect(() => setC(original), [original])
  const [tab, setTab] = useState<Tab>('Evaporation')
  // Only when choosing a climate file (in the browser it starts the model tools).
  const files = useQuery({ queryKey: ['project-dat-files'], queryFn: () => api.listDatFiles().catch(() => []), retry: false, enabled: tab === 'Temperature' })
  const dirty = JSON.stringify(c) !== JSON.stringify(original)
  const problem = climateProblem(c)

  const flow = String(
    opts.data?.groups.flatMap((g) => g.options).find((o) => o.key === 'FLOW_UNITS')?.value || opts.data?.other.FLOW_UNITS || 'CFS',
  ).toUpperCase()
  const us = ['CFS', 'GPM', 'MGD'].includes(flow)
  const u = us
    ? { evap: 'in/day', temp: '°F', wind: 'mph', depth: 'in', elev: 'ft', melt: 'in/hr/°F', tempAdj: '± °F', evapAdj: '± in/day' }
    : { evap: 'mm/day', temp: '°C', wind: 'km/hr', depth: 'mm', elev: 'm', melt: 'mm/hr/°C', tempAdj: '± °C', evapAdj: '± mm/day' }

  const names = (rows?: { values: string[] }[] | null) => [...new Set((rows ?? []).map((r) => r.values[0]).filter(Boolean))]
  const tsNames = names(tsQ.data?.rows)
  const patterns = names(patQ.data?.rows)
  const fileNames = (files.data ?? []).map((f) => f.filename)

  const set = <K extends keyof Climate>(k: K, patch: Partial<Climate[K]>) => setC((p) => ({ ...p, [k]: { ...p[k], ...patch } }))

  const save = useMutation({
    mutationFn: async () => {
      const t = climateToText(c)
      await api.putSection('EVAPORATION', { text: t.EVAPORATION })
      if (t.TEMPERATURE != null || tempQ.data?.rows?.length) await api.putSection('TEMPERATURE', { text: t.TEMPERATURE ?? '' })
      if (t.ADJUSTMENTS != null || adjQ.data?.rows?.length) await api.putSection('ADJUSTMENTS', { text: t.ADJUSTMENTS ?? '' })
    },
    onSuccess: () => {
      for (const k of ['section', 'inp', 'model-check', 'project']) void qc.invalidateQueries({ queryKey: [k] })
      toast({ title: 'Climate settings saved', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save the climate settings', description: e.message, tone: 'danger' }),
  })

  const tsSelect = (value: string, onChange: (v: string) => void, what: string) => (
    <label className={label}>
      Time series
      <select className={field} value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${what} time series`}>
        <option value="">Choose…</option>
        {tsNames.map((n) => <option key={n} value={n}>{n}</option>)}
        {value && !tsNames.includes(value) && <option value={value}>{value} (not found)</option>}
      </select>
      {!tsNames.length && <span className="mt-1 block text-[11px] font-normal text-muted">The model has no time series yet. Add one under INP text → Time series.</span>}
    </label>
  )

  return (
    <Panel
      id={id}
      className={className}
      title={
        <span className="flex items-center gap-2">
          <CloudSun className="h-4 w-4 text-ic-rain" aria-hidden /> Climate and evaporation
        </span>
      }
    >
      <p className="-mt-1 mb-3 text-[11.5px] text-muted">
        Evaporation, temperature, wind, snowmelt and monthly adjustments: SWMM’s [EVAPORATION], [TEMPERATURE] and [ADJUSTMENTS].
      </p>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2" role="tablist" aria-label="Climate settings">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            type="button"
            onClick={() => setTab(t)}
            className={`h-7 rounded-md px-2.5 text-[12px] ${t === tab ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="m-0 text-[12px] text-muted">Loading…</p>
      ) : (
        <div className="space-y-4" role="tabpanel" aria-label={tab}>
          {tab === 'Evaporation' && (
            <>
              <Choice<EvapSource>
                name="Evaporation from"
                value={c.evap.source === 'NONE' ? 'CONSTANT' : c.evap.source}
                onChange={(source) => set('evap', { source })}
                options={[
                  ['CONSTANT', 'Constant rate', 'The same rate all year.'],
                  ['MONTHLY', 'Monthly averages', 'A rate for each month.'],
                  ['TIMESERIES', 'Time series', 'Daily rates from a time series.'],
                  ['TEMPERATURE', 'From temperatures', 'Hargreaves, from daily highs and lows and the latitude.'],
                  ['FILE', 'From the climate file', 'Daily pan evaporation, times monthly pan coefficients.'],
                ]}
              />
              {c.evap.source === 'CONSTANT' || c.evap.source === 'NONE' ? (
                <label className={cn(label, 'max-w-xs')}>
                  Evaporation rate ({u.evap})
                  <input className={field} inputMode="decimal" value={c.evap.constant} onChange={(e) => set('evap', { constant: e.target.value, source: 'CONSTANT' })} />
                </label>
              ) : c.evap.source === 'MONTHLY' ? (
                <div>
                  <span className={label}>Average rate ({u.evap})</span>
                  <div className="mt-1.5"><MonthGrid label="Monthly evaporation" values={c.evap.monthly} onChange={(monthly) => set('evap', { monthly })} /></div>
                </div>
              ) : c.evap.source === 'TIMESERIES' ? (
                <div className="max-w-xs">{tsSelect(c.evap.timeseries, (timeseries) => set('evap', { timeseries }), 'Evaporation')}</div>
              ) : c.evap.source === 'TEMPERATURE' ? (
                c.temp.source === 'NONE' ? (
                  <Note tone="warn">
                    This needs daily temperatures. Set them on the{' '}
                    <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setTab('Temperature')}>Temperature tab</button>, or download a record with temperatures on{' '}
                    <Link to="/storm?tab=continuous" className="font-medium underline-offset-2 hover:underline">Rainfall → Continuous record</Link>.
                  </Note>
                ) : (
                  <Note>Uses the daily temperatures set on the Temperature tab ({c.temp.source === 'FILE' ? c.temp.file : c.temp.timeseries}), and the latitude on the Snowmelt tab.</Note>
                )
              ) : (
                <div>
                  <span className={label}>Pan coefficients</span>
                  <div className="mt-1.5"><MonthGrid label="Pan coefficients" values={c.evap.pan} onChange={(pan) => set('evap', { pan })} /></div>
                  <div className="mt-2"><Note>The climate file is the one set on the Temperature tab.</Note></div>
                </div>
              )}
              <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-fg-soft">
                  <Switch checked={c.evap.dryOnly} onCheckedChange={(dryOnly) => set('evap', { dryOnly })} />
                  <span>
                    <span className="block font-medium text-fg">Only in dry periods</span>
                    <span className="block text-[11.5px] text-muted">No evaporation while it rains.</span>
                  </span>
                </label>
                <label className={label}>
                  Soil recovery pattern <span className="font-normal text-muted">(optional)</span>
                  <select className={field} value={c.evap.recovery} onChange={(e) => set('evap', { recovery: e.target.value })}>
                    <option value="">None</option>
                    {patterns.map((p) => <option key={p} value={p}>{p}</option>)}
                    {c.evap.recovery && !patterns.includes(c.evap.recovery) && <option value={c.evap.recovery}>{c.evap.recovery} (not found)</option>}
                  </select>
                  <span className="mt-1 block text-[11px] font-normal text-muted">A monthly pattern that scales how fast infiltration capacity recovers.</span>
                </label>
              </div>
            </>
          )}

          {tab === 'Temperature' && (
            <>
              <Choice<TempSource>
                name="Temperatures from"
                value={c.temp.source}
                onChange={(source) => set('temp', { source })}
                options={[
                  ['NONE', 'Not used', 'No snowmelt, and no evaporation from temperature.'],
                  ['TIMESERIES', 'Time series', 'Temperatures from a time series in the model.'],
                  ['FILE', 'Climate file', 'Daily highs and lows (and wind, pan evaporation) from a file.'],
                ]}
              />
              {c.temp.source === 'TIMESERIES' && <div className="max-w-xs">{tsSelect(c.temp.timeseries, (timeseries) => set('temp', { timeseries }), 'Temperature')}</div>}
              {c.temp.source === 'FILE' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={label}>
                    Climate file
                    <input className={field} list="climate-files" value={c.temp.file} placeholder="climate.dat" onChange={(e) => set('temp', { file: e.target.value })} />
                    <datalist id="climate-files">{fileNames.map((f) => <option key={f} value={f} />)}</datalist>
                  </label>
                  <label className={label}>
                    Start reading at <span className="font-normal text-muted">(optional)</span>
                    <input className={field} value={c.temp.fileStart} placeholder="MM/DD/YYYY" onChange={(e) => set('temp', { fileStart: e.target.value })} />
                  </label>
                </div>
              )}
              <div className="rounded-lg border border-border bg-fg/[0.02] px-3 py-2.5">
                <Note>
                  No temperature data? <Link to="/storm?tab=continuous" className="font-medium text-accent-soft underline-offset-2 hover:underline">Rainfall → Continuous record</Link> downloads hourly rain and daily temperatures for the model’s location and can set them here, with evaporation from temperature.
                </Note>
              </div>
            </>
          )}

          {tab === 'Wind speed' && (
            <>
              <Choice<'MONTHLY' | 'FILE'>
                name="Wind speed from"
                value={c.wind.source}
                onChange={(source) => set('wind', { source })}
                options={[
                  ['MONTHLY', 'Monthly averages', 'Used in snowmelt during rain.'],
                  ['FILE', 'Climate file', 'Daily wind speeds from the climate file.'],
                ]}
              />
              {c.wind.source === 'MONTHLY' && (
                <div>
                  <span className={label}>Average wind speed ({u.wind})</span>
                  <div className="mt-1.5"><MonthGrid label="Monthly wind speed" values={c.wind.monthly} onChange={(monthly) => set('wind', { monthly })} /></div>
                </div>
              )}
              <Note>Wind speed only matters for snowmelt, which needs temperatures.</Note>
            </>
          )}

          {tab === 'Snowmelt' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ['divide', `Rain or snow at (${u.temp})`, 'Below this air temperature, precipitation falls as snow.'],
                    ['atiWeight', 'ATI weight', 'Weight of the antecedent temperature index, 0 to 1.'],
                    ['negMelt', 'Negative melt ratio', 'Cold-period melt coefficient over the warm one, 0 to 1.'],
                    ['elevation', `Elevation (${u.elev})`, 'Average elevation of the study area, above sea level.'],
                    ['latitude', 'Latitude (degrees)', 'Of the study area; also used for evaporation from temperature.'],
                    ['longitudeCorrection', 'Longitude correction (minutes)', 'Difference between local and standard time.'],
                  ] as const
                ).map(([k, l, hint]) => (
                  <label key={k} className={label}>
                    {l}
                    <input className={field} inputMode="decimal" value={c.snow[k]} onChange={(e) => set('snow', { [k]: e.target.value })} />
                    <span className="mt-1 block text-[11px] font-normal text-muted">{hint}</span>
                  </label>
                ))}
              </div>
              {c.temp.source === 'NONE' && <Note tone="warn">Snowmelt is only computed with temperatures, set on the Temperature tab.</Note>}
            </>
          )}

          {tab === 'Areal depletion' && (
            <>
              <Note>The fraction of the area covered by snow at each depth, as a fraction of the depth at which cover is complete. 1 everywhere means no depletion.</Note>
              {(['impervious', 'pervious'] as const).map((k) => (
                <div key={k}>
                  <span className={label}>{k === 'impervious' ? 'Impervious area' : 'Pervious area'}</span>
                  <div className="mt-1.5 grid grid-cols-5 gap-1.5 sm:grid-cols-10" role="group" aria-label={`${k} areal depletion`}>
                    {c.adc[k].map((v, i) => (
                      <label key={i} className="block">
                        <span className="block text-center text-[10.5px] font-medium text-muted">{(i / 10).toFixed(1)}</span>
                        <input
                          className="field mt-0.5 h-8 w-full px-1 text-center text-[12px] tabular-nums"
                          inputMode="decimal"
                          aria-label={`${k} cover at depth fraction ${(i / 10).toFixed(1)}`}
                          value={v}
                          onChange={(e) => set('adc', { [k]: c.adc[k].map((x, j) => (j === i ? e.target.value : x)) })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'Monthly adjustments' && (
            <>
              <Note>
                Monthly changes to the climate the model reads, for example to test a future climate. Leave a row blank for none.{' '}
                <Link to="/storm?tab=climate" className="font-medium text-accent-soft underline-offset-2 hover:underline">Rainfall → Climate change</Link> fills them from EPA’s SWMM-CAT.
              </Note>
              {(
                [
                  ['temperature', `Temperature (${u.tempAdj})`, '0'],
                  ['evaporation', `Evaporation (${u.evapAdj})`, '0'],
                  ['rainfall', 'Rainfall (× factor)', '1'],
                  ['conductivity', 'Soil conductivity (× factor)', '1'],
                ] as const
              ).map(([k, l, ph]) => (
                <div key={k}>
                  <span className={label}>{l}</span>
                  <div className="mt-1.5"><MonthGrid label={l} placeholder={ph} values={c.adjust[k]} onChange={(v) => set('adjust', { [k]: v })} /></div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {problem && (
        <div className="mt-4">
          <Note tone="warn">{problem}</Note>
        </div>
      )}
      <div className="mt-4 flex gap-2 border-t border-border pt-3">
        <Button size="sm" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save climate settings'}
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setC(original)}>
          Discard
        </Button>
      </div>
    </Panel>
  )
}
