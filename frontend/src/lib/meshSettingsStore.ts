/** Shared 2D mesh generation UI state (Map AOI + Settings page). */

export type MeshSettingsState = {
  cellSize: number
  mannings: number
  demId: string
  aoiPolygon: number[][] | null
  aoiDraft: number[][]
  preview: import('../api/client').MeshPreviewResponse | null
}

const defaultState: MeshSettingsState = {
  cellSize: 10,
  mannings: 0.03,
  demId: '',
  aoiPolygon: null,
  aoiDraft: [],
  preview: null,
}

let state: MeshSettingsState = { ...defaultState }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getMeshSettings(): MeshSettingsState {
  return state
}

export function subscribeMeshSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function patchMeshSettings(partial: Partial<MeshSettingsState>): void {
  state = { ...state, ...partial }
  emit()
}

export function clearMeshAoi(): void {
  state = { ...state, aoiPolygon: null, aoiDraft: [], preview: null }
  emit()
}
