import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const toneClass = {
  default: 'bg-fg/[0.07] text-fg-soft',
  accent: 'bg-accent/15 text-accent-soft',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger-bg text-danger',
  running: 'bg-accent/15 text-accent-soft',
  completed: 'bg-success-bg text-success',
  failed: 'bg-danger-bg text-danger',
  cancelled: 'bg-fg/[0.07] text-muted',
  idle: 'bg-fg/[0.07] text-muted',
} as const

export type BadgeTone = keyof typeof toneClass

export function Badge({
  tone = 'default',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  )
}
