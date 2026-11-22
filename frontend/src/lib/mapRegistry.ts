import type { Map as MapLibreMap } from 'maplibre-gl'

/** The network map on screen, for tools outside it (print and export). */
let current: MapLibreMap | null = null
export const setCurrentMap = (m: MapLibreMap | null) => {
  current = m
}
export const getCurrentMap = () => current
