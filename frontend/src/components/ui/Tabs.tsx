import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string
  onValueChange: (v: string) => void
  children: ReactNode
  className?: string
}) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}
    >
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabsList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-xl border border-border bg-elevated p-1',
        className,
      )}
    >
      {children}
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors',
        'hover:text-fg data-[state=active]:bg-accent-strong/30 data-[state=active]:text-fg',
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string
  children: ReactNode
  className?: string
}) {
  return (
    <TabsPrimitive.Content
      value={value}
      className={cn('min-h-0 flex-1 outline-none', className)}
    >
      {children}
    </TabsPrimitive.Content>
  )
}
