import { NavLink } from 'react-router-dom'
import {
  Code2,
  FolderOpen,
  Map as MapIcon,
  ChartColumnIncreasing,
  Table2,
  CloudRain,
  Droplets,
  Settings2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Badge } from '../ui/Badge'
import { Tooltip, TooltipProvider } from '../ui/Tooltip'
import { cn } from '../../lib/cn'
import { useRunStatus } from '../../hooks/useRunStatus'

type Tint = 'orange' | 'sky' | 'slate' | 'violet' | 'cyan' | 'amber' | 'emerald'

const TINT: Record<Tint, { icon: string; bg: string; activeBg: string; ring: string }> = {
  orange: {
    icon: 'text-orange-400',
    bg: 'bg-orange-500/10',
    activeBg: 'bg-orange-500/20',
    ring: 'ring-orange-500/40',
  },
  sky: {
    icon: 'text-sky-400',
    bg: 'bg-sky-500/10',
    activeBg: 'bg-sky-500/20',
    ring: 'ring-sky-500/40',
  },
  slate: {
    icon: 'text-slate-300',
    bg: 'bg-slate-500/10',
    activeBg: 'bg-slate-500/25',
    ring: 'ring-slate-400/40',
  },
  violet: {
    icon: 'text-violet-400',
    bg: 'bg-violet-500/10',
    activeBg: 'bg-violet-500/20',
    ring: 'ring-violet-500/40',
  },
  cyan: {
    icon: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    activeBg: 'bg-cyan-500/20',
    ring: 'ring-cyan-500/40',
  },
  amber: {
    icon: 'text-amber-400',
    bg: 'bg-amber-500/10',
    activeBg: 'bg-amber-500/20',
    ring: 'ring-amber-500/40',
  },
  emerald: {
    icon: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    activeBg: 'bg-emerald-500/20',
    ring: 'ring-emerald-500/40',
  },
}

const projectNav = [
  { to: '/map', label: 'Map', icon: MapIcon, tint: 'sky' as Tint },
  { to: '/settings', label: 'Settings', icon: Settings2, tint: 'slate' as Tint },
  { to: '/table', label: 'Elements', icon: Table2, tint: 'violet' as Tint },
  { to: '/storm', label: 'Storm', icon: CloudRain, tint: 'cyan' as Tint },
  { to: '/results', label: 'Results', icon: ChartColumnIncreasing, tint: 'amber' as Tint },
  { to: '/editor', label: 'Editor', icon: Code2, tint: 'emerald' as Tint },
]

function NavItem({
  to,
  label,
  icon: Icon,
  tint,
  end,
}: {
  to: string
  label: string
  icon: typeof MapIcon
  tint: Tint
  end?: boolean
}) {
  const t = TINT[tint]
  return (
    <Tooltip content={label} side="right">
      <NavLink
        to={to}
        end={end}
        className="inline-flex shrink-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {({ isActive }) => (
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl leading-none transition-all duration-150',
              isActive
                ? cn(t.activeBg, 'ring-1', t.ring, 'shadow-sm')
                : cn(t.bg, 'opacity-70 hover:opacity-100'),
            )}
          >
            <Icon
              aria-hidden
              className={cn('block h-[18px] w-[18px] shrink-0', t.icon)}
              strokeWidth={1.9}
            />
          </span>
        )}
      </NavLink>
    </Tooltip>
  )
}

export function AppShell({
  projectPath,
  children,
}: {
  projectPath: string | null
  children: ReactNode
}) {
  const { data: runStatus } = useRunStatus(Boolean(projectPath))
  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
    enabled: Boolean(projectPath),
    retry: false,
  })

  const status = runStatus?.status ?? 'idle'
  const tone =
    status === 'running'
      ? 'running'
      : status === 'completed'
        ? 'completed'
        : status === 'failed' || status === 'cancelled'
          ? 'failed'
          : 'idle'

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 bg-surface text-fg">
        <aside className="flex h-full w-14 shrink-0 flex-col items-center border-r border-border bg-elevated py-3">
          <Tooltip content="Saturday-SWMM" side="right">
            <div className="mb-4 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_2px_10px_-2px_rgba(56,189,248,0.5)]">
              <Droplets className="block h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            </div>
          </Tooltip>

          <div className="flex flex-col items-center gap-1.5">
            <NavItem to="/" label="Projects" icon={FolderOpen} tint="orange" end />

            {projectPath && (
              <>
                <div className="my-1 h-px w-6 bg-border" />
                {projectNav.map((item) => (
                  <NavItem key={item.to} {...item} />
                ))}
              </>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-elevated/90 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="shrink-0 text-sm font-semibold tracking-tight text-fg">
                Saturday-SWMM
              </span>
              {project.data && (
                <>
                  <span className="text-border-strong">/</span>
                  <Tooltip content={project.data.path} side="bottom">
                    <span className="truncate text-sm text-fg-soft">{project.data.inp_name}</span>
                  </Tooltip>
                </>
              )}
            </div>
            {projectPath && (
              <Badge tone={tone as 'idle' | 'running' | 'completed' | 'failed'}>{status}</Badge>
            )}
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
