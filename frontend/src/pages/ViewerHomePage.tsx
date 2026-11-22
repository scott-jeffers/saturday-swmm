/**
 * Start page of the browser viewer: drop a model and its results, or open the
 * example. Files are read in this browser and never uploaded.
 */

import { useQueryClient } from '@tanstack/react-query'
import { FileText, FolderOpen, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, useToast } from '../components/ui'
import { DOWNLOAD_URL } from '../lib/mode'
import { addGisVectorLayer, closeProject, getProject, setLidReports, subscribe, updateResult } from '../viewer/store'
import { setCompareTarget } from '../lib/compare'
import { useViewerOpen } from '../hooks/useViewerOpen'
import type { GisLayerStyle } from '../api/client'

const EXAMPLES = {
  // The No LID run first: each result set goes in front, and With LID (this .inp) should end up current.
  lid: ['lid-sample/lid-sample.inp', 'lid-sample/lid-sample-nolid.rpt', 'lid-sample/lid-sample-nolid.out', 'lid-sample/lid-sample.rpt', 'lid-sample/lid-sample.out'],
  '1d': ['bellinge.inp', 'bellinge.rpt', 'bellinge.out'],
  '2d': ['bellinge-2d/bellinge-2d.inp', 'bellinge-2d/bellinge-2d.rpt', 'bellinge-2d/bellinge-2d.out', 'bellinge-2d/bellinge-2d.ss2d.gz'],
  drexel: ['drexel/drexel.inp', 'drexel/drexel-nolid.rpt', 'drexel/drexel-nolid.out', 'drexel/drexel.rpt', 'drexel/drexel.out'],
} as const

/** Background GIS layers some examples open with (GeoJSON in lon/lat, under examples/). */
const EXAMPLE_GIS: Partial<Record<keyof typeof EXAMPLES, { file: string; name: string; visible: boolean; style: GisLayerStyle }[]>> = {
  drexel: [
    { file: 'drexel/gis/buildings.geojson', name: 'Building footprints', visible: true, style: { color: '#6b7280', fill_opacity: 0.35, line_width: 0.5 } },
    { file: 'drexel/gis/drexel-parcels.geojson', name: 'Drexel parcels', visible: false, style: { color: '#3a86ff', fill_opacity: 0, line_width: 2, label_field: 'address' } },
    { file: 'drexel/gis/inlets.geojson', name: 'PWD inlets', visible: false, style: { color: '#2a9d8f', point_radius: 3 } },
  ],
}

/** Examples with a With LID and a No LID run, opened ready to compare. */
const LID_PAIRS: Partial<Record<keyof typeof EXAMPLES, { dir: string; stem: string; noLidLabel: string }>> = {
  lid: { dir: 'lid-sample', stem: 'lid-sample', noLidLabel: 'No LID (fully impervious)' },
  drexel: { dir: 'drexel', stem: 'drexel', noLidLabel: 'No LID (campus today)' },
}

function fmtSize(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`
}

export function ViewerHomePage({ onOpen }: { onOpen: (path: string | null) => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const openFiles = useViewerOpen(onOpen)
  const project = useSyncExternalStore(subscribe, getProject)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // A model kept from an earlier visit counts as open, so the map and every page work straight away.
  useEffect(() => {
    if (project) onOpen('browser')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(project)])

  const take = (incoming: File[], crs?: string) => openFiles(incoming, crs, setBusy)

  const openExample = async (kind: keyof typeof EXAMPLES) => {
    setBusy(true)
    try {
      const files = await Promise.all(
        EXAMPLES[kind].map(async (path) => {
          const r = await fetch(`${import.meta.env.BASE_URL}examples/${path}`)
          const name = path.split('/').pop()!
          if (!r.ok) throw new Error(`Couldn’t load ${name}`)
          return new File([await r.blob()], name)
        }),
      )
      // Bellinge, Odense (Denmark): ETRS89 / UTM 32N; the Philadelphia examples are in Pennsylvania South (ft)
      const pair = LID_PAIRS[kind]
      const opened = await take(files, pair ? 'EPSG:2272' : 'EPSG:25832')
      // The two runs, named, and ready to compare.
      if (opened && pair) {
        const p = getProject()
        const nolid = p?.results.find((r) => r.rptName === `${pair.stem}-nolid.rpt`)
        const lid = p?.results.find((r) => r.rptName === `${pair.stem}.rpt`)
        if (lid) {
          await updateResult(lid.id, { label: 'With LID' })
          // Each LID unit's own report (its time series), for Graphs → LID units.
          try {
            const base = `${import.meta.env.BASE_URL}examples/${pair.dir}/${pair.stem}.lid/`
            const names: string[] = await fetch(`${base}index.json`).then((r) => r.json())
            const reports = await Promise.all(names.map(async (name) => ({ name, text: await fetch(base + name).then((r) => r.text()) })))
            await setLidReports(lid.id, reports)
          } catch {
            /* the example still opens without them */
          }
        }
        if (nolid) {
          await updateResult(nolid.id, { label: pair.noLidLabel })
          setCompareTarget(nolid.id, 'This browser')
        }
        for (const g of EXAMPLE_GIS[kind] ?? []) {
          try {
            const fc = await fetch(`${import.meta.env.BASE_URL}examples/${g.file}`).then((r) => r.json())
            await addGisVectorLayer(g.name, fc, { visible: g.visible, style: g.style })
          } catch {
            /* the example still opens without it */
          }
        }
        await qc.invalidateQueries()
      }
    } catch (e) {
      toast({ title: 'Couldn’t open the example', description: (e as Error).message, tone: 'danger' })
      setBusy(false)
    }
  }

  // Header → Model → Examples: /?example=<kind>
  const [search, setSearch] = useSearchParams()
  const exampleParam = search.get('example')
  useEffect(() => {
    if (!exampleParam || !(exampleParam in EXAMPLES) || busy) return
    setSearch({}, { replace: true })
    void openExample(exampleParam as keyof typeof EXAMPLES)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exampleParam])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void take([...e.dataTransfer.files])
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="m-0 text-2xl font-semibold text-fg">View a SWMM model in your browser</h1>
        <p className="mb-8 mt-2 max-w-2xl text-sm text-fg-soft">
          Open an <code>.inp</code> to see the network on a map, its properties and every section. Add the{' '}
          <code>.rpt</code> and <code>.out</code> from a run, from EPA SWMM 5, PCSWMM, OpenSWMM or Saturday-SWMM, for the run
          summary, peak colours, charts and profiles. Your files are read here and never leave this computer.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            over ? 'border-accent bg-accent/10' : 'border-border-strong bg-elevated/40'
          }`}
        >
          <Upload className="h-7 w-7 text-muted" aria-hidden />
          <p className="m-0 text-sm text-fg">
            {project ? 'Drop more results (.rpt, .out), rain files (.dat) or a different model' : 'Drop your .inp here, with its .rpt and .out, or a review package (.zip)'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>
              <FolderOpen className="h-4 w-4" /> Choose files
            </Button>
            {(
              <>
                <Button variant="outline" disabled={busy} onClick={() => void openExample('1d')}>
                  {busy ? 'Loading…' : 'Bellinge example'}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void openExample('2d')}>
                  {busy ? 'Loading…' : 'Bellinge 2D flood example'}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void openExample('lid')}>
                  {busy ? 'Loading…' : 'LID example'}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void openExample('drexel')}>
                  {busy ? 'Loading…' : 'Drexel campus LID example'}
                </Button>
              </>
            )}
          </div>
          {(
            <p className="m-0 max-w-md text-[11px] text-muted">
              {project ? 'Opening an example replaces the model that is open now. ' : ''}Bellinge is a suburb of Odense, Denmark: about 1,000 pipes, 700 subcatchments, pumps, weirs and storage. The
              first example has results from a 24-hour EPA SWMM 5 run (about 22 MB). The 2D one adds a 156,000-cell street
              surface mesh and flood depths from an OpenSWMM 6 run of the storm of 29 June 2012 (about 14 MB). The LID example is a
              small Philadelphia sewer with seven kinds of green infrastructure (under 1 MB). The Drexel example models 97 Drexel University parcels in Philadelphia with and without green roofs, permeable pavement and bioretention, on assumed pipes (about 6 MB). Bellinge data:{' '}
              <a className="underline hover:text-fg" href="https://doi.org/10.11583/DTU.c.5029124">Pedersen et al. (2021)</a>, CC BY 4.0.
            </p>
          )}
          <input
            ref={input}
            type="file"
            multiple
            accept=".inp,.rpt,.out,.zip,.ss2d,.gz,.dat,.txt,.rain,.prn,.tsf"
            className="hidden"
            onChange={(e) => {
              void take([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </div>

        {project && (
          <section className="mt-8 rounded-xl border border-border bg-elevated/60 p-4" aria-label="Open files">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="m-0 text-sm font-semibold text-fg">{project.inpName}</h2>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    // Files saved in the browser from an earlier visit: mark the model open, then show it.
                    onOpen('browser')
                    navigate('/map')
                  }}
                >
                  Show on the map
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void closeProject().then(() => {
                      onOpen(null)
                      qc.clear()
                    })
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Close
                </Button>
              </div>
            </div>
            {project.results.length === 0 ? (
              <p className="m-0 text-xs text-muted">No results yet. Drop the .rpt and .out from a run to add them.</p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-0 text-xs">
                {project.results.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-2 text-fg-soft">
                    <FileText className="h-3.5 w-3.5 text-muted" aria-hidden />
                    <span>{[r.rptName, r.outName].filter(Boolean).join(' + ')}</span>
                    {r.outBuf && <span className="text-muted">{fmtSize(r.outBuf.byteLength)}</span>}
                    {i === 0 && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent-soft">shown</span>}
                  </li>
                ))}
              </ul>
            )}
            {project.results.length > 1 && (
              <p className="mb-0 mt-2 text-[11px] text-muted">The newest results are shown. Compare any two under Results → Compare runs.</p>
            )}
          </section>
        )}

        <section className="mt-10 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <h2 className="m-0 mb-1 text-sm font-semibold text-fg">In the viewer</h2>
            <p className="m-0 text-fg-soft">
              Edit the model on the map, in tables or as text, with undo; run it with EPA&nbsp;SWMM&nbsp;5.2; then see peak
              results and playback, report tables, charts, profiles, Check model, run comparisons and CSV or GeoJSON export.
            </p>
          </div>
          <div>
            <h2 className="m-0 mb-1 text-sm font-semibold text-fg">In the desktop app</h2>
            <p className="m-0 text-fg-soft">
              Scenarios and design-storm grids, NOAA rainfall, 2D flooding with OpenSWMM&nbsp;6, DEM and land-cover site data,
              and models kept as files on your computer. Free for Windows, or run it from source.{' '}
              <a href={DOWNLOAD_URL} className="text-accent-soft hover:underline">
                Get it
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
