/**
 * SWMM's climate sections as editable values, and back to text:
 * [EVAPORATION], [TEMPERATURE] (with wind speed, snowmelt and areal depletion)
 * and the monthly rows of [ADJUSTMENTS]. Lines this doesn't model are kept.
 */

export type EvapSource = 'NONE' | 'CONSTANT' | 'MONTHLY' | 'TIMESERIES' | 'TEMPERATURE' | 'FILE'
export type TempSource = 'NONE' | 'TIMESERIES' | 'FILE'

export type Climate = {
  evap: {
    source: EvapSource
    constant: string
    monthly: string[]
    timeseries: string
    /** Pan coefficients for FILE. */
    pan: string[]
    recovery: string
    dryOnly: boolean
  }
  temp: { source: TempSource; timeseries: string; file: string; fileStart: string }
  wind: { source: 'MONTHLY' | 'FILE'; monthly: string[] }
  snow: { divide: string; atiWeight: string; negMelt: string; elevation: string; latitude: string; longitudeCorrection: string }
  adc: { impervious: string[]; pervious: string[] }
  adjust: { temperature: string[]; evaporation: string[]; rainfall: string[]; conductivity: string[] }
  /** Lines kept as they are, per section. */
  keep: { EVAPORATION: string[]; TEMPERATURE: string[]; ADJUSTMENTS: string[] }
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const twelve = (v = '') => Array.from({ length: 12 }, () => v)
const ten = (v = '') => Array.from({ length: 10 }, () => v)
const pad = (a: string[], n: number, v = '') => [...a.slice(0, n), ...Array.from({ length: Math.max(0, n - a.length) }, () => v)]

export function emptyClimate(): Climate {
  return {
    evap: { source: 'CONSTANT', constant: '0', monthly: twelve('0'), timeseries: '', pan: twelve('1'), recovery: '', dryOnly: false },
    temp: { source: 'NONE', timeseries: '', file: '', fileStart: '' },
    wind: { source: 'MONTHLY', monthly: twelve('0') },
    snow: { divide: '34', atiWeight: '0.5', negMelt: '0.6', elevation: '0', latitude: '50', longitudeCorrection: '0' },
    adc: { impervious: ten('1'), pervious: ten('1') },
    adjust: { temperature: twelve(), evaporation: twelve(), rainfall: twelve(), conductivity: twelve() },
    keep: { EVAPORATION: [], TEMPERATURE: [], ADJUSTMENTS: [] },
  }
}

type Rows = { values: string[] }[]

export function parseClimate(evap: Rows, temp: Rows, adjust: Rows): Climate {
  const c = emptyClimate()
  let sawEvap = false
  for (const { values: v } of evap) {
    const k = (v[0] ?? '').toUpperCase()
    const rest = v.slice(1)
    if (k === 'CONSTANT') ((c.evap.source = 'CONSTANT'), (c.evap.constant = rest[0] ?? '0'), (sawEvap = true))
    else if (k === 'MONTHLY') ((c.evap.source = 'MONTHLY'), (c.evap.monthly = pad(rest, 12, '0')), (sawEvap = true))
    else if (k === 'TIMESERIES') ((c.evap.source = 'TIMESERIES'), (c.evap.timeseries = rest[0] ?? ''), (sawEvap = true))
    else if (k === 'TEMPERATURE') ((c.evap.source = 'TEMPERATURE'), (sawEvap = true))
    else if (k === 'FILE') ((c.evap.source = 'FILE'), rest.length && (c.evap.pan = pad(rest, 12, '1')), (sawEvap = true))
    else if (k === 'RECOVERY') c.evap.recovery = rest[0] ?? ''
    else if (k === 'DRY_ONLY') c.evap.dryOnly = (rest[0] ?? '').toUpperCase() === 'YES'
    else if (v.length) c.keep.EVAPORATION.push(v.join(' '))
  }
  if (!sawEvap && !evap.length) c.evap.source = 'NONE'
  for (const { values: v } of temp) {
    const k = (v[0] ?? '').toUpperCase()
    const rest = v.slice(1)
    if (k === 'TIMESERIES') ((c.temp.source = 'TIMESERIES'), (c.temp.timeseries = rest[0] ?? ''))
    else if (k === 'FILE') ((c.temp.source = 'FILE'), (c.temp.file = rest[0] ?? ''), (c.temp.fileStart = rest[1] ?? ''))
    else if (k === 'WINDSPEED') {
      if ((rest[0] ?? '').toUpperCase() === 'FILE') c.wind.source = 'FILE'
      else c.wind = { source: 'MONTHLY', monthly: pad(rest.slice(1), 12, '0') }
    } else if (k === 'SNOWMELT') {
      const [divide, atiWeight, negMelt, elevation, latitude, longitudeCorrection] = pad(rest, 6, '0')
      c.snow = { divide, atiWeight, negMelt, elevation, latitude, longitudeCorrection }
    } else if (k === 'ADC') {
      const kind = (rest[0] ?? '').toUpperCase()
      if (kind === 'IMPERVIOUS') c.adc.impervious = pad(rest.slice(1), 10, '1')
      else if (kind === 'PERVIOUS') c.adc.pervious = pad(rest.slice(1), 10, '1')
    } else if (v.length) c.keep.TEMPERATURE.push(v.join(' '))
  }
  for (const { values: v } of adjust) {
    const k = (v[0] ?? '').toUpperCase()
    const rest = pad(v.slice(1), 12)
    if (k === 'TEMPERATURE') c.adjust.temperature = rest
    else if (k === 'EVAPORATION') c.adjust.evaporation = rest
    else if (k === 'RAINFALL') c.adjust.rainfall = rest
    else if (k === 'CONDUCTIVITY') c.adjust.conductivity = rest
    else if (v.length) c.keep.ADJUSTMENTS.push(v.join(' '))
  }
  return c
}

const row = (key: string, ...vals: string[]) => [key.padEnd(16), ...vals].join(' ').trimEnd()
const nums = (a: string[], blank = '0') => a.map((x) => (x.trim() === '' ? blank : x.trim()))
const isDefault = (a: string[], d: string) => a.every((x) => x.trim() === '' || Number(x) === Number(d))

/** The three sections' text bodies (without their [HEADER] lines). */
export function climateToText(c: Climate, opts: { wantSnow?: boolean } = {}) {
  const evap: string[] = [';;Data Source    Parameters']
  switch (c.evap.source) {
    case 'CONSTANT': evap.push(row('CONSTANT', c.evap.constant.trim() || '0')); break
    case 'MONTHLY': evap.push(row('MONTHLY', ...nums(c.evap.monthly))); break
    case 'TIMESERIES': evap.push(row('TIMESERIES', c.evap.timeseries)); break
    case 'TEMPERATURE': evap.push('TEMPERATURE'); break
    case 'FILE': evap.push(row('FILE', ...nums(c.evap.pan, '1'))); break
    case 'NONE': evap.push(row('CONSTANT', '0')); break
  }
  if (c.evap.recovery.trim()) evap.push(row('RECOVERY', c.evap.recovery.trim()))
  evap.push(row('DRY_ONLY', c.evap.dryOnly ? 'YES' : 'NO'))
  evap.push(...c.keep.EVAPORATION)

  const temp: string[] = [';;Data Element     Values']
  if (c.temp.source === 'TIMESERIES' && c.temp.timeseries) temp.push(row('TIMESERIES', c.temp.timeseries))
  if (c.temp.source === 'FILE' && c.temp.file) temp.push(row('FILE', `"${c.temp.file.replace(/"/g, '')}"`, ...(c.temp.fileStart.trim() ? [c.temp.fileStart.trim()] : [])))
  if (c.wind.source === 'FILE') temp.push(row('WINDSPEED', 'FILE'))
  else if (!isDefault(c.wind.monthly, '0')) temp.push(row('WINDSPEED', 'MONTHLY', ...nums(c.wind.monthly)))
  const s = c.snow
  if (opts.wantSnow || c.temp.source !== 'NONE') {
    temp.push(row('SNOWMELT', ...nums([s.divide, s.atiWeight, s.negMelt, s.elevation, s.latitude, s.longitudeCorrection])))
    if (!isDefault(c.adc.impervious, '1')) temp.push(row('ADC IMPERVIOUS', ...nums(c.adc.impervious, '1')))
    if (!isDefault(c.adc.pervious, '1')) temp.push(row('ADC PERVIOUS', ...nums(c.adc.pervious, '1')))
  }
  temp.push(...c.keep.TEMPERATURE)

  const adj: string[] = []
  const blank = (a: string[], d: string) => a.every((x) => x.trim() === '') || isDefault(a, d)
  if (!blank(c.adjust.temperature, '0')) adj.push(row('TEMPERATURE', ...nums(c.adjust.temperature)))
  if (!blank(c.adjust.evaporation, '0')) adj.push(row('EVAPORATION', ...nums(c.adjust.evaporation)))
  if (!blank(c.adjust.rainfall, '1')) adj.push(row('RAINFALL', ...nums(c.adjust.rainfall, '1')))
  if (!blank(c.adjust.conductivity, '1')) adj.push(row('CONDUCTIVITY', ...nums(c.adjust.conductivity, '1')))
  adj.push(...c.keep.ADJUSTMENTS)

  return {
    EVAPORATION: evap.join('\n'),
    // A [TEMPERATURE] with only its comment header is left out.
    TEMPERATURE: temp.length > 1 ? temp.join('\n') : null,
    ADJUSTMENTS: adj.length ? adj.join('\n') : null,
  }
}

/** A short line saying what a gap in the settings means, or null when it's fine. */
export function climateProblem(c: Climate): string | null {
  if (c.evap.source === 'TEMPERATURE' && c.temp.source === 'NONE')
    return 'Evaporation from temperature needs daily temperatures: set them on the Temperature tab, or get them on the Rainfall page.'
  if (c.evap.source === 'TIMESERIES' && !c.evap.timeseries) return 'Choose the time series that holds the evaporation rates.'
  if (c.temp.source === 'TIMESERIES' && !c.temp.timeseries) return 'Choose the time series that holds the temperatures.'
  if (c.temp.source === 'FILE' && !c.temp.file) return 'Choose the climate file that holds the temperatures.'
  if ((c.evap.source === 'FILE' || c.wind.source === 'FILE') && c.temp.source !== 'FILE')
    return 'Evaporation or wind speed from a file reads the climate file set on the Temperature tab.'
  return null
}
