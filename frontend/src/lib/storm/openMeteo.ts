/**
 * Open-Meteo ERA5-Land → SWMM continuous climate helpers.
 * Ported from Purple-Roof-Simulator swmm-inp-package.mjs patterns.
 */
import type { StormStep } from './types'

const MM_TO_IN = 1 / 25.4
const MAX_RANGE_DAYS = 366

export type OpenMeteoDateOpts = {
  year?: string | number
  startDate?: string
  endDate?: string
}

export type ResolvedDateRange = {
  startDate: string
  endDate: string
  startYear: number
  labelStart: string
  labelEnd: string
}

export type OpenMeteoHourlyJson = {
  hourly?: {
    time?: string[]
    precipitation?: (number | null)[]
    temperature_2m?: (number | null)[]
  }
  latitude?: number
  longitude?: number
  timezone?: string
}

export type DailyTemp = { minC: number; maxC: number }

export type ParsedOpenMeteoClimate = {
  range: ResolvedDateRange
  times: string[]
  precipitationMm: number[]
  temperatureCelsius: number[]
  totalPrecipMm: number
  temperatureStats: {
    minC: number | null
    maxC: number | null
    meanC: number | null
  }
  dailyTemperatureByDate: Record<string, DailyTemp>
  firstTime: Date
  lastTime: Date
}

/** Previous calendar year — safer for ERA5 archive lag. */
export function defaultSimulationYear(): number {
  return new Date().getFullYear() - 1
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
  const a = parseIsoDate(startIso).getTime()
  const b = parseIsoDate(endIso).getTime()
  return Math.floor((b - a) / 86_400_000) + 1
}

/**
 * Resolve Open-Meteo date range from year or custom start/end.
 * Custom ranges are capped at 366 days.
 */
export function resolveDateRange(opts: OpenMeteoDateOpts = {}): ResolvedDateRange {
  const startDate = opts.startDate?.trim()
  const endDate = opts.endDate?.trim()

  if (startDate && endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('Dates must be YYYY-MM-DD')
    }
    if (startDate > endDate) {
      throw new Error('startDate must be on or before endDate')
    }
    const days = daysBetweenInclusive(startDate, endDate)
    if (days > MAX_RANGE_DAYS) {
      throw new Error(`Date range cannot exceed ${MAX_RANGE_DAYS} days (got ${days})`)
    }
    const sy = Number.parseInt(startDate.slice(0, 4), 10)
    return {
      startDate,
      endDate,
      startYear: sy,
      labelStart: startDate,
      labelEnd: endDate,
    }
  }

  const year = String(opts.year ?? defaultSimulationYear())
  if (!/^\d{4}$/.test(year)) {
    throw new Error('year must be a 4-digit calendar year')
  }
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    startYear: Number.parseInt(year, 10),
    labelStart: `${year}-01-01`,
    labelEnd: `${year}-12-31`,
  }
}

/** Aggregate hourly °C into daily min/max keyed by YYYY-MM-DD. */
export function aggregateDailyTemperature(
  times: string[],
  temperatureCelsius: number[],
): Record<string, DailyTemp> {
  const daily: Record<string, DailyTemp> = {}
  for (let i = 0; i < times.length; i++) {
    const iso = times[i]!
    const dStr = iso.includes('T') ? iso.split('T')[0]! : iso.slice(0, 10)
    const tVal = temperatureCelsius[i] ?? 0
    if (!daily[dStr]) {
      daily[dStr] = { minC: tVal, maxC: tVal }
    } else {
      daily[dStr]!.minC = Math.min(daily[dStr]!.minC, tVal)
      daily[dStr]!.maxC = Math.max(daily[dStr]!.maxC, tVal)
    }
  }
  return daily
}

/** Normalize Open-Meteo archive JSON into climate arrays (metric). */
export function parseOpenMeteoResponse(
  json: OpenMeteoHourlyJson,
  opts: OpenMeteoDateOpts = {},
): ParsedOpenMeteoClimate {
  const range = resolveDateRange(opts)
  const times = json.hourly?.time ?? []
  if (!times.length) {
    throw new Error('Invalid hourly data returned from Open-Meteo')
  }
  const precipRaw = json.hourly?.precipitation ?? []
  const tempRaw = json.hourly?.temperature_2m ?? []

  const precipitationMm = times.map((_, i) =>
    precipRaw[i] != null && Number.isFinite(precipRaw[i] as number) ? (precipRaw[i] as number) : 0,
  )
  const temperatureCelsius = times.map((_, i) => {
    const t = tempRaw[i]
    if (t != null && Number.isFinite(t)) return t
    if (i > 0 && tempRaw[i - 1] != null && Number.isFinite(tempRaw[i - 1] as number)) {
      return tempRaw[i - 1] as number
    }
    return 0
  })

  let totalPrecipMm = 0
  let tMin = Infinity
  let tMax = -Infinity
  let tSum = 0
  for (let i = 0; i < times.length; i++) {
    totalPrecipMm += precipitationMm[i]!
    const tc = temperatureCelsius[i]!
    tMin = Math.min(tMin, tc)
    tMax = Math.max(tMax, tc)
    tSum += tc
  }

  const firstIso = times[0]!
  const lastIso = times[times.length - 1]!
  const firstTime = new Date(firstIso.includes('T') ? firstIso : `${firstIso}T00:00`)
  const lastTime = new Date(lastIso.includes('T') ? lastIso : `${lastIso}T00:00`)

  return {
    range,
    times,
    precipitationMm,
    temperatureCelsius,
    totalPrecipMm,
    temperatureStats: {
      minC: times.length ? tMin : null,
      maxC: times.length ? tMax : null,
      meanC: times.length ? tSum / times.length : null,
    },
    dailyTemperatureByDate: aggregateDailyTemperature(times, temperatureCelsius),
    firstTime,
    lastTime,
  }
}

/**
 * Convert hourly precip (mm) into StormStep[] for toSwmmDatFile.
 * depthStep is depth per hour interval in the requested unit.
 * timeStart is minutes from the first hour.
 */
export function hourlyToStormSteps(
  climate: ParsedOpenMeteoClimate,
  depthUnits: 'us' | 'metric' = 'metric',
): StormStep[] {
  const steps: StormStep[] = []
  let cumulative = 0
  for (let i = 0; i < climate.times.length; i++) {
    const mm = climate.precipitationMm[i]!
    const depthStep = depthUnits === 'us' ? mm * MM_TO_IN : mm
    cumulative += depthStep
    const timeStart = i * 60
    steps.push({
      timeStart,
      timeEnd: timeStart + 60,
      intensity: depthStep, // depth/hour == intensity for 1-hr intervals
      depthStep,
      cumulativeDepth: cumulative,
    })
  }
  return steps
}

/**
 * Build SWMM climate.dat body (daily min/max).
 * When units='us', values are °F; otherwise °C.
 */
export function buildClimateDatBody(
  dailyTemperatureByDate: Record<string, DailyTemp>,
  units: 'us' | 'metric' = 'metric',
): string {
  const days = Object.keys(dailyTemperatureByDate).sort()
  const lines: string[] = [
    '; Open-Meteo ERA5-Land daily min/max air temperature',
    `; units = ${units === 'us' ? 'Fahrenheit' : 'Celsius'}`,
  ]
  for (const iso of days) {
    const rec = dailyTemperatureByDate[iso]
    if (!rec) continue
    const [y, m, d] = iso.split('-')
    let tMax = rec.maxC
    let tMin = rec.minC
    if (units === 'us') {
      tMax = (tMax * 9) / 5 + 32
      tMin = (tMin * 9) / 5 + 32
    }
    const maxS = Number.isFinite(tMax) ? tMax.toFixed(3) : '*'
    const minS = Number.isFinite(tMin) ? tMin.toFixed(3) : '*'
    lines.push(`OPENMETEO ${Number(y)} ${Number(m)} ${Number(d)} ${maxS} ${minS}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Suggested rain file name for a resolved range. */
export function suggestedOpenMeteoFilename(range: ResolvedDateRange): string {
  if (range.startDate.endsWith('-01-01') && range.endDate.endsWith('-12-31')) {
    return `openmeteo_${range.startYear}.dat`
  }
  return `openmeteo_${range.startDate}_${range.endDate}.dat`
}

export { MM_TO_IN, MAX_RANGE_DAYS }
