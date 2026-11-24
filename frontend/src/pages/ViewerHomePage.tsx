/**
 * Start page of the browser viewer: drop a model and its results, or open an
 * example, to edit and run it here. Files stay in this browser, never uploaded.
 */

import { openNewModel } from '../lib/newModel'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, FileText, FolderOpen, LibraryBig, Upload, X } from 'lucide-react'
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
  phl: ['philly-sanitary/philly-sanitary.inp', 'philly-sanitary/philly-sanitary-rehab.rpt', 'philly-sanitary/philly-sanitary-rehab.out', 'philly-sanitary/philly-sanitary.rpt', 'philly-sanitary/philly-sanitary.out'],
} as const

/** Background GIS layers some examples open with (GeoJSON in lon/lat, under examples/). */
const EXAMPLE_GIS: Partial<Record<keyof typeof EXAMPLES, { file: string; name: string; visible: boolean; style: GisLayerStyle }[]>> = {
  drexel: [
    { file: 'drexel/gis/buildings.geojson', name: 'Building footprints', visible: true, style: { color: '#6b7280', fill_opacity: 0.35, line_width: 0.5 } },
    { file: 'drexel/gis/drexel-parcels.geojson', name: 'Drexel parcels', visible: false, style: { color: '#3a86ff', fill_opacity: 0, line_width: 2, label_field: 'address' } },
    { file: 'drexel/gis/inlets.geojson', name: 'PWD inlets', visible: false, style: { color: '#2a9d8f', point_radius: 3 } },
  ],
  phl: [
    { file: 'philly-sanitary/gis/pennypack_creek.geojson', name: 'Pennypack Creek', visible: true, style: { color: '#38bdf8', line_width: 2.5 } },
    { file: 'philly-sanitary/gis/historic_streams.geojson', name: 'Buried streams (1842 survey)', visible: false, style: { color: '#a78bfa', line_width: 1.5 } },
  ],
}

/** Examples with two runs (a design and the alternative), opened named and ready to compare. */
const PAIRS: Partial<Record<keyof typeof EXAMPLES, { dir: string; stem: string; label: string; other: string; otherLabel: string; lid: boolean }>> = {
  lid: { dir: 'lid-sample', stem: 'lid-sample', label: 'With LID', other: '-nolid', otherLabel: 'No LID (fully impervious)', lid: true },
  drexel: { dir: 'drexel', stem: 'drexel', label: 'With LID', other: '-nolid', otherLabel: 'No LID (campus today)', lid: true },
  phl: { dir: 'philly-sanitary', stem: 'philly-sanitary', label: 'Existing system', other: '-rehab', otherLabel: 'Bustleton I/I reduction', lid: false },
}

/** The example cards: a picture of each network (examples/thumbs, drawn from its .inp) and what's in it. */
const EXAMPLE_CARDS: { key: keyof typeof EXAMPLES; thumb: string; title: string; place: string; size: string; about: string; tags: string[] }[] = [
  {
    key: 'lid', thumb: 'lid', title: 'LID sample', place: 'Philadelphia, United States', size: 'Under 1 MB',
    about: 'A small storm sewer with seven kinds of green infrastructure, run with and without them.',
    tags: ['7 pipes', 'LID controls', '2 runs to compare'],
  },
  {
    key: 'drexel', thumb: 'drexel', title: 'Drexel campus', place: 'Philadelphia, United States', size: 'About 6 MB',
    about: '97 Drexel University parcels with and without green roofs, permeable pavement and bioretention, on assumed pipes.',
    tags: ['114 links', 'LID controls', '2 runs to compare', 'GIS layers'],
  },
  {
    key: 'phl', thumb: 'philly-sanitary', title: 'Northeast Philadelphia sewers', place: 'Philadelphia, United States', size: 'About 20 MB',
    about: 'A separate sanitary system from Bustleton’s streets to the Northeast treatment plant: 144,000 people, dry-weather flow, RDII, pump stations, an equalization basin and control rules.',
    tags: ['780 links', 'Pumps, storage, rules', 'Dry-weather flow, RDII', '2 runs to compare'],
  },
  {
    key: '1d', thumb: 'bellinge', title: 'Bellinge', place: 'Odense, Denmark', size: 'About 22 MB',
    about: 'A real suburban network of about 1,000 pipes and 700 subcatchments, with results from a 24-hour EPA SWMM 5 run.',
    tags: ['1,044 links', 'Pumps, weirs, storage', 'Results'],
  },
  {
    key: '2d', thumb: 'bellinge-2d', title: 'Bellinge 2D flood', place: 'Odense, Denmark', size: 'About 14 MB',
    about: 'The same network with a 156,000-cell street surface mesh and flood depths from an OpenSWMM 6 run of the 29 June 2012 storm.',
    tags: ['2D surface mesh', 'Street flooding', 'OpenSWMM 6'],
  },
]

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
  const [opening, setOpening] = useState<keyof typeof EXAMPLES | null>(null)
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
      const pair = PAIRS[kind]
      const opened = await take(files, pair ? 'EPSG:2272' : 'EPSG:25832')
      // The two runs, named, and ready to compare.
      if (opened && pair) {
        const p = getProject()
        const nolid = p?.results.find((r) => r.rptName === `${pair.stem}${pair.other}.rpt`)
        const lid = p?.results.find((r) => r.rptName === `${pair.stem}.rpt`)
        if (lid) {
          await updateResult(lid.id, { label: pair.label })
        }
        if (lid && pair.lid) {
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
          await updateResult(nolid.id, { label: pair.otherLabel })
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

  const startExample = (k: keyof typeof EXAMPLES) => {
    setOpening(k)
    void openExample(k).finally(() => setOpening(null))
  }

  return (
    <div
      className="h-full overflow-y-auto"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setOver(false)
      }}
      onDrop={onDrop}
    >
      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-6 sm:py-12">
        <h1 className="m-0 text-2xl font-semibold tracking-[-0.01em] text-fg">Edit and run a SWMM model in your browser</h1>
        <p className="mb-7 mt-2 max-w-2xl text-[13.5px] leading-relaxed text-fg-soft">
          Draw a model on a map or open your own, run it with EPA SWMM 5.2, and review the results. Your files stay in this
          browser and are never uploaded.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={openNewModel}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-accent/40 bg-accent/[0.07] p-5 text-left transition-colors hover:border-accent hover:bg-accent/[0.12] disabled:opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
              <Plus className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-fg">New model</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-fg-soft">
                Start empty, choose units and where it is, then draw junctions, pipes and subcatchments on the map.
              </span>
            </span>
            <span className="mt-auto inline-flex h-8 items-center rounded-md bg-accent px-3 text-[12.5px] font-medium text-white group-hover:brightness-110">
              Create a model
            </span>
          </button>
          <div
            className={`flex flex-col items-start gap-3 rounded-2xl border-2 border-dashed p-5 transition-colors ${
              over ? 'border-accent bg-accent/10' : 'border-border-strong bg-elevated/40'
            }`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fg/[0.06] text-fg-soft">
              <Upload className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block text-[15px] font-semibold text-fg">{project ? 'Add files' : 'Open your files'}</span>
              <span className="mt-1 block text-[12.5px] leading-relaxed text-fg-soft">
                {project
                  ? 'Drop results (.rpt, .out), rain files (.dat) or a different model anywhere on this page.'
                  : <>Drop an <code>.inp</code> anywhere on this page, with the <code>.rpt</code> and <code>.out</code> from a run in EPA SWMM, PCSWMM or OpenSWMM, or a review package (.zip).</>}
              </span>
            </span>
            <Button className="mt-auto" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              <FolderOpen className="h-4 w-4" /> Choose files
            </Button>
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

        <section className="mt-10" aria-labelledby="examples-h">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="examples-h" className="m-0 text-[15px] font-semibold text-fg">Examples</h2>
            {project && <span className="text-[11.5px] text-muted">Opening one replaces the model open now</span>}
          </div>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {EXAMPLE_CARDS.map((x) => (
              <li key={x.key}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startExample(x.key)}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-elevated text-left transition-[border-color,box-shadow] hover:border-accent/60 hover:shadow-[var(--shadow-panel)] disabled:opacity-60"
                >
                  <span className="relative block aspect-[2/1] w-full overflow-hidden border-b border-border bg-[#eef2f5]">
                    <img src={`${import.meta.env.BASE_URL}examples/thumbs/${x.thumb}.svg`} alt="" className="example-thumb h-full w-full object-cover" loading="lazy" />
                    {opening === x.key && (
                      <span className="absolute inset-0 flex items-center justify-center bg-elevated/70 text-[12.5px] font-medium text-fg">Opening…</span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col p-3.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[14px] font-semibold text-fg group-hover:text-accent-soft">{x.title}</span>
                      <span className="shrink-0 text-[11.5px] text-muted">{x.size}</span>
                    </span>
                    <span className="text-[11.5px] text-muted">{x.place}</span>
                    <span className="mt-1.5 text-[12.5px] leading-relaxed text-fg-soft">{x.about}</span>
                    <span className="mt-2.5 flex flex-wrap gap-1.5">
                      {x.tags.map((t) => (
                        <span key={t} className="rounded-full bg-fg/[0.06] px-2 py-0.5 text-[11px] text-fg-soft">{t}</span>
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[11px] text-muted">
            Bellinge data: <a className="underline hover:text-fg" href="https://doi.org/10.11583/DTU.c.5029124">Pedersen et al. (2021)</a>, CC BY 4.0.
          </p>
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-border bg-elevated p-4" aria-label="Model library">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fg/[0.06] text-fg-soft">
            <LibraryBig className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-fg">Model library</span>
            <span className="block text-[12.5px] text-fg-soft">Search SWMM models kept on GitHub, including your own collections, and open one here.</span>
          </span>
          <Button variant="outline" onClick={() => navigate('/library')}>
            Browse the library
          </Button>
        </section>

        <section className="mt-10 grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <h2 className="m-0 mb-1 text-sm font-semibold text-fg">In the viewer</h2>
            <p className="m-0 text-fg-soft">
              Edit the model on the map, in tables or as text, with undo; scenarios that inherit, design storms and the
              scenario × storm run grid; run with EPA&nbsp;SWMM&nbsp;5.2; then peak results and playback, report tables,
              charts, profiles, run comparisons, saved versions, the Python console and project .zip files.
            </p>
          </div>
          <div>
            <h2 className="m-0 mb-1 text-sm font-semibold text-fg">In the desktop app</h2>
            <p className="m-0 text-fg-soft">
              2D flooding with OpenSWMM&nbsp;6, DEM and land-cover site data, Git, and models kept as files on your computer.
              Everything else works here too; what needs the desktop is shown greyed out. Free for Windows, or run it from source.{' '}
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
