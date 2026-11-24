/**
 * The online project as files, the way the desktop app keeps a project folder:
 * the base model, scenarios, storms, versions, notes and settings, rain files and,
 * for a review package, the current results.
 */
import { crc32, makeZip } from '../lib/zip'
import { getProject } from './store'

function save(name: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** Every file of the project folder (without results), by path inside it. */
export function projectFolderFiles(): { path: string; data: Uint8Array | string }[] {
  const p = getProject()
  if (!p) return []
  const files = new Map<string, Uint8Array | string>()
  for (const [path, data] of Object.entries(p.projectFiles ?? {})) files.set(path, data)
  // The open model as it is now, where it lives (the base .inp or a scenario's).
  files.set(p.activeInp ?? p.inpName, p.inpText)
  if (!files.has(p.inpName)) files.set(p.inpName, p.inpText)
  for (const r of p.rainFiles ?? []) files.set(r.name, r.text)
  return [...files].map(([path, data]) => ({ path, data }))
}

const stem = () => (getProject()?.inpName ?? 'model.inp').replace(/\.[^.]+$/, '')

/** The whole project as one .zip (opens again here, or in the desktop app). */
export function downloadProjectZip() {
  const files = projectFolderFiles()
  if (!files.length) return
  save(`${stem()}-project.zip`, makeZip(files.map((f) => ({ ...f, path: `${stem()}/${f.path}` }))))
  markProjectSaved()
}

/** Model and current results for a reviewer, like the desktop's review package. */
export function downloadReviewPackage() {
  const p = getProject()
  if (!p) return
  const r = p.results[0]
  const files: { path: string; data: Uint8Array | string }[] = [{ path: p.inpName, data: p.inpText }]
  for (const f of p.rainFiles ?? []) files.push({ path: f.name, data: f.text })
  if (r?.rptText) files.push({ path: r.rptName ?? `${stem()}.rpt`, data: r.rptText })
  if (r?.outBuf) files.push({ path: r.outName ?? `${stem()}.out`, data: new Uint8Array(r.outBuf) })
  files.push({ path: 'saturday-swmm-review.json', data: JSON.stringify({ crs: p.crs, made: new Date().toISOString() }) })
  save(`${stem()}-review.zip`, makeZip(files))
}

/** True when the project is more than one model file (scenarios or storms): then saving it
 *  to the computer means the project .zip, not just the open .inp. */
export function isFolderProject(): boolean {
  const files = Object.keys(getProject()?.projectFiles ?? {})
  return files.includes('scenarios.json') || files.some((f) => f.startsWith('storms/'))
}

/** A fingerprint of the whole project folder, to tell whether the last .zip saved is still current. */
export function projectFingerprint(): string {
  const enc = new TextEncoder()
  return projectFolderFiles()
    .filter((f) => !f.path.startsWith('snapshots/') && f.path !== '.saturday-swmm.json')
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((f) => `${f.path}:${crc32(typeof f.data === 'string' ? enc.encode(f.data) : f.data).toString(36)}`)
    .join('|')
}

export const PROJECT_SAVED_KEY = (inpName: string) => `saturday-swmm.saved:project:${inpName}`

/** Remember the project as saved to the computer as it is now (after a .zip download or opening one). */
export function markProjectSaved() {
  const p = getProject()
  if (!p) return
  try {
    localStorage.setItem(PROJECT_SAVED_KEY(p.inpName), projectFingerprint())
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('saturday-swmm-saved'))
}
