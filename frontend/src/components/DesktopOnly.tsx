import type { ReactNode } from 'react'
import { Monitor } from 'lucide-react'
import { DOWNLOAD_URL, IS_VIEWER } from '../lib/mode'
import { cn } from '../lib/cn'
import { Tooltip } from './ui'

/** What the online version says about a control that needs the desktop app. */
export const DESKTOP_ONLY_HINT = 'Works in the desktop app, which runs on your computer. It is shown here so the online version looks the same.'

/**
 * Something that only works in the desktop app. In the desktop app it renders
 * as is; online it is shown greyed out and can't be used, with a note saying so,
 * so the two look the same.
 *
 * `block` for a section or panel (a "Desktop app" tag in its corner); otherwise
 * inline, for a button or a field (the note shows on hover).
 */
export function DesktopOnly({ children, block = false, what, className }: { children: ReactNode; block?: boolean; what?: string; className?: string }) {
  if (!IS_VIEWER) return <>{children}</>
  const hint = what ? `${what}: ${DESKTOP_ONLY_HINT.charAt(0).toLowerCase()}${DESKTOP_ONLY_HINT.slice(1)}` : DESKTOP_ONLY_HINT
  if (block)
    return (
      <div className={cn('relative', className)} data-desktop-only>
        <div inert aria-disabled className="pointer-events-none select-none opacity-45 grayscale-[35%]">
          {children}
        </div>
        <DesktopTag hint={hint} className="absolute right-2 top-2" />
      </div>
    )
  return (
    <Tooltip content={hint}>
      <span className={cn('inline-flex cursor-not-allowed', className)} data-desktop-only tabIndex={0} aria-label={hint}>
        <span inert aria-disabled className="pointer-events-none inline-flex select-none opacity-45">
          {children}
        </span>
      </span>
    </Tooltip>
  )
}

/** The small "Desktop app" tag, a link to the download. */
export function DesktopTag({ hint = DESKTOP_ONLY_HINT, className }: { hint?: string; className?: string }) {
  if (!IS_VIEWER) return null
  return (
    <Tooltip content={hint}>
      <a
        href={DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'z-10 inline-flex items-center gap-1 rounded-full border border-border bg-panel/90 px-2 py-0.5 text-[10.5px] font-medium text-muted no-underline shadow-sm hover:text-fg',
          className,
        )}
      >
        <Monitor className="h-3 w-3" aria-hidden />
        Desktop app
      </a>
    </Tooltip>
  )
}

/** A page-level note: this page works in the desktop app; here you can look around. */
export function DesktopOnlyBanner({ what, children }: { what: string; children?: ReactNode }) {
  if (!IS_VIEWER) return null
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-elevated/60 px-4 py-2.5 text-[13px] text-fg-soft" role="note">
      <Monitor className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold text-fg">{what} works in the desktop app.</strong> {children ?? 'Everything is shown so you can look around; the controls that need it are greyed out here.'}
      </span>
      <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="shrink-0 font-medium text-accent-soft hover:underline">
        Get the desktop app
      </a>
    </div>
  )
}
