/**
 * Start a new model: name, where it lives (desktop), units, infiltration,
 * routing, coordinate system and start date. The desktop app writes a folder
 * with the .inp; the browser viewer keeps it in this browser. Either way it
 * opens on the map, in Edit mode, ready to draw.
 */
import { useQueryClient } from '@tanstack/react-query'
import { FolderSearch } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useViewerOpen } from '../hooks/useViewerOpen'
import { markUnsaved } from './SaveButton'
import { FLOW_UNITS, INFILTRATION, renderBlankInp, ROUTING } from '../lib/blankInp'
import { IS_VIEWER } from '../lib/mode'
import { openMapInEditNext } from '../lib/newModel'
import { setPref } from '../lib/prefs'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { CrsPicker } from './CrsPicker'
import { Button, Dialog, DialogContent, useToast } from './ui'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const FLOW_LABEL: Record<string, string> = { CFS: 'ft³/s (CFS)', GPM: 'gal/min (GPM)', MGD: 'Mgal/day (MGD)', CMS: 'm³/s (CMS)', LPS: 'L/s (LPS)', MLD: 'ML/day (MLD)' }

export function NewModelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Desktop: the new project's folder, to make it the active project. */
  onCreated: (path: string) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const viewerOpen = useViewerOpen((p) => p && onCreated(p))
  const [name, setName] = useState('New model')
  const [folder, setFolder] = useState('')
  const [units, setUnits] = useState<'us' | 'si'>('us')
  const [flow, setFlow] = useState('CFS')
  const [infil, setInfil] = useState('HORTON')
  const [routing, setRouting] = useState('DYNWAVE')
  const [crs, setCrs] = useState('')
  const [start, setStart] = useState(today())
  const [busy, setBusy] = useState(false)

  const fileName = name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'model'
  const pickUnits = (u: 'us' | 'si') => {
    setUnits(u)
    setFlow(FLOW_UNITS[u][0])
  }
  const browse = async () => {
    try {
      const r = await api.browseFolder('Where should the new model’s folder go?', true)
      if (!r.cancelled && r.path) setFolder(r.path)
    } catch (e) {
      toast({ title: 'Folder picker unavailable', description: `${(e as Error).message}. Type the folder path instead.`, tone: 'danger' })
    }
  }
  // The model gets its own folder inside the one picked (unless that's already empty and named for it).
  const target = folder.trim() ? `${folder.trim().replace(/[\\/]+$/, '')}${folder.includes('\\') ? '\\' : '/'}${fileName}` : ''

  const create = async () => {
    setBusy(true)
    try {
      if (IS_VIEWER) {
        const text = renderBlankInp({ title: name.trim() || 'New model', flowUnits: flow, infiltration: infil, routing, startDate: start })
        // Made here, never saved to the computer: Save shows as needed.
        markUnsaved(`${fileName}.inp`)
        const ok = await viewerOpen([new File([text], `${fileName}.inp`)], crs || undefined, () => undefined)
        if (!ok) return
      } else {
        if (!target) {
          toast({ title: 'Choose where the model goes', tone: 'danger' })
          return
        }
        const info = await api.createProject(target, `${fileName}.inp`, { flow_units: flow, infiltration: infil, routing, start_date: start, crs: crs || null })
        onCreated(info.path)
        invalidateProjectQueries(qc)
      }
      // A new model is for drawing: open the map in Edit mode.
      setPref('map-mode', 'edit')
      setPref('workspace-view', 'map')
      // A brand-new model starts flat and empty (no background, no 3D buildings) until changed in Layers.
      setPref('map-fresh-model', '1')
      openMapInEditNext()
      onOpenChange(false)
      navigate('/map')
      toast({ title: `Created ${fileName}.inp`, description: 'Draw junctions, outfalls and conduits with the tools on the map.', tone: 'success' })
    } catch (e) {
      toast({ title: 'Couldn’t create the model', description: (e as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New model"
        description={IS_VIEWER ? 'An empty SWMM model in this browser, ready to draw on the map.' : 'A folder with an empty SWMM model, ready to draw on the map.'}
        className="w-[min(560px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <div className="space-y-3.5 text-[12.5px]">
          <label className="block font-medium text-fg-soft">
            Name
            <input className="field mt-1 w-full" value={name} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setName(e.target.value)} />
            <span className="mt-0.5 block text-[11.5px] font-normal text-muted">Saved as {fileName}.inp</span>
          </label>
          {!IS_VIEWER && (
            <label className="block font-medium text-fg-soft">
              In folder
              <span className="mt-1 flex gap-2">
                <input className="field min-w-0 flex-1" value={folder} placeholder="C:\Users\you\Models" onChange={(e) => setFolder(e.target.value)} />
                <Button variant="outline" type="button" onClick={() => void browse()}>
                  <FolderSearch className="h-3.5 w-3.5" /> Browse…
                </Button>
              </span>
              {target && <span className="mt-0.5 block truncate text-[11.5px] font-normal text-muted">Creates {target}</span>}
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="block font-medium text-fg-soft">Units</span>
              <div className="mt-1 flex rounded-md bg-fg/[0.06] p-0.5" role="radiogroup" aria-label="Units">
                {(
                  [
                    ['us', 'US customary'],
                    ['si', 'Metric (SI)'],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={units === k}
                    onClick={() => pickUnits(k)}
                    className={`h-7 flex-1 rounded text-[12px] ${units === k ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <label className="block font-medium text-fg-soft">
              Flow in
              <select className="field mt-1 w-full" value={flow} onChange={(e) => setFlow(e.target.value)}>
                {FLOW_UNITS[units].map((f) => (
                  <option key={f} value={f}>
                    {FLOW_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-medium text-fg-soft">
              Infiltration
              <select className="field mt-1 w-full" value={infil} onChange={(e) => setInfil(e.target.value)}>
                {INFILTRATION.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block font-medium text-fg-soft">
              Simulation starts
              <input type="date" className="field mt-1 w-full" value={start} onChange={(e) => setStart(e.target.value)} />
              <span className="mt-0.5 block text-[11.5px] font-normal text-muted">Runs for one day; change it in Simulation options.</span>
            </label>
          </div>
          <label className="block font-medium text-fg-soft">
            Flow routing
            <select className="field mt-1 w-full" value={routing} onChange={(e) => setRouting(e.target.value)}>
              {ROUTING.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="block font-medium text-fg-soft">Coordinate system</span>
            <CrsPicker value={crs} onChange={setCrs} compact className="mt-1" />
            <span className="mt-0.5 block text-[11.5px] font-normal text-muted">
              So the model sits on the basemap. A State Plane or UTM zone is typical; leave blank to choose later.
            </span>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || (!IS_VIEWER && !target)} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create model'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
