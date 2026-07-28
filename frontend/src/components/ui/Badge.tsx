import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const toneClass = {
  default: 'bg-border text-fg-soft',
  accent: 'bg-accent-strong/40 text-accent-soft',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning/20 text-warning',
  danger: 'bg-danger-bg text-danger',
  running: 'bg-sky-900 text-sky-200',
  completed: 'bg-success-bg text-green-200',
  failed: 'bg-danger-bg text-red-200',
  cancelled: 'bg-danger-bg text-red-200',
  idle: 'bg-border text-muted',
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
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  )
}
