import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** The same header on every page: title, one line of context, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4', className)}>
      <div className="min-w-0">
        <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-fg">{title}</h1>
        {description && <p className="m-0 mt-1 max-w-3xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </header>
  )
}
