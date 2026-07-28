import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Panel({
  className,
  title,
  actions,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border border-border bg-elevated/90 p-4 shadow-sm',
        className,
      )}
      {...props}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? (
            <h2 className="m-0 text-sm font-semibold tracking-wide text-fg">{title}</h2>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}
