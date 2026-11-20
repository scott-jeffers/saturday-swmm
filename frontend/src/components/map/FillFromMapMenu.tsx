import { ChevronDown, Mountain, Ruler, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { Button, Dialog, DialogContent } from '../ui'

/**
 * Edit-toolbar menu for values the map already knows: conduit lengths from the
 * drawn geometry, and junction/storage rims from a DEM.
 * Both work on the selection when it has the right elements, else on all.
 */
export function FillFromMapMenu({
  selectedLinks,
  selectedNodes,
  hasDem,
  usUnits,
  onLengths,
  onRims,
}: {
  selectedLinks: string[]
  selectedNodes: string[]
  hasDem: boolean
  usUnits: boolean
  onLengths: (links: string[]) => void
  onRims: (nodes: string[], demUnit: 'm' | 'ft') => void
}) {
  const [open, setOpen] = useState(false)
  const [rimOpen, setRimOpen] = useState(false)
  const [unit, setUnit] = useState<'m' | 'ft'>(usUnits ? 'ft' : 'm')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => setUnit(usUnits ? 'ft' : 'm'), [usUnits])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  const linkScope = selectedLinks.length ? `${selectedLinks.length} selected` : 'all conduits'
  const nodeScope = selectedNodes.length ? `${selectedNodes.length} selected` : 'all junctions and storage'

  return (
    <div ref={ref} className="relative ml-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] transition-colors',
          open ? 'bg-fg/[0.08] text-fg' : 'text-fg-soft hover:bg-fg/[0.06] hover:text-fg',
        )}
        title="Fill in values from the map"
      >
        <Wand2 className="h-3.5 w-3.5 text-ic-tools" />
        Fill from map
        <ChevronDown className="h-3 w-3 text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-8 z-40 w-72 rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]">
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false)
              onLengths(selectedLinks)
            }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-fg/[0.06]"
          >
            <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-ic-water" />
            <span>
              <span className="block text-[12px] font-medium text-fg">Pipe lengths</span>
              <span className="block text-[11px] text-muted">Measure along the drawn route · {linkScope}</span>
            </span>
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={!hasDem}
            onClick={() => {
              setOpen(false)
              setRimOpen(true)
            }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-fg/[0.06] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <Mountain className="mt-0.5 h-4 w-4 shrink-0 text-ic-land" />
            <span>
              <span className="block text-[12px] font-medium text-fg">Rim elevations from DEM</span>
              <span className="block text-[11px] text-muted">
                {hasDem ? `Ground level sets max depth · ${nodeScope}` : 'Add a DEM under Site data or Contents first'}
              </span>
            </span>
          </button>
        </div>
      )}
      <Dialog open={rimOpen} onOpenChange={setRimOpen}>
        <DialogContent
          title="Rim elevations from the DEM"
          description={`Sets each rim to the ground level under the node, keeping its invert (max depth = ground − invert). Applies to ${nodeScope}. Nodes where the ground is below the invert are left alone.`}
        >
          <label className="block text-[12px] text-fg-soft">
            DEM heights are in
            <span className="mt-1.5 flex gap-1.5">
              {(['m', 'ft'] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={cn('h-7 rounded-md border px-3 text-[12px]', unit === u ? 'border-accent bg-accent/15 text-fg' : 'border-border text-muted hover:text-fg')}
                >
                  {u === 'm' ? 'Metres' : 'Feet'}
                </button>
              ))}
            </span>
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRimOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setRimOpen(false)
                onRims(selectedNodes, unit)
              }}
            >
              Set rims
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
