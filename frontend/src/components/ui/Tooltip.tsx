import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  disabled = false,
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Render the child alone (e.g. when its label is already visible). */
  disabled?: boolean
}) {
  if (disabled) return <>{children}</>
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-md border border-border bg-panel px-2 py-1 text-xs text-fg shadow-[var(--shadow-panel)]',
            'animate-in fade-in-0 zoom-in-95',
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-panel" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
