/** Global shortcuts and the "?" cheat sheet. */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent } from './ui'

export const NAV_ORDER = ['/map', '/settings', '/table', '/data', '/storm', '/results', '/editor']
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'

const GROUPS: [string, [string, string][]][] = [
  ['Anywhere', [
    [`${MOD} K`, 'Search pages, actions and element IDs'],
    [`${MOD} Enter`, 'Run the simulation (checks the model first)'],
    [`${MOD} Z`, 'Undo the last edit (any kind)'],
    [`${MOD} Shift Z / ${MOD} Y`, 'Redo'],
    [`${MOD} Shift K`, 'Check the model'],
    ['Alt 1 – 7', 'Map, Settings, Elements, Model data, Rainfall, Results, INP editor'],
    ['?', 'Show these shortcuts'],
  ]],
  ['Map', [
    ['Right-click', 'Actions for what’s under the pointer'],
    ['Shift / Ctrl click', 'Add to or remove from the selection'],
    ['Shift drag', 'Box-select (Ctrl+Shift drag adds)'],
    [`${MOD} A`, 'Select all nodes and links'],
    [`${MOD} Shift A`, 'Select all of the selected kind'],
    [`${MOD} C`, 'Copy the selected IDs'],
    [`${MOD} F`, 'Find a node, link or subcatchment by ID'],
    ['Delete', 'Delete the selection'],
    ['Esc', 'Stop drawing, or clear the selection'],
    ['Enter', 'Finish a subcatchment or mesh outline'],
    ['Alt drag', 'Move a node'],
  ]],
  ['Tables', [
    ['Shift click', 'Select a range of rows (Model data)'],
    ['Paste', 'Paste cells copied from Excel'],
  ]],
]

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('.monaco-editor')))
}

export function KeyboardShortcuts({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !typing(e.target) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setOpen(true)
        return
      }
      if (enabled && e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-7]$/.test(e.code)) {
        e.preventDefault()
        navigate(NAV_ORDER[Number(e.code.slice(5)) - 1])
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('saturday-swmm-shortcuts', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('saturday-swmm-shortcuts', onOpen)
    }
  }, [enabled, navigate])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Keyboard shortcuts" className="w-[min(520px,calc(100vw-2rem))]">
        {GROUPS.map(([g, rows]) => (
          <section key={g} className="mb-4 last:mb-0">
            <h3 className="m-0 mb-1.5 text-xs font-medium text-muted">{g}</h3>
            <dl className="m-0 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              {rows.map(([k, d]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-fg-soft">{k}</kbd>
                  </dt>
                  <dd className="m-0 text-fg-soft">{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
