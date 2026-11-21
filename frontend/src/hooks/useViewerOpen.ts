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
import { addFiles, getProject, setCrs, ViewerFileError } from '../viewer/store'

export function useViewerOpen(onOpen: (path: string | null) => void) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  return async (incoming: File[], crs: string | undefined, setBusy: (b: boolean) => void): Promise<boolean> => {
    if (!incoming.length) return false
    setBusy(true)
    // A review package (.zip from the desktop app) holds the model, its results and the CRS.
    const files: File[] = []
    for (const f of incoming) {
      if (!/\.zip$/i.test(f.name)) {
        files.push(f)
        continue
      }
      try {
        for (const e of await unzip(await f.arrayBuffer())) {
          const base = e.name.split('/').pop() ?? e.name
          if (base === 'saturday-swmm-review.json') {
            try {
              const m = JSON.parse(new TextDecoder().decode(e.data)) as { crs?: string }
              if (m.crs && !crs) crs = m.crs
            } catch {
              /* ignore a damaged manifest */
            }
          } else if (/\.(inp|rpt|out)$/i.test(base)) files.push(new File([e.data as BlobPart], base))
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
      if (ignored.length) toast({ title: 'Skipped files', description: `${ignored.join(', ')}: the viewer reads .inp, .rpt and .out files.`, tone: 'danger' })
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
        description: p.results[0]?.outName ? 'Results loaded: colours on the map show peak depth and flow.' : 'Add the .rpt and .out from a run to see results.',
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
