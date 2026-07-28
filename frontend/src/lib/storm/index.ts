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
  type SwmmDatOptions,
  type SwmmDatValueKind,
} from './swmmDat'

/** Alias matching the plan public API. */
export { stormSubTypesByCategory as listStormSubTypes } from './tr55'
