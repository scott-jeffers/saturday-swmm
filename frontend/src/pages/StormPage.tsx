import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client'
import { ensureCrs, projectToWgs84 } from '../lib/projection'
import { StormLibraryPanel } from '../components/StormLibraryPanel'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { ClimatePanel, type AdjustmentRow } from '../components/storm/ClimatePanel'
import { LocationPicker } from '../components/storm/LocationPicker'
import { Button, PageHeader, Panel, Switch, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '../components/ui'
import { RainGageList, type GageInfo, type GageSave } from '../components/storm/RainGageList'
import { SaveToModel } from '../components/storm/SaveToModel'
import {
  buildClimateDatBody,
  calculateHyetograph,
  defaultSimulationYear,
  hourlyToStormSteps,
  listStormSubTypes,
  minutesToSwmmInterval,
  parseNoaaPfds,
  parseOpenMeteoResponse,
  parseSwmmDatFile,
  resolveDateRange,
  suggestedOpenMeteoFilename,
  swmmDatToChartData,
  toSwmmDatFile,
  type CalculationResult,
  type NoaaReturnPeriodData,
  type OpenMeteoHourlyJson,
  type ParsedOpenMeteoClimate,
} from '../lib/storm'

type StormCategory = 'SCS' | 'NRCS' | 'Huff'

/** A SWMM interval ("0:05", or hours as "0.25") in minutes. */
const toMinutesOf = (iv: string) =>
  iv.includes(':') ? iv.split(':').map(Number).reduce((a, b, k) => a + (b || 0) * 60 ** (1 - k), 0) : Number(iv) * 60

export function StormPage({ projectPath }: { projectPath: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // ?tab=continuous|climate opens that tab (links from Simulation options → Climate).
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tabParam = searchParams.get('tab')
  const [stormMode, setStormMode] = useState<'design' | 'continuous' | 'climate'>(() =>
    tabParam === 'continuous' || tabParam === 'climate' ? tabParam : 'design',
  )
  useEffect(() => {
    if (tabParam === 'continuous' || tabParam === 'climate' || tabParam === 'design') setStormMode(tabParam)
  }, [tabParam])

  const [lat, setLat] = useState(39.0)
  const [lon, setLon] = useState(-77.0)
  // Start at the model's own location: NOAA depths for the wrong place are a
  // silent design error, so never default to a fixed city.
  const locatedRef = useRef(false)
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const stormNetwork = useQuery({
    queryKey: ['network', projectPath, project.data?.crs ?? ''],
    queryFn: () => api.getNetwork(project.data?.crs ?? undefined),
    enabled: Boolean(project.data?.crs),
  })
  useEffect(() => {
    if (locatedRef.current) return
    const crs = project.data?.crs
    const b = stormNetwork.data?.bounds
    // A guessed coordinate system can put the model on another continent.
    if (project.data && !project.data.crs_confirmed) return
    if (!crs || !b || !Number.isFinite(b.minx) || !Number.isFinite(b.maxx)) return
    try {
      ensureCrs(crs, project.data?.crs_proj4)
      const [lng, la] = projectToWgs84((b.minx + b.maxx) / 2, (b.miny + b.maxy) / 2, crs)
      if (Number.isFinite(lng) && Number.isFinite(la) && Math.abs(la) <= 90 && Math.abs(lng) <= 180) {
        locatedRef.current = true
        setLat(Number(la.toFixed(5)))
        setLon(Number(lng.toFixed(5)))
      }
    } catch {
      /* unknown CRS: keep the default and let the user move the pin */
    }
  }, [project.data, project.data?.crs, project.data?.crs_proj4, stormNetwork.data?.bounds])
  const [noaaLoading, setNoaaLoading] = useState(false)
  const [noaaError, setNoaaError] = useState<string | null>(null)
  const [noaaData, setNoaaData] = useState<NoaaReturnPeriodData[] | null>(null)
  const [noaaSeries, setNoaaSeries] = useState<'pds' | 'ams'>('pds')
  const [returnPeriod, setReturnPeriod] = useState(10)

  const [category, setCategory] = useState<StormCategory>('SCS')
  const subTypes = listStormSubTypes[category]
  const [subType, setSubType] = useState(subTypes[0] ?? 'Type II')
  const [durationHr, setDurationHr] = useState(24)
  const [timeStepMin, setTimeStepMin] = useState(5)
  const [depthUnits, setDepthUnits] = useState<'us' | 'metric'>('us')
  const [totalDepth, setTotalDepth] = useState(3.0)
  /** Climate change uplift on rainfall depth, in percent. */
  const [uplift, setUplift] = useState(0)
  const [startLocal, setStartLocal] = useState('2024-01-01T00:00')

  const [filename, setFilename] = useState('design_storm.dat')
  const [gageName, setGageName] = useState('RG1')
  const [applyAll, setApplyAll] = useState(true)
  const [syncTimes, setSyncTimes] = useState(true)
  const [result, setResult] = useState<CalculationResult | null>(null)
  const [previewName, setPreviewName] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [previewChart, setPreviewChart] = useState<
    { timeHr: number; value: number; label: string }[]
  >([])
  const [previewStats, setPreviewStats] = useState<{
    records: number
    peak: number
    station: string | null
    unit?: string
  } | null>(null)

  // Continuous / Open-Meteo
  const [periodMode, setPeriodMode] = useState<'year' | 'custom' | 'forecast'>('year')
  const [climateYear, setClimateYear] = useState(defaultSimulationYear())
  const [customStart, setCustomStart] = useState(`${defaultSimulationYear()}-01-01`)
  const [customEnd, setCustomEnd] = useState(`${defaultSimulationYear()}-12-31`)
  const [climateLoading, setClimateLoading] = useState(false)
  const [climateError, setClimateError] = useState<string | null>(null)
  const [climate, setClimate] = useState<ParsedOpenMeteoClimate | null>(null)
  const [contUnits, setContUnits] = useState<'us' | 'metric'>('metric')
  const [contFilename, setContFilename] = useState(
    `openmeteo_${defaultSimulationYear()}.dat`,
  )
  const [contGageName, setContGageName] = useState('OpenMeteo')
  const [contDryOnly, setContDryOnly] = useState(true)
  const [contUseTemp, setContUseTemp] = useState(true)
  const [contApplyAll, setContApplyAll] = useState(true)

  const ensureProjectOpen = async () => {
    await api.openProject(projectPath)
  }

  const simOptions = useQuery({ queryKey: ['sim-options', projectPath], queryFn: api.getSimOptions })
  // The storm starts when the model does, so a saved storm falls inside the
  // simulation window without a second step (until you pick a start yourself).
  const startTouched = useRef(false)
  useEffect(() => {
    if (startTouched.current || !simOptions.data) return
    const opt = (k: string) => simOptions.data!.groups.flatMap((g) => g.options).find((o) => o.key === k)?.value || simOptions.data!.other[k]
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(opt('START_DATE') ?? '').trim())
    if (!m) return
    const t = /^(\d{1,2}):(\d{2})/.exec(String(opt('START_TIME') ?? '0:00').trim())
    const pad = (n: string | number) => String(n).padStart(2, '0')
    setStartLocal(`${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}T${pad(t?.[1] ?? 0)}:${pad(t?.[2] ?? 0)}`)
  }, [simOptions.data])
  const flowUnits =
    simOptions.data?.groups.flatMap((g) => g.options).find((o) => o.key === 'FLOW_UNITS')?.value ||
    simOptions.data?.other.FLOW_UNITS ||
    'CFS'

  // SWMM-CAT: replace the TEMPERATURE / EVAPORATION / RAINFALL rows of
  // [ADJUSTMENTS], keeping any others (conductivity, pattern rows).
  const applyAdjustments = async (rows: AdjustmentRow[], summary: string) => {
    try {
      await ensureProjectOpen()
      const sec = await api.getSection('ADJUSTMENTS').catch(() => null)
      const kinds = new Set(rows.map((r) => r.kind))
      const kept = (sec?.rows ?? []).filter((r) => !kinds.has((r.values[0] ?? '').toUpperCase() as AdjustmentRow['kind']))
      await api.putSection('ADJUSTMENTS', {
        rows: [
          ...kept,
          ...rows.map((r, i) => ({
            values: [r.kind, ...r.values.map(String)],
            comment: i === 0 ? `SWMM-CAT ${summary}` : '',
          })),
        ],
      })
      for (const k of ['network', 'object', 'inp', 'project', 'model-check']) void queryClient.invalidateQueries({ queryKey: [k] })
      toast({ tone: 'success', title: 'Climate adjustments written', description: `${rows.map((r) => r.kind.toLowerCase()).join(', ')} · ${summary}` })
    } catch (e) {
      toast({ title: 'Could not write adjustments', description: e instanceof ApiError || e instanceof Error ? e.message : String(e), tone: 'danger' })
    }
  }

  const datFiles = useQuery({
    queryKey: ['project-dat-files', projectPath],
    queryFn: async () => {
      await ensureProjectOpen()
      return api.listDatFiles()
    },
    enabled: Boolean(projectPath),
    retry: false,
  })

  const raingages = useQuery({
    queryKey: ['raingages', projectPath],
    queryFn: async () => {
      await ensureProjectOpen()
      return api.listRaingages()
    },
    enabled: Boolean(projectPath),
    retry: false,
  })
  const gageNames = useMemo(() => (raingages.data ?? []).map((g) => g.name), [raingages.data])
  const timeseriesSection = useQuery({
    queryKey: ['section', 'TIMESERIES', projectPath],
    queryFn: async () => {
      await ensureProjectOpen()
      return api.getSection('TIMESERIES').catch(() => null)
    },
    enabled: Boolean(projectPath),
    retry: false,
  })
  const timeseriesNames = useMemo(() => {
    const names = new Set<string>()
    for (const r of timeseriesSection.data?.rows ?? []) if (r.values[0]) names.add(r.values[0])
    return [...names]
  }, [timeseriesSection.data])
  const saveGageMutation = useMutation({
    mutationFn: async ({ name, body }: { name: string; body: GageSave }) => {
      await ensureProjectOpen()
      return api.saveRaingage(name, body)
    },
    onSuccess: (res, { name, body }) => {
      refreshStormLists()
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      if (res.created) toast({ title: `Added rain gage ${res.name}`, description: `Reading ${body.source === 'FILE' ? body.filename : body.timeseries}. Choose which subcatchments use it.`, tone: 'success' })
      else if (res.name !== name) toast({ title: `Renamed ${name} to ${res.name}`, description: res.subcatchments_renamed ? `${res.subcatchments_renamed} subcatchment${res.subcatchments_renamed === 1 ? '' : 's'} updated to match.` : undefined, tone: 'success' })
    },
    onError: (err) => toast({ title: 'Couldn’t save the rain gage', description: (err as Error).message, tone: 'danger' }),
  })

  const refreshStormLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['project-dat-files'] })
    void queryClient.invalidateQueries({ queryKey: ['raingages'] })
    void queryClient.invalidateQueries({ queryKey: ['project'] })
    void queryClient.invalidateQueries({ queryKey: ['inp'] })
    void queryClient.invalidateQueries({ queryKey: ['network'] })
  }

  useEffect(() => {
    const next = listStormSubTypes[category]
    setSubType((prev) => (next.includes(prev) ? prev : next[0] ?? ''))
    if (category !== 'SCS') setDurationHr(24)
  }, [category])

  useEffect(() => {
    void ensureProjectOpen().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  const fetchNoaa = async () => {
    setNoaaLoading(true)
    setNoaaError(null)
    try {
      const csv = await api.getNoaaPfds(lat, lon, noaaSeries)
      const parsed = parseNoaaPfds(csv)
      if (!parsed?.length) {
        setNoaaData(null)
        setNoaaError('Could not parse NOAA response for this location.')
        return
      }
      setNoaaData(parsed)
      if (!parsed.some((p) => p.returnPeriod === returnPeriod)) {
        setReturnPeriod(parsed[0].returnPeriod)
      }
    } catch (err) {
      setNoaaData(null)
      setNoaaError((err as Error).message)
      toast({
        title: 'NOAA fetch failed',
        description: (err as Error).message,
        tone: 'danger',
      })
    } finally {
      setNoaaLoading(false)
    }
  }

  const selectedRp = useMemo(
    () => noaaData?.find((p) => p.returnPeriod === returnPeriod) ?? null,
    [noaaData, returnPeriod],
  )

  const applyNoaaDepth = (durationLabel: string) => {
    const pt = selectedRp?.dataPoints.find((d) => d.durationLabel === durationLabel)
    if (!pt) return
    let depth = pt.depth // inches from NOAA
    if (depthUnits === 'metric') depth = depth * 25.4
    setTotalDepth(Number(depth.toFixed(4)))
    if (pt.durationUnits === 'hours' && [6, 12, 24].includes(pt.durationValue)) {
      setDurationHr(pt.durationValue)
    } else if (durationLabel === '24-hr') {
      setDurationHr(24)
    } else if (durationLabel === '12-hr') {
      setDurationHr(12)
    } else if (durationLabel === '6-hr') {
      setDurationHr(6)
    }
    toast({
      title: 'Depth applied',
      description: `${returnPeriod}-yr ${durationLabel}`,
      tone: 'success',
    })
  }


  // The hyetograph follows the parameters as they change.
  useEffect(() => {
    const calc = calculateHyetograph({
      totalDepthInput: totalDepth * (1 + uplift / 100),
      durationInput: durationHr,
      stormCategory: category,
      stormSubType: subType,
      timeStepMinutes: timeStepMin,
      depthUnit: depthUnits,
      durationUnit: 'hours',
    })
    setResult(calc.detailedData.length ? calc : null)
  }, [totalDepth, uplift, durationHr, category, subType, timeStepMin, depthUnits])

  // NOAA depths follow the pin: fetch shortly after the location stops changing.
  const pinMoved = useRef(false)
  useEffect(() => {
    if (!pinMoved.current) return
    const t = window.setTimeout(() => void fetchNoaa(), 700)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon])

  const chartData = useMemo(
    () =>
      result?.detailedData.map((s) => ({
        timeHr: Number((s.timeStart / 60).toFixed(3)),
        intensity: Number(s.intensity.toFixed(4)),
      })) ?? [],
    [result],
  )

  const syncWindowTo = async (name: string) => {
    const span = await api.getRainFileSpan(name)
    if (!span.start_date || !span.end_date || !span.start_time || !span.end_time) {
      throw new Error('Could not read start/end times from rain file')
    }
    return api.setSimulationWindow({
      start_date: span.start_date,
      start_time: span.start_time,
      end_date: span.end_date,
      end_time: span.end_time,
      sync_report_start: true,
    })
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!result?.detailedData.length) throw new Error('Calculate a hyetograph first')
      const start = new Date(startLocal)
      if (Number.isNaN(start.getTime())) throw new Error('Invalid storm start date/time')
      await ensureProjectOpen()
      const name = filename.trim().endsWith('.dat')
        ? filename.trim()
        : `${filename.trim()}.dat`
      const content = toSwmmDatFile(result.detailedData, {
        start,
        stationId: gageName.trim() || 'RG1',
        // OpenSWMM under-reads INTENSITY FILE rain; VOLUME (depth/interval) is correct.
        valueKind: 'depth',
        comment: `Design storm ${category} ${subType} ${durationHr}hr · ${(totalDepth * (1 + uplift / 100)).toFixed(3)} ${result.depthUnit}${uplift ? ` (includes +${uplift} % climate uplift)` : ''}`,
      })
      await api.writeProjectFile(name, content)
      await api.upsertFileRaingage({
        name: gageName.trim() || 'RG1',
        filename: name,
        format: 'VOLUME',
        interval: minutesToSwmmInterval(timeStepMin),
        units: depthUnits === 'metric' ? 'MM' : 'IN',
      })
      const gage = gageName.trim() || 'RG1'
      const applied = applyAll ? (await api.applyRaingageToAll(gage)).updated : null
      if (syncTimes) await syncWindowTo(name)
      return { name, gage, applied }
    },
    onSuccess: ({ name, gage, applied }) => {
      refreshStormLists()
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      void queryClient.invalidateQueries({ queryKey: ['sim-options'] })
      const bits = [`${gage} reads ${name}`]
      if (applied != null) bits.push(`used by ${applied} subcatchment${applied === 1 ? '' : 's'}`)
      if (syncTimes) bits.push('simulation dates matched')
      toast({ title: 'Saved the storm to the model', description: bits.join(', ') + '.', tone: 'success' })
    },
    onError: (err) =>
      toast({
        title: 'Save failed',
        description: err instanceof ApiError ? err.message : (err as Error).message,
        tone: 'danger',
      }),
  })

  const applyAllMutation = useMutation({
    mutationFn: async (name: string) => {
      await ensureProjectOpen()
      return api.applyRaingageToAll(name)
    },
    onSuccess: (res) => {
      refreshStormLists()
      toast({
        title: 'Raingage applied',
        description: `Set ${res.raingage} on ${res.updated} subcatchment(s)`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Apply failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const snapToMeshMutation = useMutation({
    mutationFn: async (name: string) => {
      await ensureProjectOpen()
      return api.snapRaingageToMesh(name)
    },
    onSuccess: (res) => {
      refreshStormLists()
      const fix = res.rain_fix
      const fixNote =
        fix?.converted
          ? ` · converted rain FILE to VOLUME (${fix.records ?? 0} records)`
          : ''
      const removed =
        res.removed_orphan_symbols.length > 0
          ? ` · removed orphan symbols ${res.removed_orphan_symbols.join(', ')}`
          : ''
      toast({
        title: 'Raingage snapped to 2D mesh',
        description: `${res.raingage} @ (${res.x.toFixed(1)}, ${res.y.toFixed(1)})${fixNote}${removed}`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Snap to mesh failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const syncWindowMutation = useMutation({
    mutationFn: async (name: string) => {
      await ensureProjectOpen()
      return syncWindowTo(name)
    },
    onSuccess: (win, name) => {
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      toast({
        title: 'Simulation window updated',
        description: `${name}: ${win.start} → ${win.end}`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Could not set times',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  useEffect(() => {
    if (periodMode === 'year') {
      setContFilename(`openmeteo_${climateYear}.dat`)
    }
  }, [climateYear, periodMode])

  const climateDateOpts = useMemo(
    () =>
      periodMode === 'year'
        ? { year: climateYear }
        : { startDate: customStart, endDate: customEnd },
    [periodMode, climateYear, customStart, customEnd],
  )

  const climateChartData = useMemo(() => {
    if (!climate) return []
    const n = climate.times.length
    const stride = Math.max(1, Math.ceil(n / 1500))
    const out: { timeHr: number; precip: number; temp: number; label: string }[] = []
    const t0 = climate.firstTime.getTime()
    for (let i = 0; i < n; i += stride) {
      const mm = climate.precipitationMm[i]!
      const c = climate.temperatureCelsius[i]!
      const precip = contUnits === 'us' ? mm / 25.4 : mm
      const temp = contUnits === 'us' ? (c * 9) / 5 + 32 : c
      const iso = climate.times[i]!
      const t = new Date(iso.includes('T') ? iso : `${iso}T00:00`)
      out.push({
        timeHr: Number(((t.getTime() - t0) / 3_600_000).toFixed(2)),
        precip: Number(precip.toFixed(4)),
        temp: Number(temp.toFixed(2)),
        label: iso,
      })
    }
    return out
  }, [climate, contUnits])

  const loadClimate = async () => {
    setClimateLoading(true)
    setClimateError(null)
    try {
      if (periodMode === 'forecast') {
        const raw = await api.fetchOpenMeteoForecast({ lat, lon })
        const meta = (raw as { _saturday_swmm?: { start_date: string; end_date: string } })._saturday_swmm
        const opts = { startDate: meta?.start_date ?? '', endDate: meta?.end_date ?? '' }
        const parsed = parseOpenMeteoResponse(raw as OpenMeteoHourlyJson, opts)
        setClimate(parsed)
        setContFilename(`openmeteo_forecast_${opts.startDate}.dat`)
        toast({ title: 'Forecast loaded', description: `${parsed.times.length} hours · ${parsed.totalPrecipMm.toFixed(1)} mm forecast`, tone: 'success' })
        return
      }
      const range = resolveDateRange(climateDateOpts)
      const raw = await api.fetchOpenMeteoArchive({
        lat,
        lon,
        ...(periodMode === 'year'
          ? { year: climateYear }
          : { startDate: customStart, endDate: customEnd }),
      })
      const parsed = parseOpenMeteoResponse(raw as OpenMeteoHourlyJson, climateDateOpts)
      setClimate(parsed)
      setContFilename(suggestedOpenMeteoFilename(range))
      toast({
        title: 'Climate loaded',
        description: `${parsed.times.length.toLocaleString()} hours · ${parsed.totalPrecipMm.toFixed(1)} mm total`,
        tone: 'success',
      })
    } catch (err) {
      setClimate(null)
      setClimateError((err as Error).message)
      toast({
        title: 'Open-Meteo fetch failed',
        description: (err as Error).message,
        tone: 'danger',
      })
    } finally {
      setClimateLoading(false)
    }
  }

  const saveContinuousMutation = useMutation({
    mutationFn: async () => {
      if (!climate) throw new Error('Load climate first')
      await ensureProjectOpen()
      const rainName = contFilename.trim().endsWith('.dat')
        ? contFilename.trim()
        : `${contFilename.trim()}.dat`
      const gage = contGageName.trim() || 'OpenMeteo'
      const steps = hourlyToStormSteps(climate, contUnits)
      const rainContent = toSwmmDatFile(steps, {
        start: climate.firstTime,
        stationId: gage,
        valueKind: 'depth',
        comment: `Open-Meteo ERA5-Land continuous · ${climate.range.labelStart} → ${climate.range.labelEnd} · lat ${lat} lon ${lon}`,
      })
      await api.writeProjectFile(rainName, rainContent)
      await api.upsertFileRaingage({
        name: gage,
        filename: rainName,
        format: 'VOLUME',
        interval: '1:00',
        units: contUnits === 'metric' ? 'MM' : 'IN',
      })
      if (contUseTemp) {
        const climateBody = buildClimateDatBody(climate.dailyTemperatureByDate, contUnits)
        await api.writeProjectFile('climate.dat', climateBody)
        await api.applyClimateTemperature({ filename: 'climate.dat', dry_only: contDryOnly, latitude: lat })
      }
      const span = await api.getRainFileSpan(rainName)
      if (span.start_date && span.end_date && span.start_time && span.end_time) {
        await api.setSimulationWindow({
          start_date: span.start_date,
          start_time: span.start_time,
          end_date: span.end_date,
          end_time: span.end_time,
          sync_report_start: true,
        })
      }
      const applied = contApplyAll ? (await api.applyRaingageToAll(gage)).updated : null
      return { rainName, gage, applied }
    },
    onSuccess: ({ rainName, gage, applied }) => {
      refreshStormLists()
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      void queryClient.invalidateQueries({ queryKey: ['sim-options'] })
      const bits = [`${gage} reads ${rainName}`, ...(contUseTemp ? ['evaporation from its temperatures'] : [])]
      if (applied != null) bits.push(`used by ${applied} subcatchment${applied === 1 ? '' : 's'}`)
      bits.push('simulation dates matched')
      toast({ title: 'Saved the record to the model', description: bits.join(', ') + '.', tone: 'success' })
    },
    onError: (err) =>
      toast({
        title: 'Save failed',
        description: err instanceof ApiError ? err.message : (err as Error).message,
        tone: 'danger',
      }),
  })

  /** The record's daily temperatures → climate.dat, read by [TEMPERATURE], with evaporation from temperature. */
  const applyTempMutation = useMutation({
    mutationFn: async () => {
      if (!climate) throw new Error('Load a record first')
      await ensureProjectOpen()
      await api.writeProjectFile('climate.dat', buildClimateDatBody(climate.dailyTemperatureByDate, contUnits))
      return api.applyClimateTemperature({ filename: 'climate.dat', dry_only: contDryOnly, latitude: lat })
    },
    onSuccess: () => {
      for (const k of ['section', 'inp', 'project-dat-files', 'model-check']) void queryClient.invalidateQueries({ queryKey: [k] })
      toast({
        title: 'Temperatures set for evaporation',
        description: `climate.dat holds the record’s daily highs and lows; evaporation is computed from them${contDryOnly ? ', in dry periods only' : ''}.`,
        tone: 'success',
        action: { label: 'Open settings', onClick: () => navigate('/settings#s-climate') },
      })
    },
    onError: (err) => toast({ title: 'Couldn’t set the temperatures', description: (err as Error).message, tone: 'danger' }),
  })

  const addRecordStorm = useMutation({
    mutationFn: async () => {
      if (!climate) throw new Error('Load climate first')
      await ensureProjectOpen()
      const steps = hourlyToStormSteps(climate, contUnits)
      const text = toSwmmDatFile(steps, {
        start: climate.firstTime,
        stationId: 'STORM',
        valueKind: 'depth',
        comment: `Open-Meteo ERA5-Land · ${climate.range.labelStart} → ${climate.range.labelEnd} · lat ${lat} lon ${lon}`,
      })
      return api.createStorm({
        name: `Record ${climate.range.labelStart} to ${climate.range.labelEnd}`,
        text,
        format: 'VOLUME',
        interval: '1:00',
        units: contUnits === 'metric' ? 'MM' : 'IN',
        after_hours: 0,
        kind: 'record',
        note: `Open-Meteo ERA5-Land at ${lat}, ${lon}`,
      })
    },
    onSuccess: (s) => {
      invalidateProjectQueries(queryClient)
      toast({ title: `Added “${s.name}” to the storms`, description: 'Pick it in the storm menu, or run scenarios under it on the Runs page.', tone: 'success' })
    },
    onError: (err) => toast({ title: 'Couldn’t add the record', description: (err as Error).message, tone: 'danger' }),
  })

  const clearPreview = () => {
    setPreviewName(null)
    setPreviewText(null)
    setPreviewChart([])
    setPreviewStats(null)
  }

  const deleteDatMutation = useMutation({
    mutationFn: async (name: string) => {
      await ensureProjectOpen()
      return api.deleteProjectFile(name)
    },
    onSuccess: (_info, name) => {
      if (previewName === name) clearPreview()
      refreshStormLists()
      toast({ title: 'Deleted file', description: name, tone: 'success' })
    },
    onError: (err) =>
      toast({
        title: 'Delete failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const deleteGageMutation = useMutation({
    mutationFn: async (name: string) => {
      await ensureProjectOpen()
      return api.deleteRaingage(name)
    },
    onSuccess: (_res, name) => {
      refreshStormLists()
      toast({ title: 'Removed raingage', description: name, tone: 'success' })
    },
    onError: (err) =>
      toast({
        title: 'Remove failed',
        description: (err as Error).message,
        tone: 'danger',
      }),
  })

  const viewDat = async (name: string) => {
    try {
      await ensureProjectOpen()
      const file = await api.readProjectFile(name)
      const content = file.content
      setPreviewName(file.filename)
      setPreviewText(
        file.truncated
          ? `${content}\n\n… truncated (${file.size_bytes} bytes total)`
          : content,
      )
      const parsed = parseSwmmDatFile(content)
      const gage = (raingages.data ?? []).find(
        (g) => g.filename && g.filename.replace(/^.*[\\/]/, '') === name,
      )
      const isVolume = (gage?.format ?? '').toUpperCase() === 'VOLUME'
      const intervalTok = gage?.interval ?? '0:05'
      const parts = intervalTok.split(':').map(Number)
      let intervalMin = 5
      if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
        intervalMin = parts[0] * 60 + parts[1]
      } else if (parts.length === 1 && Number.isFinite(parts[0])) {
        intervalMin = parts[0]
      }
      const dtHr = Math.max(intervalMin, 1e-6) / 60
      const series = isVolume
        ? parsed.records.map((r) => ({
            ...r,
            value: r.value / dtHr,
          }))
        : parsed.records
      const chart = swmmDatToChartData(series)
      setPreviewChart(chart)
      if (series.length) {
        let peak = series[0].value
        for (const r of series) {
          if (r.value > peak) peak = r.value
        }
        setPreviewStats({
          records: series.length,
          peak,
          station: parsed.stationId,
          unit: `${(gage?.units ?? 'IN').toLowerCase()}/hr`,
        })
      } else {
        setPreviewStats(null)
      }
    } catch (err) {
      toast({
        title: 'Could not read file',
        description: (err as Error).message,
        tone: 'danger',
      })
    }
  }

  /** Rain a gage reads from a [TIMESERIES] in the model, as a rate. */
  const viewTimeseries = (name: string, gage: GageInfo) => {
    const rows = (timeseriesSection.data?.rows ?? []).filter((r) => r.values[0] === name)
    const pts: { t: number; v: number; date: string }[] = []
    let date = ''
    for (const r of rows) {
      const toks = r.values.slice(1).filter(Boolean)
      if (toks[0]?.toUpperCase() === 'FILE') continue
      for (let i = 0; i < toks.length; ) {
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(toks[i])) {
          date = toks[i++]
          continue
        }
        const tok = toks[i]
        const hr = tok.includes(':') ? tok.split(':').map(Number).reduce((a, b, k) => a + b / 60 ** k, 0) : Number(tok)
        const v = Number(toks[i + 1])
        i += 2
        const day = date ? new Date(date).getTime() : 0
        if (Number.isFinite(hr) && Number.isFinite(v)) pts.push({ t: (Number.isFinite(day) ? day : 0) / 3_600_000 + hr, v, date })
      }
    }
    const fmt = gage.format.toUpperCase()
    const dtHr = Math.max(toMinutesOf(gage.interval), 1e-6) / 60
    const t0 = pts[0]?.t ?? 0
    const chart = pts.map((p, i) => {
      let v = p.v
      if (fmt === 'VOLUME') v = p.v / dtHr
      if (fmt === 'CUMULATIVE') v = i ? Math.max(0, p.v - pts[i - 1].v) / dtHr : 0
      const h = p.t - t0
      return { timeHr: Number(h.toFixed(4)), value: Number(v.toFixed(6)), label: `${h.toFixed(2)} h` }
    })
    setPreviewName(name)
    setPreviewText(null)
    setPreviewChart(chart)
    setPreviewStats(chart.length ? { records: chart.length, peak: Math.max(...chart.map((c) => c.value)), station: null, unit: ['CFS', 'GPM', 'MGD'].includes(String(flowUnits).toUpperCase()) ? 'in/hr' : 'mm/hr' } : null)
  }

  const durationOptions = category === 'SCS' ? [6, 12, 24] : [24]
  const yearOptions = useMemo(() => {
    const y = new Date().getFullYear() - 1
    return Array.from({ length: 15 }, (_, i) => y - i)
  }, [])

  const locationBlock = (
    <>
      <LocationPicker
        lat={lat}
        lon={lon}
        onChange={(la, lo) => {
          pinMoved.current = true
          setLat(Number(la.toFixed(5)))
          setLon(Number(lo.toFixed(5)))
        }}
      />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block text-[12px] font-medium text-fg-soft">
          Lat
          <input
            type="number"
            step="0.0001"
            className="field mt-1.5 block w-28"
            value={lat}
            onChange={(e) => {
              pinMoved.current = true
              setLat(Number(e.target.value))
            }}
          />
        </label>
        <label className="block text-[12px] font-medium text-fg-soft">
          Lon
          <input
            type="number"
            step="0.0001"
            className="field mt-1.5 block w-28"
            value={lon}
            onChange={(e) => {
              pinMoved.current = true
              setLon(Number(e.target.value))
            }}
          />
        </label>
      </div>
    </>
  )

  return (
    <div className="h-full overflow-auto">
      <Tabs
        value={stormMode}
        onValueChange={(v) => setStormMode(v as 'design' | 'continuous' | 'climate')}
        className="flex flex-col gap-0"
      >
        <div className="px-6 pt-5">
          <PageHeader
            className="pb-2"
            title="Rainfall"
            description={
              'Build design storms from NOAA Atlas 14 or download rain records, and add them to the project’s storms to run every scenario under each. Or adjust the model for a future climate with SWMM-CAT.'
            }
          />
          <TabsList>
            <TabsTrigger value="design">Design storm</TabsTrigger>
            <TabsTrigger value="continuous">Continuous record</TabsTrigger>
            <TabsTrigger value="climate">Climate change</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="design" className="px-6 py-4">
          <div className="grid min-h-0 gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Panel title="Location (NOAA Atlas 14)">
                {locationBlock}
                <label className="mt-3 flex items-center gap-2 text-[12px] font-medium text-fg-soft">
                  NOAA Atlas 14 series
                  <select
                    className="field h-7 w-56 text-[12px]"
                    value={noaaSeries}
                    onChange={(e) => {
                      setNoaaSeries(e.target.value as 'pds' | 'ams')
                      setNoaaData(null)
                    }}
                  >
                    <option value="pds">Partial duration (most design work)</option>
                    <option value="ams">Annual maximum</option>
                  </select>
                </label>
                <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
                  {noaaLoading ? (
                    'Loading NOAA Atlas 14 depths…'
                  ) : noaaData ? (
                    'NOAA depths loaded for this point.'
                  ) : (
                    <>
                      Move the pin to load NOAA depths, or
                      <Button size="sm" variant="outline" onClick={() => void fetchNoaa()}>
                        Load for this point
                      </Button>
                    </>
                  )}
                </div>
                {noaaError && <p className="mt-2 text-xs text-danger">{noaaError}</p>}
                {noaaData && selectedRp && (
                  <div className="mt-3">
                    <label className="block text-[12px] font-medium text-fg-soft">
                      Return period (yr)
                      <select
                        className="field mt-1.5 block w-full"
                        value={returnPeriod}
                        onChange={(e) => setReturnPeriod(Number(e.target.value))}
                      >
                        {noaaData.map((p) => (
                          <option key={p.returnPeriod} value={p.returnPeriod}>
                            {p.returnPeriod}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-border">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-elevated text-muted">
                          <tr>
                            <th className="px-2 py-1">Duration</th>
                            <th className="px-2 py-1">Depth (in)</th>
                            <th className="px-2 py-1" />
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRp.dataPoints
                            .filter((d) =>
                              ['6-hr', '12-hr', '24-hr', '60-min'].includes(d.durationLabel),
                            )
                            .map((d) => (
                              <tr key={d.durationLabel} className="border-t border-border/60">
                                <td className="px-2 py-1">{d.durationLabel}</td>
                                <td className="px-2 py-1">{d.depth.toFixed(3)}</td>
                                <td className="px-2 py-1">
                                  <button
                                    type="button"
                                    className="text-accent-soft hover:underline"
                                    onClick={() => applyNoaaDepth(d.durationLabel)}
                                  >
                                    Use
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Storm parameters">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Category
                    <select
                      className="field mt-1.5 block w-full"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as StormCategory)}
                    >
                      <option value="SCS">SCS</option>
                      <option value="NRCS">NRCS</option>
                      <option value="Huff">Huff</option>
                    </select>
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Subtype
                    <select
                      className="field mt-1.5 block w-full"
                      value={subType}
                      onChange={(e) => setSubType(e.target.value)}
                    >
                      {subTypes.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Duration (hr)
                    <select
                      className="field mt-1.5 block w-full"
                      value={durationHr}
                      onChange={(e) => setDurationHr(Number(e.target.value))}
                    >
                      {durationOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Time step (min)
                    <input
                      type="number"
                      min={1}
                      className="field mt-1.5 block w-full"
                      value={timeStepMin}
                      onChange={(e) => setTimeStepMin(Number(e.target.value))}
                    />
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Total depth
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      className="field mt-1.5 block w-full"
                      value={totalDepth}
                      onChange={(e) => setTotalDepth(Number(e.target.value))}
                    />
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft" title="Increase rainfall depth for future climate, e.g. 20 % (applies to the saved storm and to storm sets)">
                    Climate uplift (%)
                    <input
                      type="number"
                      step="1"
                      min={0}
                      max={200}
                      className="field mt-1.5 block w-full"
                      value={uplift}
                      onChange={(e) => setUplift(Number(e.target.value))}
                    />
                  </label>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Units
                    <select
                      className="field mt-1.5 block w-full"
                      value={depthUnits}
                      onChange={(e) => setDepthUnits(e.target.value as 'us' | 'metric')}
                    >
                      <option value="us">US (in)</option>
                      <option value="metric">Metric (mm)</option>
                    </select>
                  </label>
                  <label className="col-span-2 block text-[12px] font-medium text-fg-soft">
                    Storm start (FILE timestamps)
                    <input
                      type="datetime-local"
                      className="field mt-1.5 block w-full"
                      value={startLocal}
                      onChange={(e) => {
                        startTouched.current = true
                        setStartLocal(e.target.value)
                      }}
                    />
                  </label>
                </div>
              </Panel>
            </div>

            <div className="flex flex-col gap-3">
              <Panel title="Hyetograph">
                {!result ? (
                  <p className="text-[13px] text-muted">Check the storm depth, duration and type: no storm can be built from these values.</p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-muted">
                      Peak {result.peakIntensity.toFixed(3)} {result.intensityUnit} · Total{' '}
                      {result.totalDepthActual.toFixed(3)} {result.depthUnit} ·{' '}
                      {result.detailedData.length} steps
                    </p>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          dataKey="timeHr"
                          stroke="#94a3b8"
                          label={{
                            value: 'Time (hr)',
                            position: 'insideBottom',
                            offset: -2,
                            fill: '#94a3b8',
                          }}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          label={{
                            value: result.intensityUnit,
                            angle: -90,
                            position: 'insideLeft',
                            fill: '#94a3b8',
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 8,
                          }}
                        />
                        <Line
                          type="stepAfter"
                          dataKey="intensity"
                          name="Intensity"
                          stroke="#38bdf8"
                          dot={false}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </Panel>

              {<StormLibraryPanel
                result={result}
                noaa={noaaData}
                returnPeriod={returnPeriod}
                totalDepth={totalDepth}
                durationHr={durationHr}
                category={category}
                subType={subType}
                timeStepMin={timeStepMin}
                depthUnits={depthUnits}
                startLocal={startLocal}
                uplift={uplift}
              />}
              <details className="rounded-xl border border-border bg-elevated/40 px-4 py-3">
                <summary className="cursor-pointer text-[13px] font-semibold text-fg">Save to the model instead</summary>
                <p className="mb-3 mt-1.5 text-[12px] text-muted">
                  The model then carries this storm on its own, for example to hand the .inp to someone.
                </p>
                <SaveToModel
                  gages={gageNames}
                  gage={gageName}
                  onGageChange={setGageName}
                  filename={filename}
                  onFilenameChange={setFilename}
                  applyAll={applyAll}
                  onApplyAllChange={setApplyAll}
                  syncTimes={syncTimes}
                  onSyncTimesChange={setSyncTimes}
                  note={`The file holds the depth for each ${timeStepMin}-minute step.`}
                  onSave={() => saveMutation.mutate()}
                  saving={saveMutation.isPending}
                  disabled={!result}
                  disabledReason="Build a storm first"
                />
              </details>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="continuous" className="px-6 py-4">
          <div className="grid min-h-0 gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Panel title="Location (Open-Meteo)">
                {locationBlock}
                <p className="mt-2 text-[11px] text-muted">
                  ERA5-Land hourly precip + temperature via Open-Meteo archive API.
                </p>
              </Panel>

              <Panel title="Period">
                <div className="mb-3 flex gap-2">
                  <Button
                    size="sm"
                    variant={periodMode === 'year' ? 'primary' : 'outline'}
                    onClick={() => setPeriodMode('year')}
                  >
                    Full year
                  </Button>
                  <Button
                    size="sm"
                    variant={periodMode === 'custom' ? 'primary' : 'outline'}
                    onClick={() => setPeriodMode('custom')}
                  >
                    Custom range
                  </Button>
                  <Button size="sm" variant={periodMode === 'forecast' ? 'primary' : 'outline'} onClick={() => setPeriodMode('forecast')}>
                    Forecast (7 days)
                  </Button>
                </div>
                {periodMode === 'forecast' ? (
                  <p className="m-0 text-[12px] text-muted">
                    Hourly rain forecast from Open-Meteo for the last day and the next 7 days at the pin. Load it, save it as a rain file, then run the model on the coming week’s weather.
                  </p>
                ) : periodMode === 'year' ? (
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Year
                    <select
                      className="field mt-1.5 block w-full"
                      value={climateYear}
                      onChange={(e) => setClimateYear(Number(e.target.value))}
                    >
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[12px] font-medium text-fg-soft">
                      Start
                      <input
                        type="date"
                        className="field mt-1.5 block w-full"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                    </label>
                    <label className="block text-[12px] font-medium text-fg-soft">
                      End
                      <input
                        type="date"
                        className="field mt-1.5 block w-full"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                      />
                    </label>
                    <p className="col-span-2 text-[11px] text-muted">
                      Max 366 days (v1). Default year is previous calendar year for ERA5 lag.
                    </p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Button onClick={() => void loadClimate()} disabled={climateLoading}>
                    {climateLoading ? 'Loading…' : 'Load climate'}
                  </Button>
                  <label className="block text-[12px] font-medium text-fg-soft">
                    Units
                    <select
                      className="field mt-1.5 block w-40"
                      value={contUnits}
                      onChange={(e) => setContUnits(e.target.value as 'us' | 'metric')}
                    >
                      <option value="metric">Metric (mm / °C)</option>
                      <option value="us">US (in / °F)</option>
                    </select>
                  </label>
                </div>
                {climateError && <p className="mt-2 text-xs text-danger">{climateError}</p>}
              </Panel>
            </div>

            <div className="flex flex-col gap-3">
              <Panel title="Climate preview">
                {!climate ? (
                  <p className="text-sm text-muted">
                    Load climate to preview hourly precipitation and temperature.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-muted">
                      {climate.times.length.toLocaleString()} hours · total precip{' '}
                      {contUnits === 'us'
                        ? `${(climate.totalPrecipMm / 25.4).toFixed(2)} in`
                        : `${climate.totalPrecipMm.toFixed(1)} mm`}
                      {climate.temperatureStats.meanC != null && (
                        <>
                          {' '}
                          · temp mean{' '}
                          {contUnits === 'us'
                            ? `${(((climate.temperatureStats.meanC * 9) / 5) + 32).toFixed(1)} °F`
                            : `${climate.temperatureStats.meanC.toFixed(1)} °C`}
                        </>
                      )}
                    </p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={climateChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="timeHr" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                        <YAxis
                          yAxisId="precip"
                          stroke="#38bdf8"
                          tick={{ fontSize: 10 }}
                          label={{
                            value: contUnits === 'us' ? 'in' : 'mm',
                            angle: -90,
                            position: 'insideLeft',
                            fill: '#38bdf8',
                          }}
                        />
                        <YAxis
                          yAxisId="temp"
                          orientation="right"
                          stroke="#f59e0b"
                          tick={{ fontSize: 10 }}
                          label={{
                            value: contUnits === 'us' ? '°F' : '°C',
                            angle: 90,
                            position: 'insideRight',
                            fill: '#f59e0b',
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 8,
                          }}
                          labelFormatter={(_l, payload) => {
                            const row = payload?.[0]?.payload as { label?: string } | undefined
                            return row?.label ?? String(_l)
                          }}
                        />
                        <Line
                          yAxisId="precip"
                          type="monotone"
                          dataKey="precip"
                          name="Precip"
                          stroke="#38bdf8"
                          dot={false}
                          strokeWidth={1.5}
                        />
                        <Line
                          yAxisId="temp"
                          type="monotone"
                          dataKey="temp"
                          name="Temp"
                          stroke="#f59e0b"
                          dot={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </>
                )}
              </Panel>

              <Panel title="Temperature for evaporation">
                <p className="m-0 text-[12px] leading-relaxed text-muted">
                  Use this record’s daily highs and lows for evaporation (Hargreaves) and snowmelt. They go to climate.dat, and
                  Simulation options → Climate is set to read them, at this location’s latitude.
                </p>
                <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[12.5px] text-fg-soft">
                  <Switch checked={contDryOnly} onCheckedChange={setContDryOnly} />
                  Evaporate only in dry periods (recommended)
                </label>
                <Button className="mt-3" variant="outline" onClick={() => applyTempMutation.mutate()} disabled={!climate || applyTempMutation.isPending}>
                  {applyTempMutation.isPending ? 'Setting…' : 'Use for evaporation'}
                </Button>
                {!climate && <p className="m-0 mt-2 text-[11.5px] text-muted">Load a record first.</p>}
              </Panel>
              {(
                <Panel title="Add to storms">
                  <p className="m-0 text-[12px] text-muted">
                    Keeps the record with the project, apart from the model, so any scenario can run under it.
                  </p>
                  <Button
                    className="mt-3"
                    variant="primary"
                    onClick={() => addRecordStorm.mutate()}
                    disabled={!climate || addRecordStorm.isPending}
                  >
                    {addRecordStorm.isPending ? 'Adding…' : 'Add this record'}
                  </Button>
                </Panel>
              )}
              <Panel title="Save to the model instead">
                <SaveToModel
                  gages={gageNames}
                  gage={contGageName}
                  onGageChange={setContGageName}
                  filename={contFilename}
                  onFilenameChange={setContFilename}
                  applyAll={contApplyAll}
                  onApplyAllChange={setContApplyAll}
                  note="The simulation dates are set to the record."
                  extra={
                    <label className="flex cursor-pointer items-center gap-2.5 text-fg-soft">
                      <Switch checked={contUseTemp} onCheckedChange={setContUseTemp} />
                      Also use its temperatures for evaporation and snowmelt
                    </label>
                  }
                  onSave={() => saveContinuousMutation.mutate()}
                  saving={saveContinuousMutation.isPending}
                  disabled={!climate}
                  disabledReason="Load a record first"
                />
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="climate" className="px-6 py-4">
          <ClimatePanel
            lat={lat}
            lon={lon}
            flowUnits={flowUnits}
            location={
              <>
                {locationBlock}
                {project.data && !project.data.crs_confirmed && !pinMoved.current ? (
                  <p className="mt-2 text-[12px] text-warning">This model has no coordinate system, so the pin isn't at the model. Click its location on the map.</p>
                ) : null}
              </>
            }
            applyLabel="Write to [ADJUSTMENTS]"
            onApply={applyAdjustments}
            onUseUplift={(pct, rp) => {
              setUplift(pct)
              if (noaaData?.some((d) => d.returnPeriod === rp)) setReturnPeriod(rp)
              setStormMode('design')
              toast({ title: `Climate uplift set to ${pct} %`, description: `From the ${rp}-year 24-hour storm change. Build the storm on the Design storm tab.` })
            }}
          />
        </TabsContent>
      </Tabs>

      <div className="px-6 pb-10">
        <RainGageList
          gages={raingages.data ?? []}
          files={datFiles.data ?? []}
          timeseries={timeseriesNames}
          loading={raingages.isLoading}
          busy={applyAllMutation.isPending || saveGageMutation.isPending}
          onSave={(name, body) => saveGageMutation.mutate({ name, body })}
          onApplyAll={(n) => applyAllMutation.mutate(n)}
          onSnap={(n) => snapToMeshMutation.mutate(n)}
          onSyncTimes={(f) => syncWindowMutation.mutate(f)}
          onRemove={(n) => deleteGageMutation.mutate(n)}
          onView={(w) => ('file' in w ? void viewDat(w.file) : viewTimeseries(w.timeseries, w.gage))}
          onDeleteFile={(f) => deleteDatMutation.mutate(f)}
          preview={
            previewName ? (
              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 flex items-baseline gap-3">
                  <h3 className="m-0 min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg-soft">{previewName}</h3>
                  {previewStats && (
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                      {previewStats.records.toLocaleString()} values · peak {previewStats.peak.toFixed(3)} {previewStats.unit ?? 'per hr'}{previewStats.station ? ` · station ${previewStats.station}` : ''}
                    </span>
                  )}
                  <button type="button" className="shrink-0 text-[12px] text-muted hover:text-fg" onClick={clearPreview}>
                    Close
                  </button>
                </div>
                {previewChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={previewChart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="timeHr" type="number" domain={['dataMin', 'dataMax']} tickCount={8} tickFormatter={(v) => `${Number(Number(v).toFixed(1))} h`} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} stroke="var(--color-border)" />
                      <YAxis width={44} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} stroke="var(--color-border)" />
                      <Tooltip
                        labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string } | undefined)?.label ?? ''}
                        formatter={(v) => [`${Number(v).toFixed(3)} ${previewStats?.unit ?? ''}`, 'Rain rate']}
                        contentStyle={{ background: 'var(--color-elevated)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 11 }}
                      />
                      <Line type="stepAfter" dataKey="value" name="Rain rate" stroke="var(--color-accent)" dot={false} strokeWidth={1.75} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="m-0 text-[12px] text-muted">No rain values found to plot.</p>
                )}
                {previewText != null && (
                  <details className="mt-2 text-[12px] text-muted">
                    <summary className="cursor-pointer select-none hover:text-fg">File text</summary>
                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-surface p-2 text-[11px] leading-relaxed text-fg-soft">{previewText}</pre>
                  </details>
                )}
              </div>
            ) : null
          }
        />
      </div>
    </div>
  )
}
