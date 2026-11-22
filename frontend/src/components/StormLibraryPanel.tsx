/**
 * Add design storms to the project's storm library: the one on screen, or
 * one per return period from NOAA Atlas 14. Storms don't change the model;
 * every scenario can then be run under each of them (Runs page).
 */
import { useQueryClient } from '@tanstack/react-query'
import { CloudRain, LayoutGrid, Play } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { calculateHyetograph, minutesToSwmmInterval, toSwmmDatFile } from '../lib/storm'
import type { CalculationResult, NoaaReturnPeriodData } from '../lib/storm'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { Button, Panel, useToast } from './ui'

type StormCategory = 'SCS' | 'NRCS' | 'Huff'

type Props = {
  result: CalculationResult | null
  noaa: NoaaReturnPeriodData[] | null
  returnPeriod: number
  totalDepth: number
  durationHr: number
  category: StormCategory
  subType: string
  timeStepMin: number
  depthUnits: 'us' | 'metric'
  startLocal: string
  /** Climate uplift on depth, percent. */
  uplift: number
}

export function StormLibraryPanel({ result, noaa, returnPeriod, totalDepth, durationHr, category, subType, timeStepMin, depthUnits, startLocal, uplift }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const periods = noaa?.map((p) => p.returnPeriod) ?? []
  const fromNoaa = Boolean(noaa?.some((p) => p.returnPeriod === returnPeriod))
  const dur = `${durationHr}-hour`
  const tag = `${uplift ? ` +${uplift}%` : ''}`
  const defaultName = fromNoaa ? `${returnPeriod}-year ${dur}${tag}` : `${totalDepth} ${depthUnits === 'metric' ? 'mm' : 'in'} ${dur}${tag}`
  const [name, setName] = useState('')
  const [after, setAfter] = useState(12)
  const [chosen, setChosen] = useState<number[]>([2, 10, 100])
  const [busy, setBusy] = useState<string | null>(null)
  const units = depthUnits === 'metric' ? 'MM' : 'IN'

  const save = async (rp: number | null, steps: CalculationResult['detailedData'], depth: number, label: string) => {
    const start = new Date(startLocal)
    if (Number.isNaN(start.getTime())) throw new Error('Set a storm start time first')
    const text = toSwmmDatFile(steps, {
      start,
      stationId: 'STORM',
      valueKind: 'depth',
      comment: `${label}: ${category} ${subType}, ${depth.toFixed(2)} ${depthUnits === 'metric' ? 'mm' : 'in'}${uplift ? ` (includes +${uplift} % climate uplift)` : ''}`,
    })
    return api.createStorm({
      name: label,
      text,
      format: 'VOLUME',
      interval: minutesToSwmmInterval(timeStepMin),
      units,
      after_hours: after,
      kind: 'design',
      return_period: rp ?? undefined,
      duration_hr: durationHr,
      note: `${category} ${subType}${uplift ? `, +${uplift} % climate uplift` : ''}`,
    })
  }

  const addOne = async () => {
    if (!result?.detailedData.length) return
    setBusy('one')
    try {
      const s = await save(fromNoaa ? returnPeriod : null, result.detailedData, totalDepth * (1 + uplift / 100), name.trim() || defaultName)
      invalidateProjectQueries(qc)
      toast({ title: `Added “${s.name}” to the storms`, description: 'Pick it in the storm menu, or run every scenario under it on the Runs page.', tone: 'success' })
    } catch (e) {
      toast({ title: 'Couldn’t add the storm', description: (e as Error).message, tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const addSet = async (andRun: boolean) => {
    if (!noaa) return
    setBusy(andRun ? 'run' : 'set')
    const made: string[] = []
    try {
      for (const rp of chosen.filter((r) => periods.includes(r))) {
        const pt = noaa.find((p) => p.returnPeriod === rp)?.dataPoints.find((d) => d.durationLabel === `${durationHr}-hr`)
        if (!pt) throw new Error(`NOAA has no ${durationHr}-hour depth for ${rp} years`)
        const depth = (depthUnits === 'metric' ? pt.depth * 25.4 : pt.depth) * (1 + uplift / 100)
        const calc = calculateHyetograph({
          totalDepthInput: depth,
          durationInput: durationHr,
          stormCategory: category,
          stormSubType: subType,
          timeStepMinutes: timeStepMin,
          depthUnit: depthUnits,
          durationUnit: 'hours',
        })
        if (!calc.detailedData.length) throw new Error(`Couldn’t build the ${rp}-year storm`)
        made.push((await save(rp, calc.detailedData, depth, `${rp}-year ${dur}${tag}`)).id)
      }
      invalidateProjectQueries(qc)
      if (andRun) {
        const scen = await api.listScenarios()
        await api.startBatch(scen.scenarios.flatMap((s) => made.map((storm) => ({ scenario: s.id, storm }))))
        void qc.invalidateQueries({ queryKey: ['run-batch'] })
        navigate('/runs')
      } else {
        toast({ title: `Added ${made.length} storms`, description: 'Run every scenario under them on the Runs page.', tone: 'success' })
      }
    } catch (e) {
      toast({ title: 'Couldn’t add the storms', description: (e as Error).message, tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title={<span className="inline-flex items-center gap-2"><CloudRain className="h-4 w-4 text-ic-rain" />Add to storms</span>}>
      <p className="mb-3 mt-0 text-[12px] leading-relaxed text-muted">
        Storms are kept with the project, apart from the model. Each scenario can be run under each storm and keeps those results separately; running under a storm points the
        rain gages at it and fits the simulation window, without editing the model.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-[12px] font-medium text-fg-soft">
          Name
          <input className="field mt-1.5 block w-full" value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-[12px] font-medium text-fg-soft">
          Keep running after it
          <span className="mt-1.5 flex items-center gap-1.5">
            <input className="field w-20" type="number" min={0} max={240} value={after} onChange={(e) => setAfter(Math.max(0, Number(e.target.value) || 0))} />
            <span className="text-muted">hours</span>
          </span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={!result || Boolean(busy)} onClick={() => void addOne()} title={result ? undefined : 'Build a storm first'}>
          {busy === 'one' ? 'Adding…' : 'Add this storm'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/runs')}>
          <LayoutGrid className="h-3.5 w-3.5" /> Runs
        </Button>
      </div>

      {periods.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-[12px] font-medium text-fg-soft">
            A {dur} {category} {subType} storm for each return period{uplift ? `, +${uplift} %` : ''}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Return periods">
            {periods.map((rp) => {
              const on = chosen.includes(rp)
              return (
                <button
                  key={rp}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChosen((c) => (on ? c.filter((x) => x !== rp) : [...c, rp].sort((a, b) => a - b)))}
                  className={`h-7 rounded-full border px-2.5 text-[12px] ${on ? 'border-accent bg-accent/15 font-medium text-accent-soft' : 'border-border text-muted hover:text-fg'}`}
                >
                  {rp}-yr
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" disabled={!chosen.length || Boolean(busy)} onClick={() => void addSet(false)}>
              {busy === 'set' ? 'Adding…' : `Add ${chosen.length} storms`}
            </Button>
            <Button variant="outline" disabled={!chosen.length || Boolean(busy)} onClick={() => void addSet(true)}>
              <Play className="h-3.5 w-3.5" /> {busy === 'run' ? 'Starting…' : 'Add and run every scenario'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-0 mt-3 text-[12px] text-muted">Look up NOAA Atlas 14 depths above to add a whole set of return periods at once.</p>
      )}
    </Panel>
  )
}
