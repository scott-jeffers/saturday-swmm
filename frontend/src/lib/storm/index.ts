/**
 * Storm calculation core — ported from scott-jeffers/GStorm.
 * Keep this folder UI-free so it can become @scott-jeffers/gstorm-core later.
 */

export type {
  StormStep,
  CalculationResult,
  StormInputParameters,
  NoaaDataPoint,
  NoaaReturnPeriodData,
  NoaaState,
} from './types'

export {
  INCH_TO_MM,
  stormSubTypesByCategory,
  calculateHyetograph,
  linearInterpolate,
  type CalculationInputs,
  type StormSubTypes,
} from './tr55'

export { parseNoaaCsv as parseNoaaPfds } from './noaaParser'

export {
  toSwmmDatFile,
  minutesToSwmmInterval,
  formatSwmmDateTime,
  parseSwmmDatFile,
  swmmDatToChartData,
  type SwmmDatOptions,
  type SwmmDatValueKind,
  type SwmmDatRecord,
  type ParsedSwmmDat,
} from './swmmDat'

/** Alias matching the plan public API. */
export { stormSubTypesByCategory as listStormSubTypes } from './tr55'

export {
  defaultSimulationYear,
  resolveDateRange,
  parseOpenMeteoResponse,
  aggregateDailyTemperature,
  hourlyToStormSteps,
  buildClimateDatBody,
  suggestedOpenMeteoFilename,
  type OpenMeteoDateOpts,
  type ResolvedDateRange,
  type OpenMeteoHourlyJson,
  type ParsedOpenMeteoClimate,
  type DailyTemp,
} from './openMeteo'
