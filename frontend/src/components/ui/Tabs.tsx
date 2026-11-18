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
        'flex w-full items-end gap-1 border-b border-border',
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
        '-mb-px inline-flex h-9 items-center gap-2 border-b-2 border-transparent px-2.5 text-[13px] text-muted transition-colors',
        'hover:text-fg data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-fg',
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
