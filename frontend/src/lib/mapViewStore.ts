/** Persist MapLibre camera across route remounts / tab switches. */

export type MapCamera = {
  longitude: number
  latitude: number
  zoom: number
}

const byProject = new Map<string, MapCamera>()

export function getSavedCamera(projectKey: string): MapCamera | null {
  return byProject.get(projectKey) ?? null
}

export function saveCamera(projectKey: string, camera: MapCamera): void {
  byProject.set(projectKey, camera)
}

export function clearCamera(projectKey: string): void {
  byProject.delete(projectKey)
}
