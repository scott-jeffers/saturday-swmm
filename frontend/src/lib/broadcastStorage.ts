import { DEFAULT_STATION_ID, isValidStationId } from './broadcastStations'

/** Shared with YugeWeather so station preference carries across apps. */
const GREATS_MUSIC_STATION_KEY = 'yuge-weather-greats-music-station'

export function loadGreatsMusicStation(): string {
  try {
    const raw = localStorage.getItem(GREATS_MUSIC_STATION_KEY)
    if (raw && isValidStationId(raw)) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_STATION_ID
}

export function saveGreatsMusicStation(id: string): void {
  if (!isValidStationId(id)) return
  try {
    localStorage.setItem(GREATS_MUSIC_STATION_KEY, id)
  } catch {
    /* ignore */
  }
}
