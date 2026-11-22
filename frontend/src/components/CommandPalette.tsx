/** Ctrl+K: jump to any page, element or action. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Search } from 'lucide-react'
import { api, type ModelNetwork } from '../api/client'
import { focusOnMap } from '../lib/mapFocus'
import { setPref } from '../lib/prefs'
import { IS_VIEWER } from '../lib/mode'
import { cn } from '../lib/cn'

type Cmd = { id: string; label: string; group: string; hint?: string; run: () => void }

export const appEvent = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(`saturday-swmm-${name}`, { detail }))

export function CommandPalette({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const listRef = useRef<HTMLUListElement>(null)
  const network = useQuery<ModelNetwork>({ queryKey: ['network'], queryFn: () => api.getNetwork(), enabled: enabled && open })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('saturday-swmm-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('saturday-swmm-palette', onOpen)
    }
  }, [])

  const commands = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => navigate(to)
    const pages: Cmd[] = [
      { id: 'p-projects', label: IS_VIEWER ? 'Open files' : 'Projects', group: 'Go to', run: go('/') },
      ...(enabled
        ? [
            { id: 'p-overview', label: 'Overview', group: 'Go to', run: go('/overview') },
            { id: 'p-map', label: 'Map', group: 'Go to', run: go('/map') },
            { id: 'p-table', label: 'Elements', group: 'Go to', run: go('/table') },
            { id: 'p-data', label: 'INP viewer', group: 'Go to', run: go('/data') },
            { id: 'p-lid', label: 'LID controls', group: 'Go to', run: go('/lid') },
            ...(IS_VIEWER ? [{ id: 'p-library', label: 'Model library', group: 'Go to', run: go('/library') }] : []),
            { id: 'p-manual', label: 'SWMM manual (opens a new tab)', group: 'Go to', run: () => window.open('https://swmm-manual.netlify.app/', '_blank', 'noopener') },
            ...(IS_VIEWER ? [] : [{ id: 'p-storm', label: 'Rainfall', group: 'Go to', run: go('/storm') }, { id: 'p-site', label: 'GIS site data: USGS DEM, NLCD impervious, SSURGO soils', group: 'Go to', run: go('/site-data') }]),
            { id: 'p-editor', label: 'INP viewer: text', group: 'Go to', run: go('/data?view=text') },
            { id: 'p-results', label: 'Results', group: 'Go to', run: go('/results') },
            { id: 'p-calib', label: 'Calibration and sensitivity', group: 'Go to', run: go('/results') },
            { id: 'p-report', label: 'Report (print or PDF)', group: 'Go to', run: go('/report') },
            ...(IS_VIEWER
              ? []
              : [
                  { id: 'p-scen', label: 'Scenarios', group: 'Go to', run: go('/scenarios') },
                  { id: 'p-console', label: 'Python console', group: 'Go to', run: go('/console') },
                ]),
            { id: 'p-settings', label: 'Simulation options', group: 'Go to', run: go('/settings') },
          ]
        : []),
      { id: 'p-about', label: 'About and updates', group: 'Go to', run: go('/about') },
    ]
    const mode = (m: string) => () => {
      setPref('map-mode', m)
      appEvent('map-mode', m)
      navigate('/map')
    }
    const actions: Cmd[] = enabled
      ? [
          ...(IS_VIEWER
            ? []
            : [
                { id: 'a-run', label: 'Run the model', group: 'Actions', hint: 'Ctrl+Enter', run: () => appEvent('run') },
                { id: 'a-check', label: 'Check the model', group: 'Actions', hint: 'Ctrl+Shift+K', run: () => appEvent('check') },
                { id: 'a-undo', label: 'Undo', group: 'Actions', hint: 'Ctrl+Z', run: () => appEvent('undo') },
                { id: 'a-redo', label: 'Redo', group: 'Actions', hint: 'Ctrl+Shift+Z', run: () => appEvent('redo') },
                {
                  id: 'a-snap',
                  label: 'Save a snapshot of the model',
                  group: 'Actions',
                  run: () =>
                    void api.createSnapshot(`Snapshot ${new Date().toLocaleString()}`).then(() => qc.invalidateQueries({ queryKey: ['snapshots'] })),
                },
                { id: 'm-edit', label: 'Map: Edit mode', group: 'Actions', run: mode('edit') },
                {
                  id: 'a-lengths',
                  label: 'Set every conduit length from the map',
                  group: 'Actions',
                  run: () =>
                    void api.networkTool('lengths', {}).then(() => {
                      for (const k of ['network', 'inp', 'object', 'edits', 'project']) void qc.invalidateQueries({ queryKey: [k] })
                    }),
                },
                { id: 'a-share', label: 'Download a review package (.zip) for the browser viewer', group: 'Actions', run: () => window.open('/api/projects/package', '_self') },
              ]),
          { id: 'm-results', label: 'Map: Results mode', group: 'Actions', run: mode('results') },
          { id: 'm-review', label: 'Map: Review mode (design checks)', group: 'Actions', run: mode('review') },
        ]
      : []
    const general: Cmd[] = [
      { id: 'g-theme', label: 'Switch light / dark theme', group: 'Actions', run: () => appEvent('toggle-theme') },
      { id: 'g-sidebar', label: 'Collapse or expand the sidebar', group: 'Actions', run: () => appEvent('toggle-sidebar') },
      { id: 'g-keys', label: 'Keyboard shortcuts', group: 'Actions', hint: '?', run: () => window.dispatchEvent(new Event('saturday-swmm-shortcuts')) },
    ]
    return [...pages, ...actions, ...general]
  }, [enabled, navigate, qc])

  const elements = useMemo<Cmd[]>(() => {
    const t = q.trim().toLowerCase()
    if (!t || !network.data) return []
    const out: Cmd[] = []
    for (const f of network.data.geojson.features) {
      const id = String(f.properties?.id ?? '')
      const ot = f.properties?.object_type as 'node' | 'link' | 'subcatchment' | undefined
      if (!ot || !['node', 'link', 'subcatchment'].includes(ot) || !id.toLowerCase().includes(t)) continue
      const kind = String(f.properties?.node_kind ?? f.properties?.link_kind ?? 'subcatchment')
      out.push({
        id: `e-${ot}-${id}`,
        label: id,
        hint: kind,
        group: 'Elements',
        run: () => {
          focusOnMap({ object_type: ot, id })
          navigate('/map')
        },
      })
      if (out.length >= 30) break
    }
    // exact matches first
    return out.sort((a, b) => Number(b.label.toLowerCase() === t) - Number(a.label.toLowerCase() === t))
  }, [q, network.data, navigate])

  const t = q.trim().toLowerCase()
  const shown = [...elements, ...commands.filter((c) => !t || c.label.toLowerCase().includes(t) || c.group.toLowerCase().includes(t))]
  const pick = (c: Cmd | undefined) => {
    if (!c) return
    setOpen(false)
    setQ('')
    c.run()
  }
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let lastGroup = ''
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[14vh] z-[91] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-panel)] outline-none"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => Math.min(shown.length - 1, a + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => Math.max(0, a - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  pick(shown[active])
                }
              }}
              placeholder={enabled ? 'Search pages, actions or element IDs…' : 'Search pages and actions…'}
              className="h-11 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
              aria-label="Command"
            />
            <kbd className="rounded border border-border px-1.5 text-[10px] text-muted">Esc</kbd>
          </div>
          <ul ref={listRef} className="m-0 max-h-[50vh] list-none overflow-y-auto p-1.5">
            {shown.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null
              lastGroup = c.group
              return (
                <li key={c.id}>
                  {header && <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-muted">{header}</div>}
                  <button
                    type="button"
                    data-i={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(c)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]', i === active ? 'bg-accent/15 text-fg' : 'text-fg-soft')}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="text-[11px] capitalize text-muted">{c.hint}</span>}
                  </button>
                </li>
              )
            })}
            {!shown.length && <li className="px-2 py-3 text-[13px] text-muted">Nothing matches “{q}”.</li>}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
