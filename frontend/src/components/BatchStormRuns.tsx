/**
 * Run the model once per return period: build each storm from NOAA depths,
 * point the rain gage at it, run, and keep the run (pinned, named "10-year
 * 24-hr") so Results → Compare runs can set them side by side.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { calculateHyetograph, minutesToSwmmInterval, toSwmmDatFile } from '../lib/storm'
import type { NoaaReturnPeriodData } from '../lib/storm'

type StormCategory = 'SCS' | 'NRCS' | 'Huff'
import { Button, Panel, useToast } from './ui'

type Props = {
  noaa: NoaaReturnPeriodData[] | null
  durationHr: number
  category: StormCategory
  subType: string
  timeStepMin: number
  depthUnits: 'us' | 'metric'
  startLocal: string
  gageName: string
  /** Climate uplift on depth, percent. */
  uplift?: number
}

type Step = { rp: number; state: 'waiting' | 'running' | 'done' | 'failed'; note?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function BatchStormRuns({ noaa, durationHr, category, subType, timeStepMin, depthUnits, startLocal, gageName, uplift = 0 }: Props) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const periods = noaa?.map((p) => p.returnPeriod) ?? []
  const [chosen, setChosen] = useState<number[]>([2, 10, 100])
  const [steps, setSteps] = useState<Step[]>([])
  const [busy, setBusy] = useState(false)
  const label = `${durationHr}-hr`
  const usable = chosen.filter((rp) => periods.includes(rp))

  const run = async () => {
    if (!noaa) return
    const gage = gageName.trim() || 'RG1'
    const start = new Date(startLocal)
    if (Number.isNaN(start.getTime())) {
      toast({ title: 'Set a storm start time first', tone: 'danger' })
      return
    }
    setBusy(true)
    setSteps(usable.map((rp) => ({ rp, state: 'waiting' })))
    const set = (rp: number, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.rp === rp ? { ...x, ...patch } : x)))
    try {
      await api.applyRaingageToAll(gage)
    } catch {
      /* the gage may not exist yet; it is created below */
    }
    for (const rp of usable) {
      set(rp, { state: 'running', note: 'Building storm' })
      try {
        const pt = noaa.find((p) => p.returnPeriod === rp)?.dataPoints.find((d) => d.durationLabel === label)
        if (!pt) throw new Error(`NOAA has no ${label} depth for ${rp} years`)
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
        if (!calc.detailedData.length) throw new Error('Could not build the storm')
        const file = `design_${rp}yr_${durationHr}hr.dat`
        await api.writeProjectFile(
          file,
          toSwmmDatFile(calc.detailedData, { start, stationId: gage, valueKind: 'depth', comment: `${rp}-year ${label} ${category} ${subType}, ${depth.toFixed(2)} ${calc.depthUnit}` }),
        )
        await api.upsertFileRaingage({ name: gage, filename: file, format: 'VOLUME', interval: minutesToSwmmInterval(timeStepMin), units: depthUnits === 'metric' ? 'MM' : 'IN' })
        await api.applyRaingageToAll(gage)
        const span = await api.getRainFileSpan(file)
        if (span.start_date && span.end_date && span.start_time && span.end_time) {
          await api.setSimulationWindow({ start_date: span.start_date, start_time: span.start_time, end_date: span.end_date, end_time: span.end_time, sync_report_start: true })
        }
        set(rp, { note: 'Running' })
        await api.startRun({})
        let st = await api.getRunStatus()
        for (let i = 0; i < 7200 && (st.status === 'running' || st.status === 'idle'); i++) {
          await sleep(1000)
          st = await api.getRunStatus()
          if (st.status === 'running') set(rp, { note: `Running ${Math.round(st.progress)}%` })
        }
        if (st.status !== 'completed') throw new Error(st.error?.split('\n')[0] || st.message || `Run ${st.status}`)
        // Name and keep the archived run.
        await sleep(800)
        const runs = (await api.listRuns()).runs
        const latest = [...runs].sort((a, b) => (b.finished ?? '').localeCompare(a.finished ?? ''))[0]
        if (latest) await api.updateRun(latest.id, { label: `${rp}-year ${label}${uplift ? ` +${uplift}%` : ''}`, pinned: true })
        set(rp, { state: 'done', note: undefined })
      } catch (e) {
        set(rp, { state: 'failed', note: (e as Error).message })
      }
    }
    setBusy(false)
    for (const k of ['runStatus', 'project', 'periods', 'out-periods', 'rpt-summary', 'runs-archive', 'simulation-window', 'inp', 'dat-files', 'raingages'])
      void qc.invalidateQueries({ queryKey: [k] })
    toast({ title: 'Storm set finished', description: 'Compare the runs under Results → Compare runs.', tone: 'success' })
  }

  return (
    <Panel title="Run a set of return periods">
      {!noaa ? (
        <p className="m-0 text-[12px] text-muted">Load NOAA depths for the location above to run several return periods in one go.</p>
      ) : (
        <>
          <p className="mb-2 mt-0 text-[12px] text-muted">
            Each return period gets its own {label} {category} {subType} storm{uplift ? ` (+${uplift} % climate uplift)` : ''} and run. Runs are kept and named so you can compare them.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {periods.map((rp) => (
              <label key={rp} className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[12px] ${chosen.includes(rp) ? 'border-accent/50 bg-accent/10 text-fg' : 'border-border text-fg-soft'}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={chosen.includes(rp)}
                  disabled={busy}
                  onChange={(e) => setChosen((c) => (e.target.checked ? [...c, rp].sort((a, b) => a - b) : c.filter((x) => x !== rp)))}
                />
                {rp}-yr
              </label>
            ))}
          </div>
          {steps.length > 0 && (
            <ul className="mb-3 mt-0 list-none space-y-1 p-0 text-[12px]">
              {steps.map((s) => (
                <li key={s.rp} className="flex gap-2">
                  <span className="w-14 font-medium text-fg">{s.rp}-year</span>
                  <span className={s.state === 'failed' ? 'text-danger' : s.state === 'done' ? 'text-success' : 'text-muted'}>
                    {s.state === 'done' ? 'Done' : s.state === 'failed' ? `Failed: ${s.note}` : s.note ?? 'Waiting'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={busy || !usable.length} onClick={() => void run()}>
              {busy ? 'Running the set…' : `Run ${usable.length} storm${usable.length === 1 ? '' : 's'}`}
            </Button>
            {steps.some((s) => s.state === 'done') && !busy && (
              <Link to="/results" className="text-[12px] text-accent-soft hover:underline">
                Compare the runs
              </Link>
            )}
          </div>
        </>
      )}
    </Panel>
  )
}
