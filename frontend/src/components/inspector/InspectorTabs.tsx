/**
 * The inspector's tab row. When the panel is too narrow for every tab, the last
 * ones move into a "More" menu (the open one stays on the row as the menu's label),
 * rather than being cut off at the edge.
 */
import * as DM from '@radix-ui/react-dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useFitLevel } from '../../hooks/useFitLevel'

export function InspectorTabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly T[]; value: T; onChange: (t: T) => void; label: (t: T) => string }) {
  // Level n: the last n tabs go into the menu (always keep at least two on the row).
  const [fit, ref] = useFitLevel(Math.max(0, tabs.length - 2), tabs.join('|'))
  const row = fit ? tabs.slice(0, tabs.length - fit) : tabs
  const more = fit ? tabs.slice(tabs.length - fit) : []
  const inMore = more.includes(value)
  const tabClass = (on: boolean) =>
    cn('-mb-px inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 text-[12px]', on ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')
  return (
    <div ref={ref} className="mb-3 flex gap-1 overflow-hidden border-b border-border" role="tablist">
      {row.map((t) => (
        <button key={t} type="button" role="tab" aria-selected={value === t} onClick={() => onChange(t)} className={tabClass(value === t)}>
          {label(t)}
        </button>
      ))}
      {more.length > 0 && (
        <DM.Root>
          <DM.Trigger className={cn(tabClass(inMore), 'outline-none focus-visible:ring-2 focus-visible:ring-accent/40')} aria-label={inMore ? `${label(value)} (more tabs)` : 'More tabs'}>
            {inMore ? label(value) : 'More'}
            <ChevronDown className="h-3 w-3" />
          </DM.Trigger>
          <DM.Portal>
            <DM.Content align="end" sideOffset={4} className="z-[70] min-w-[9rem] rounded-lg border border-border bg-elevated p-1 text-[12.5px] shadow-[var(--shadow-panel)]">
              {more.map((t) => (
                <DM.Item
                  key={t}
                  onSelect={() => onChange(t)}
                  className={cn('cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-fg/[0.06]', value === t ? 'font-medium text-fg' : 'text-fg-soft')}
                >
                  {label(t)}
                </DM.Item>
              ))}
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
    </div>
  )
}
