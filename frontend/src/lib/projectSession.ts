/** Persist the active project path across Vite reloads / browser refresh. */

const PROJECT_KEY = 'saturday-swmm-active-project'

export function readStoredProjectPath(): string | null {
  try {
    const v = sessionStorage.getItem(PROJECT_KEY)
    const trimmed = v?.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

export function writeStoredProjectPath(path: string): void {
  try {
    const trimmed = path.trim()
    if (!trimmed) {
      sessionStorage.removeItem(PROJECT_KEY)
      return
    }
    sessionStorage.setItem(PROJECT_KEY, trimmed)
  } catch {
    /* private browsing / quota */
  }
}

export function clearStoredProjectPath(): void {
  try {
    sessionStorage.removeItem(PROJECT_KEY)
  } catch {
    /* ignore */
  }
}
