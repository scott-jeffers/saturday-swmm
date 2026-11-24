/**
 * The online project as files, the way the desktop app keeps a project folder:
 * the base model, scenarios, storms, versions, notes and settings, rain files and,
 * for a review package, the current results.
 */
import { makeZip } from '../lib/zip'
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
