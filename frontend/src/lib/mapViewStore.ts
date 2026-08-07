/** Persist MapLibre camera across route remounts / tab switches / reloads. */

export type MapCamera = {
  longitude: number
  latitude: number
  zoom: number
  bearing?: number
  pitch?: number
}

const STORAGE_PREFIX = 'saturday-swmm-map-camera:'

const byProject = new Map<string, MapCamera>()

function storageKey(projectKey: string): string {
  return `${STORAGE_PREFIX}${projectKey}`
}

function readStoredCamera(projectKey: string): MapCamera | null {
  try {
    const raw = sessionStorage.getItem(storageKey(projectKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MapCamera>
    if (
      typeof parsed.longitude !== 'number' ||
      typeof parsed.latitude !== 'number' ||
      typeof parsed.zoom !== 'number'
    ) {
      return null
    }
    const camera: MapCamera = {
      longitude: parsed.longitude,
      latitude: parsed.latitude,
      zoom: parsed.zoom,
    }
    if (typeof parsed.bearing === 'number') camera.bearing = parsed.bearing
    if (typeof parsed.pitch === 'number') camera.pitch = parsed.pitch
    return camera
  } catch {
    return null
  }
}

function writeStoredCamera(projectKey: string, camera: MapCamera): void {
  try {
    sessionStorage.setItem(storageKey(projectKey), JSON.stringify(camera))
  } catch {
    /* private browsing / quota */
  }
}

function removeStoredCamera(projectKey: string): void {
  try {
    sessionStorage.removeItem(storageKey(projectKey))
  } catch {
    /* ignore */
  }
}

export function getSavedCamera(projectKey: string): MapCamera | null {
  const mem = byProject.get(projectKey)
  if (mem) return mem
  const stored = readStoredCamera(projectKey)
  if (stored) byProject.set(projectKey, stored)
  return stored
}

export function saveCamera(projectKey: string, camera: MapCamera): void {
  byProject.set(projectKey, camera)
  writeStoredCamera(projectKey, camera)
}

export function clearCamera(projectKey: string): void {
  byProject.delete(projectKey)
  removeStoredCamera(projectKey)
}
