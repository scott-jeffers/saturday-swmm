/**
 * Open files in the browser viewer: a model, its results, or a review package
 * (.zip). Shared by the start page and the model library.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/ui'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { unzip } from '../lib/unzip'
import { lookupCrs } from '../viewer/router'
import { addFiles, getProject, RAIN_FILE, setCrs, setProjectFiles, ViewerFileError } from '../viewer/store'

export function useViewerOpen(onOpen: (path: string | null) => void) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  return async (incoming: File[], crs: string | undefined, setBusy: (b: boolean) => void): Promise<boolean> => {
    if (!incoming.length) return false
    setBusy(true)
    // A review package (.zip from the desktop app) holds the model, its results and the CRS.
    const files: File[] = []
    // A whole project folder (.zip from the desktop's History, or from Save here): scenarios, storms, versions.
    const folder: Record<string, Uint8Array> = {}
    for (const f of incoming) {
      if (!/\.zip$/i.test(f.name)) {
        files.push(f)
        continue
      }
      try {
        const entries = (await unzip(await f.arrayBuffer())).filter((e) => !e.name.endsWith('/'))
        // Drop one top folder that holds everything ("Drexel_Campus/…").
        const tops = new Set(entries.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')))
        const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : ''
        for (const e0 of entries) {
          const e = { ...e0, name: e0.name.slice(strip.length) }
          const base = e.name.split('/').pop() ?? e.name
          if (e.name.includes('/') || (!/\.(inp|rpt|out)$/i.test(base) && !RAIN_FILE.test(base) && base !== 'saturday-swmm-review.json')) {
            // Kept with the project: scenarios, storms, versions, notes, settings. Results, LID reports
            // and other hidden run folders, GIS and source data stay out (GIS layers are added on the map).
            const dirs = e.name.split('/').slice(0, -1)
            if (!/\.(out|rpt)$/i.test(base) && !dirs.some((d) => d.startsWith('.')) && !['gis', 'source', 'runs'].includes(dirs[0] ?? '')) folder[e.name] = e.data
            continue
          }
          if (base === 'saturday-swmm-review.json') {
            try {
              const m = JSON.parse(new TextDecoder().decode(e.data)) as { crs?: string }
              if (m.crs && !crs) crs = m.crs
            } catch {
              /* ignore a damaged manifest */
            }
          } else if (/\.(inp|rpt|out)$/i.test(base) || RAIN_FILE.test(base)) files.push(new File([e.data as BlobPart], base))
        }
      } catch (err) {
        toast({ title: `Couldn’t read ${f.name}`, description: (err as Error).message, tone: 'danger' })
      }
    }
    if (!files.length) {
      setBusy(false)
      return false
    }
    const hadModel = Boolean(getProject())
    try {
      const { added, ignored } = await addFiles(files)
      if (Object.keys(folder).length && added.some((n) => /\.inp$/i.test(n))) {
        // Open on Base: the editor switches to a scenario when asked.
        const st = folder['.saturday-swmm.json']
        if (st) {
          try {
            const j = JSON.parse(new TextDecoder().decode(st)) as Record<string, unknown>
            j.active_scenario = 'base'
            folder['.saturday-swmm.json'] = new TextEncoder().encode(JSON.stringify(j, null, 1))
          } catch {
            /* a damaged settings file is dropped */
            delete folder['.saturday-swmm.json']
          }
        }
        await setProjectFiles(folder)
      }
      if (ignored.length) toast({ title: 'Skipped files', description: `${ignored.join(', ')}: the viewer reads .inp, .rpt and .out files and rain files (.dat).`, tone: 'danger' })
      if (!added.length) return false
      if (crs) {
        const row = await lookupCrs(crs).catch(() => null)
        if (row) await setCrs(`EPSG:${row[0]}`, row[3])
      }
      onOpen('browser')
      invalidateProjectQueries(qc)
      void qc.invalidateQueries()
      const p = getProject()!
      const newModel = files.some((f) => /\.inp$/i.test(f.name))
      toast({
        title: newModel ? `Opened ${p.inpName}` : `Added ${added.join(', ')}`,
        description: !newModel && added.every((n) => RAIN_FILE.test(n)) ? 'Rain gages that read it now show its rainfall.' : p.results[0]?.outName ? 'Results loaded: colours on the map show peak depth and flow.' : 'Add the .rpt and .out from a run to see results.',
        tone: 'success',
      })
      if (newModel || !hadModel) navigate('/map')
      return true
    } catch (e) {
      toast({ title: 'Couldn’t open those files', description: e instanceof ViewerFileError ? e.message : (e as Error).message, tone: 'danger' })
      return false
    } finally {
      setBusy(false)
    }
  }
}
