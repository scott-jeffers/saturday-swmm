import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Trash2 } from 'lucide-react'
import { ApiError, api } from '../api/client'
import { Button, PageHeader, Panel, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '../components/ui'
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

function LocationPicker({
  lat,
  lon,
  onChange,
}: {
  lat: number
  lon: number
  onChange: (lat: number, lon: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap',
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#dbe4ee' } },
          { id: 'osm', type: 'raster', source: 'osm' },
        ],
      },
      center: [lon, lat],
      zoom: 5,
      attributionControl: {},
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const marker = new maplibregl.Marker({ color: '#0ea5e9' })
      .setLngLat([lon, lat])
      .addTo(map)
    markerRef.current = marker
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat)
      onChangeRef.current(e.lngLat.lat, e.lngLat.lng)
    })
    mapRef.current = map
    return () => {
      marker.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    markerRef.current?.setLngLat([lon, lat])
  }, [lat, lon])

  return (
    <div
      ref={containerRef}
      className="h-56 w-full overflow-hidden rounded-xl border border-border"
    />
  )
}

export function StormPage({ projectPath }: { projectPath: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [stormMode, setStormMode] = useState<'design' | 'continuous'>('design')

  const [lat, setLat] = useState(39.0)
  const [lon, setLon] = useState(-77.0)
  const [noaaLoading, setNoaaLoading] = useState(false)
  const [noaaError, setNoaaError] = useState<string | null>(null)
  const [noaaData, setNoaaData] = useState<NoaaReturnPeriodData[] | null>(null)
  const [returnPeriod, setReturnPeriod] = useState(10)

  const [category, setCategory] = useState<StormCategory>('SCS')
  const subTypes = listStormSubTypes[category]
  const [subType, setSubType] = useState(subTypes[0] ?? 'Type II')
  const [durationHr, setDurationHr] = useState(24)
  const [timeStepMin, setTimeStepMin] = useState(5)
  const [depthUnits, setDepthUnits] = useState<'us' | 'metric'>('us')
  const [totalDepth, setTotalDepth] = useState(3.0)
  const [startLocal, setStartLocal] = useState('2024-01-01T00:00')

  const [filename, setFilename] = useState('design_storm.dat')
  const [gageName, setGageName] = useState('RG1')
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
  } | null>(null)

  // Continuous / Open-Meteo
  const [periodMode, setPeriodMode] = useState<'year' | 'custom'>('year')
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

  const ensureProjectOpen = async () => {
    await api.openProject(projectPath)
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
      const csv = await api.getNoaaPfds(lat, lon)
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
      toast({ title: 'NOAA data loaded', tone: 'success' })
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

  const runCalc = () => {
    const calc = calculateHyetograph({
      totalDepthInput: totalDepth,
      durationInput: durationHr,
      stormCategory: category,
      stormSubType: subType,
      timeStepMinutes: timeStepMin,
      depthUnit: depthUnits,
      durationUnit: 'hours',
    })
    if (!calc.detailedData.length) {
      toast({
        title: 'Calculation failed',
        description: 'Check storm type, duration, and depth.',
        tone: 'danger',
      })
      setResult(null)
      return
    }
    setResult(calc)
  }

  const chartData = useMemo(
    () =>
      result?.detailedData.map((s) => ({
        timeHr: Number((s.timeStart / 60).toFixed(3)),
        intensity: Number(s.intensity.toFixed(4)),
      })) ?? [],
    [result],
  )

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
        comment: `Design storm ${category} ${subType} ${durationHr}hr · ${totalDepth} ${result.depthUnit}`,
      })
      await api.writeProjectFile(name, content)
      await api.upsertFileRaingage({
        name: gageName.trim() || 'RG1',
        filename: name,
        format: 'VOLUME',
        interval: minutesToSwmmInterval(timeStepMin),
        units: depthUnits === 'metric' ? 'MM' : 'IN',
      })
      return name
    },
    onSuccess: (name) => {
      refreshStormLists()
      toast({
        title: 'Saved to project',
        description: `${name} + raingage ${gageName}`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Save failed',
        description: err instanceof ApiError ? err.message : (err as Error).message,
        tone: 'danger',
      }),
  })

  const applyAllMutation = useMutation({
    mutationFn: async () => {
      await ensureProjectOpen()
      return api.applyRaingageToAll(gageName.trim() || 'RG1')
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
    mutationFn: async () => {
      await ensureProjectOpen()
      return api.snapRaingageToMesh(gageName.trim() || 'RG1')
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
      const climateBody = buildClimateDatBody(climate.dailyTemperatureByDate, contUnits)
      await api.writeProjectFile('climate.dat', climateBody)
      await api.applyClimateTemperature({ filename: 'climate.dat', dry_only: contDryOnly })
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
      return { rainName, gage }
    },
    onSuccess: ({ rainName, gage }) => {
      refreshStormLists()
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      toast({
        title: 'Continuous climate saved',
        description: `${rainName} + climate.dat + raingage ${gage}; sim window synced`,
        tone: 'success',
      })
    },
    onError: (err) =>
      toast({
        title: 'Save failed',
        description: err instanceof ApiError ? err.message : (err as Error).message,
        tone: 'danger',
      }),
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
          setLat(Number(la.toFixed(5)))
          setLon(Number(lo.toFixed(5)))
        }}
      />
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">
          Lat
          <input
            type="number"
            step="0.0001"
            className="mt-1 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            value={lat}
            onChange={(e) => setLat(Number(e.target.value))}
          />
        </label>
        <label className="text-xs text-muted">
          Lon
          <input
            type="number"
            step="0.0001"
            className="mt-1 block w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            value={lon}
            onChange={(e) => setLon(Number(e.target.value))}
          />
        </label>
      </div>
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={stormMode}
        onValueChange={(v) => setStormMode(v as 'design' | 'continuous')}
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="px-6 pt-5">
          <PageHeader
            className="pb-2"
            title="Rainfall"
            description="Build a design storm from NOAA Atlas 14, or download a continuous record from Open-Meteo, and save it as a SWMM rain file and rain gage."
          />
          <TabsList>
            <TabsTrigger value="design">Design storm</TabsTrigger>
            <TabsTrigger value="continuous">Continuous record</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="design" className="min-h-0 overflow-auto px-6 py-4">
          <div className="grid min-h-0 gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Panel title="Location (NOAA Atlas 14)">
                {locationBlock}
                <div className="mt-3">
                  <Button onClick={() => void fetchNoaa()} disabled={noaaLoading}>
                    {noaaLoading ? 'Fetching…' : 'Fetch NOAA'}
                  </Button>
                </div>
                {noaaError && <p className="mt-2 text-xs text-danger">{noaaError}</p>}
                {noaaData && selectedRp && (
                  <div className="mt-3">
                    <label className="text-xs text-muted">
                      Return period (yr)
                      <select
                        className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
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
                  <label className="text-xs text-muted">
                    Category
                    <select
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as StormCategory)}
                    >
                      <option value="SCS">SCS</option>
                      <option value="NRCS">NRCS</option>
                      <option value="Huff">Huff</option>
                    </select>
                  </label>
                  <label className="text-xs text-muted">
                    Subtype
                    <select
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
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
                  <label className="text-xs text-muted">
                    Duration (hr)
                    <select
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
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
                  <label className="text-xs text-muted">
                    Time step (min)
                    <input
                      type="number"
                      min={1}
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={timeStepMin}
                      onChange={(e) => setTimeStepMin(Number(e.target.value))}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Total depth
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={totalDepth}
                      onChange={(e) => setTotalDepth(Number(e.target.value))}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Units
                    <select
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={depthUnits}
                      onChange={(e) => setDepthUnits(e.target.value as 'us' | 'metric')}
                    >
                      <option value="us">US (in)</option>
                      <option value="metric">Metric (mm)</option>
                    </select>
                  </label>
                  <label className="col-span-2 text-xs text-muted">
                    Storm start (FILE timestamps)
                    <input
                      type="datetime-local"
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <Button onClick={runCalc}>Calculate hyetograph</Button>
                </div>
              </Panel>
            </div>

            <div className="flex flex-col gap-3">
              <Panel title="Hyetograph">
                {!result ? (
                  <p className="text-sm text-muted">Calculate a storm to preview intensity.</p>
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

              <Panel title="Save to project">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted">
                    Filename
                    <input
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Raingage name
                    <input
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={gageName}
                      onChange={(e) => setGageName(e.target.value)}
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Chart shows intensity; the saved FILE uses{' '}
                  <span className="text-fg-soft">VOLUME</span> (depth per {timeStepMin}-min
                  interval) because OpenSWMM under-reads INTENSITY FILE rain.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={!result || saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save .dat + raingage'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => applyAllMutation.mutate()}
                    disabled={applyAllMutation.isPending}
                  >
                    {applyAllMutation.isPending
                      ? 'Applying…'
                      : `Apply ${gageName || 'RG1'} to all subcatchments`}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => snapToMeshMutation.mutate()}
                    disabled={snapToMeshMutation.isPending}
                  >
                    {snapToMeshMutation.isPending
                      ? 'Snapping…'
                      : `Snap ${gageName || 'RG1'} to 2D mesh`}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const name = filename.trim().endsWith('.dat')
                        ? filename.trim()
                        : `${filename.trim()}.dat`
                      syncWindowMutation.mutate(name)
                    }}
                    disabled={syncWindowMutation.isPending || !filename.trim()}
                  >
                    {syncWindowMutation.isPending
                      ? 'Updating…'
                      : 'Set sim start/end from rain file'}
                  </Button>
                </div>
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="continuous" className="min-h-0 overflow-auto px-6 py-4">
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
                </div>
                {periodMode === 'year' ? (
                  <label className="text-xs text-muted">
                    Year
                    <select
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
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
                    <label className="text-xs text-muted">
                      Start
                      <input
                        type="date"
                        className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                    </label>
                    <label className="text-xs text-muted">
                      End
                      <input
                        type="date"
                        className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
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
                  <label className="text-xs text-muted">
                    Units
                    <select
                      className="mt-1 block w-40 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
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

              <Panel title="Save continuous climate">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted">
                    Rain filename
                    <input
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={contFilename}
                      onChange={(e) => setContFilename(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Raingage name
                    <input
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                      value={contGageName}
                      onChange={(e) => setContGageName(e.target.value)}
                    />
                  </label>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={contDryOnly}
                    onChange={(e) => setContDryOnly(e.target.checked)}
                  />
                  Evaporation DRY_ONLY (recommended)
                </label>
                <p className="mt-2 text-xs text-muted">
                  Writes rain `.dat` (VOLUME 1:00), <code className="text-fg-soft">climate.dat</code>
                  , wires [TEMPERATURE]/[EVAPORATION], and syncs the simulation window.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={() => saveContinuousMutation.mutate()}
                    disabled={!climate || saveContinuousMutation.isPending}
                  >
                    {saveContinuousMutation.isPending
                      ? 'Saving…'
                      : 'Save rain + climate to project'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        await ensureProjectOpen()
                        const res = await api.applyRaingageToAll(
                          contGageName.trim() || 'OpenMeteo',
                        )
                        refreshStormLists()
                        toast({
                          title: 'Raingage applied',
                          description: `Set ${res.raingage} on ${res.updated} subcatchment(s)`,
                          tone: 'success',
                        })
                      })().catch((err) =>
                        toast({
                          title: 'Apply failed',
                          description: (err as Error).message,
                          tone: 'danger',
                        }),
                      )
                    }}
                  >
                    Apply {contGageName || 'OpenMeteo'} to all subcatchments
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        await ensureProjectOpen()
                        const res = await api.snapRaingageToMesh(
                          contGageName.trim() || 'OpenMeteo',
                        )
                        refreshStormLists()
                        toast({
                          title: 'Raingage snapped to 2D mesh',
                          description: `${res.raingage} @ (${res.x.toFixed(1)}, ${res.y.toFixed(1)})`,
                          tone: 'success',
                        })
                      })().catch((err) =>
                        toast({
                          title: 'Snap to mesh failed',
                          description: (err as Error).message,
                          tone: 'danger',
                        }),
                      )
                    }}
                  >
                    Snap to 2D mesh
                  </Button>
                </div>
              </Panel>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="grid max-h-[40%] gap-3 overflow-auto border-t border-border p-3 lg:grid-cols-2">
        <Panel title="Project rain files (.dat)">
          {datFiles.isLoading && <p className="text-xs text-muted">Loading…</p>}
          {datFiles.isError && (
            <p className="text-xs text-danger">{(datFiles.error as Error).message}</p>
          )}
          {!datFiles.isLoading && (datFiles.data?.length ?? 0) === 0 && (
            <p className="text-xs text-muted">No `.dat` files in this project folder yet.</p>
          )}
          <ul className="mt-1 space-y-1">
            {(datFiles.data ?? []).map((f) => (
              <li
                key={f.filename}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  {f.filename}{' '}
                  <span className="text-xs text-muted">
                    ({Math.max(1, Math.round(f.size_bytes / 1024))} KB)
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => syncWindowMutation.mutate(f.filename)}
                    disabled={syncWindowMutation.isPending}
                  >
                    Set times
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void viewDat(f.filename)}
                    aria-label={`View ${f.filename}`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Delete ${f.filename}?`)) {
                        deleteDatMutation.mutate(f.filename)
                      }
                    }}
                    aria-label={`Delete ${f.filename}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {previewName && previewText != null && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-muted">
                <span>Preview: {previewName}</span>
                <button type="button" className="hover:text-fg" onClick={clearPreview}>
                  Close
                </button>
              </div>
              {previewChart.length > 0 ? (
                <>
                  <p className="mb-2 text-xs text-muted">
                    {previewStats
                      ? `${previewStats.records} records · peak ${previewStats.peak.toFixed(4)}${
                          previewStats.station ? ` · station ${previewStats.station}` : ''
                        }`
                      : null}
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={previewChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="timeHr" stroke="#94a3b8" />
                      <YAxis stroke="#94a3b8" />
                      <Tooltip
                        contentStyle={{
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: 8,
                        }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="value"
                        name="Rainfall"
                        stroke="#38bdf8"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <p className="mb-2 text-xs text-muted">
                  No parseable rainfall records found for a graph.
                </p>
              )}
              <pre className="mt-2 max-h-28 overflow-auto rounded-lg border border-border bg-surface p-2 text-[11px] leading-relaxed">
                {previewText}
              </pre>
            </div>
          )}
        </Panel>

        <Panel title="INP raingages">
          {raingages.isLoading && <p className="text-xs text-muted">Loading…</p>}
          {!raingages.isLoading && (raingages.data?.length ?? 0) === 0 && (
            <p className="text-xs text-muted">No raingages in the INP yet.</p>
          )}
          <ul className="mt-1 space-y-1">
            {(raingages.data ?? []).map((g) => (
              <li
                key={g.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{g.name}</span>{' '}
                  <span className="text-xs text-muted">
                    {g.source}
                    {g.filename ? ` · ${g.filename}` : ''}
                    {g.timeseries ? ` · ${g.timeseries}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setGageName(g.name)
                      setContGageName(g.name)
                      if (g.filename) {
                        setFilename(g.filename)
                        setContFilename(g.filename)
                      }
                    }}
                  >
                    Use
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Remove raingage ${g.name} from INP?`)) {
                        deleteGageMutation.mutate(g.name)
                      }
                    }}
                    aria-label={`Remove ${g.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
