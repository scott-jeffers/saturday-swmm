/** Recently opened projects, kept in this browser (newest first). */
export interface RecentProject {
  path: string
  name: string
  openedAt: string
}

const KEY = 'saturday-swmm.recent-projects'
const MAX = 12

export function readRecentProjects(): RecentProject[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((r) => r && typeof r.path === 'string') : []
  } catch {
    return []
  }
}

export function rememberProject(path: string, name: string): RecentProject[] {
  const next = [
    { path, name, openedAt: new Date().toISOString() },
    ...readRecentProjects().filter((r) => r.path !== path),
  ].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable: recent list just won't persist */
  }
  return next
}

export function forgetProject(path: string): RecentProject[] {
  const next = readRecentProjects().filter((r) => r.path !== path)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (!Number.isFinite(s) || s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString()
}
