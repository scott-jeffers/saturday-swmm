import { BookOpen } from 'lucide-react'
import { cn } from '../lib/cn'

/** A quiet "read about it in the SWMM manual" link that opens in a new tab. */
export function ManualLink({ href, children = 'SWMM manual', className }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('inline-flex items-center gap-1 text-[12px] text-accent-soft underline-offset-2 hover:underline', className)}
    >
      <BookOpen className="h-3.5 w-3.5" />
      {children}
    </a>
  )
}
