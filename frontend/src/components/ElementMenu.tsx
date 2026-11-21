/**
 * Right-click menu for an element in a list (Elements table, Graphs tree):
 * zoom to it on the map, chart it, copy its ID. The same menu as on the map.
 */
import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, LineChart, ZoomIn } from 'lucide-react'
import { MapContextMenu, type MenuItem } from './map/MapContextMenu'
import { useToast } from './ui'
import { focusOnMap, type FocusTarget } from '../lib/mapFocus'
import { requestGraph } from '../lib/graphRequest'

export type ElementTarget = FocusTarget & { label?: string }

export function useElementMenu(opts: {
  /** Zoom to the element; defaults to selecting it on the map page. */
  onZoom?: (t: ElementTarget) => void
  /** Offer "Show in Graphs" (the run has results). */
  graphs?: boolean
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [menu, setMenu] = useState<{ x: number; y: number; t: ElementTarget } | null>(null)

  const open = (e: MouseEvent, t: ElementTarget) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, t })
  }

  const items = (t: ElementTarget): MenuItem[] => {
    const zoom = () => {
      if (opts.onZoom) opts.onZoom(t)
      else {
        focusOnMap({ object_type: t.object_type, id: t.id })
        navigate('/map')
      }
    }
    const list: MenuItem[] = [
      { kind: 'header', label: t.label ?? t.id },
      { label: 'Zoom to on the map', icon: <ZoomIn className="h-3.5 w-3.5" />, onSelect: zoom },
    ]
    if (opts.graphs) {
      list.push({
        label: 'Show in Graphs',
        icon: <LineChart className="h-3.5 w-3.5" />,
        onSelect: () => {
          requestGraph(`${t.object_type}:${t.id}`)
          navigate('/map')
        },
      })
    }
    list.push(
      { kind: 'separator' },
      {
        label: 'Copy ID',
        icon: <Copy className="h-3.5 w-3.5" />,
        onSelect: () => {
          void navigator.clipboard
            ?.writeText(t.id)
            .then(() => toast({ title: `Copied ${t.id}`, tone: 'success' }))
            .catch(() => toast({ title: 'Couldn’t copy', tone: 'danger' }))
        },
      },
    )
    return list
  }

  const element = menu ? <MapContextMenu x={menu.x} y={menu.y} items={items(menu.t)} onClose={() => setMenu(null)} /> : null
  return { open, element }
}
