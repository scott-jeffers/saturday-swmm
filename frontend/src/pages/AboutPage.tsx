import { DOWNLOAD_URL, IS_VIEWER } from '../lib/mode'
import { displayVersion } from '../lib/version'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Panel } from '../components/ui'
import { VersionPanelBody } from '../components/AppLifecycle'

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent-soft underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </a>
  )
}

function CiteRow({
  title,
  detail,
  links,
}: {
  title: string
  detail: string
  links: { href: string; label: string }[]
}) {
  return (
    <li className="border-t border-border pt-3 first:border-t-0 first:pt-0">
      <div className="text-sm font-medium text-fg">{title}</div>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{detail}</p>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {links.map((l) => (
          <li key={l.href}>
            <ExtLink href={l.href}>{l.label}</ExtLink>
          </li>
        ))}
      </ul>
    </li>
  )
}

export function AboutPage() {
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-fg">About</h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            Saturday-SWMM — what it is, how the pieces fit together, and credits for the tools and
            data it builds on.
          </p>
        </div>

        {IS_VIEWER && (
          <Panel title="The browser viewer">
            <div className="space-y-3 text-sm leading-relaxed text-fg-soft">
              <p className="m-0">
                This is the browser version of Saturday-SWMM (version {displayVersion(__APP_VERSION__)}). It reads SWMM{' '}
                <code>.inp</code>, <code>.rpt</code> and <code>.out</code> files inside your browser with the same logic as the
                desktop app, and runs 1D models with EPA SWMM 5.2 compiled to WebAssembly. Nothing is uploaded: your files stay in this browser’s storage until you close them on the start
                page.
              </p>
              <p className="m-0">
                Editing works here too: the map, tables, options, LID controls, control rules and the <code>.inp</code> text,
                with undo. It uses the desktop app’s own Python code, which starts in this tab on your first edit. Scenarios,
                design storms, 2D flooding and site data need the desktop app, which runs OpenSWMM&nbsp;6 or EPA&nbsp;SWMM&nbsp;5
                on your own computer.{' '}
                <a href={DOWNLOAD_URL} className="text-accent-soft hover:underline">
                  Download it
                </a>
                .
              </p>
              <p className="m-0 text-xs text-muted">License: GPL-3.0-or-later — Copyright (C) 2026 Scott Jeffers.</p>
            </div>
          </Panel>
        )}

        {!IS_VIEWER && (<>
        <Panel title="What is Saturday-SWMM?">
          <div className="space-y-3 text-sm leading-relaxed text-fg-soft">
            <p className="m-0">
              Saturday-SWMM is a local web app for urban drainage modeling: open a folder with a
              SWMM-compatible <code>.inp</code> file, edit the network on a map, configure storms and
              simulation options, run the solver on your machine, and explore results (time series,
              profiles, and optional 2D surface flooding).
            </p>
            <p className="m-0">
              The browser never loads the simulation engine. A small server on this computer
              (127.0.0.1 only) owns file I/O, GIS previews, and runs — with the{' '}
              <ExtLink href="https://pypi.org/project/openswmm/">OpenSWMM</ExtLink> engine or EPA
              SWMM 5 via <ExtLink href="https://github.com/pyswmm/pyswmm">PySWMM</ExtLink>. That
              keeps large models and binaries on disk while the UI stays in your browser.
            </p>
            <p className="m-0 text-xs text-muted">
              License: GPL-3.0-or-later — Copyright (C) 2026 Scott Jeffers.
            </p>
          </div>
        </Panel>

        <Panel title="Version & updates" id="updates">
          <VersionPanelBody />
        </Panel>

        <Panel title="For developers">
          <p className="m-0 text-[13px] text-fg-soft">
            The colours, type and components every screen uses are on the{' '}
            <Link to="/design" className="text-accent-soft hover:underline">
              design system page
            </Link>
            .
          </p>
        </Panel>

        <Panel title="How it works">
          <ol className="m-0 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-fg-soft">
            <li>
              <span className="font-medium text-fg">Projects</span> — Open or create a project
              folder. The app expects an <code>.inp</code> (and optional <code>.rpt</code> /{' '}
              <code>.out</code>, 2D mesh, and GIS layers under <code>gis/</code>).
            </li>
            <li>
              <span className="font-medium text-fg">Map &amp; Elements</span> — The Map workspace
              shows the 1D network (and 2D mesh when present). Select objects to inspect attributes;
              drag nodes to update <code>[COORDINATES]</code>. The Elements table is a bulk editor
              for the same objects.
            </li>
            <li>
              <span className="font-medium text-fg">Storm &amp; Settings</span> — Build design storms
              (e.g. NOAA Atlas 14 depths + SCS/Huff shapes) into SWMM rainfall <code>.dat</code>{' '}
              files, and set simulation window, routing steps, threads, and 2D options in Settings.
            </li>
            <li>
              <span className="font-medium text-fg">Run</span> — Header Run controls call the local
              API, which invokes OpenSWMM and writes results beside the INP. Live map coloring is
              optional while a run is in progress.
            </li>
            <li>
              <span className="font-medium text-fg">Results</span> — Scrub report periods on the map,
              plot node/link series, view longitudinal profiles, and read the report text. Background
              DEM / shapefile layers are ingested on the backend and shown as map previews.
            </li>
          </ol>
          <p className="mt-4 mb-0 text-xs text-muted">
            Typical stack: React + Vite + MapLibre in the frontend; FastAPI + OpenSWMM (+ rasterio /
            geopandas and related GIS libs) in the backend. Vite proxies <code>/api</code> to port
            8000 during development.
          </p>
        </Panel>
        </>)}

        <Panel title="Core resources &amp; citations">
          <ul className="m-0 list-none space-y-0 p-0">
            <CiteRow
              title="OpenSWMM Engine"
              detail="Local simulation backend (openswmm Python package). Community continuation of EPA SWMM by Caleb Buahin / HydroCouple. MIT license. Original EPA SWMM material is in the U.S. public domain."
              links={[
                { href: 'https://github.com/HydroCouple/openswmm.engine', label: 'GitHub' },
                { href: 'https://pypi.org/project/openswmm/', label: 'PyPI' },
                {
                  href: 'https://www.epa.gov/water-research/storm-water-management-model-swmm',
                  label: 'EPA SWMM',
                },
              ]}
            />
            <CiteRow
              title="Bellinge example data"
              detail="Pedersen et al. (2021), The Bellinge data set: open data and models for community-wide urban drainage systems research. CC BY 4.0. Example folders in this repo may be modified derivatives."
              links={[
                {
                  href: 'https://doi.org/10.5194/essd-13-2879-2021',
                  label: 'ESSD article',
                },
                {
                  href: 'https://doi.org/10.11583/DTU.c.5029124',
                  label: 'DTU Data',
                },
                {
                  href: 'https://creativecommons.org/licenses/by/4.0/',
                  label: 'CC BY 4.0',
                },
              ]}
            />
            <CiteRow
              title="NOAA Atlas 14 (Precipitation Frequency)"
              detail="Point precipitation frequency estimates used by the Storm workspace (PFDS) when building design hyetographs for U.S. locations."
              links={[
                {
                  href: 'https://hdsc.nws.noaa.gov/pfds/',
                  label: 'NOAA PFDS',
                },
              ]}
            />
            <CiteRow
              title="MapLibre GL JS"
              detail="Map rendering for the network, basemaps, and result overlays. BSD-3-Clause."
              links={[
                { href: 'https://maplibre.org/', label: 'maplibre.org' },
                {
                  href: 'https://github.com/maplibre/maplibre-gl-js',
                  label: 'GitHub',
                },
              ]}
            />
            <CiteRow
              title="Basemap data"
              detail="OpenStreetMap tiles (ODbL) and Esri World Imagery / reference overlays when those basemap styles are selected. Follow each provider’s terms of use."
              links={[
                {
                  href: 'https://www.openstreetmap.org/copyright',
                  label: 'OpenStreetMap copyright',
                },
                {
                  href: 'https://www.esri.com/en-us/legal/terms/full-master-agreement',
                  label: 'Esri terms',
                },
              ]}
            />
            <CiteRow
              title="Frontend stack"
              detail="React, Vite, TypeScript, TanStack Query, Tailwind CSS, Radix UI, Lucide, Monaco Editor, Recharts, Turf.js, proj4, react-map-gl."
              links={[
                { href: 'https://react.dev/', label: 'React' },
                { href: 'https://vite.dev/', label: 'Vite' },
                { href: 'https://tanstack.com/query', label: 'TanStack Query' },
                { href: 'https://tailwindcss.com/', label: 'Tailwind' },
              ]}
            />
            <CiteRow
              title="Backend &amp; GIS"
              detail="FastAPI, Uvicorn, Pydantic; GIS via rasterio, pyogrio, shapely, pyproj, geopandas, Pillow, h5py (and related wheels). Licenses remain with each upstream project."
              links={[
                { href: 'https://fastapi.tiangolo.com/', label: 'FastAPI' },
                { href: 'https://rasterio.readthedocs.io/', label: 'rasterio' },
                { href: 'https://geopandas.org/', label: 'GeoPandas' },
              ]}
            />
          </ul>
          <p className="mb-0 mt-4 text-xs text-muted">
            Full third-party notices live in the repository{' '}
            <code>NOTICE.md</code>. Example-specific attribution is under{' '}
            <code>examples/*/ATTRIBUTION.md</code>.
          </p>
        </Panel>
      </div>
    </div>
  )
}
