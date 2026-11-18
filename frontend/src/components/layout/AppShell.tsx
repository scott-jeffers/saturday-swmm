import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  CircleHelp,
  Code2,
  Compass,
  FolderOpen,
  Map as MapIcon,
  ChartColumnIncreasing,
  Table2,
  CloudRain,
  Droplets,
  Settings2,
  Radio,
  Database,
  Keyboard,
  ListChecks,
  Moon,
  Sun,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  LayoutDashboard,
  GitBranch,
  FileText,
} from 'lucide-react'
import { KeyboardShortcuts } from '../KeyboardShortcuts'
import { ModelCheckDialog } from '../ModelCheckDialog'
import { UndoRedoControls } from '../UndoRedo'
import { DOWNLOAD_URL, IS_VIEWER } from '../../lib/mode'
import { useResolvedTheme } from '../../lib/theme'
import { useQuery } from '@tanstack/react-query'
import { api, ENGINE_LABELS } from '../../api/client'
import { Tooltip, TooltipProvider } from '../ui/Tooltip'
import { cn } from '../../lib/cn'
import { HeaderRunControls } from '../HeaderRunControls'
import { ScenarioSwitcher } from '../ScenarioManager'
import { useRunSummary } from '../RunSummaryCard'
import { CommandPalette } from '../CommandPalette'
import { useEditorDirty } from '../../lib/editorDirty'
import { QuitNavButton, sideItemClass, UpdateNavButton, useVersionMismatchNotice } from '../AppLifecycle'
import { BroadcastControls } from '../BroadcastControls'
import { ProjectCrsControls } from '../ProjectCrsControls'
import { useBroadcastAudio } from '../../hooks/useBroadcastAudio'
import { setPref, usePref } from '../../lib/prefs'

const VIEWER_HIDDEN = new Set(['/settings', '/storm', '/scenarios'])

type NavDef = { to: string; label: string; icon: typeof MapIcon; badge?: number; badgeTitle?: string }
const NAV_GROUPS: { label: string; items: NavDef[] }[] = [
  {
    label: 'Model',
    items: [
      { to: '/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/map', label: 'Map', icon: MapIcon },
      { to: '/table', label: 'Elements', icon: Table2 },
      { to: '/data', label: 'Model data', icon: Database },
      { to: '/storm', label: 'Rainfall', icon: CloudRain },
      { to: '/editor', label: 'INP editor', icon: Code2 },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/results', label: 'Results', icon: ChartColumnIncreasing },
      { to: '/scenarios', label: 'Scenarios', icon: GitBranch },
      { to: '/report', label: 'Report', icon: FileText },
      { to: '/settings', label: 'Simulation settings', icon: Settings2 },
    ],
  },
]

function NavItem({ to, label, icon: Icon, end, expanded, badge, badgeTitle }: NavDef & { end?: boolean; expanded: boolean }) {
  return (
    <Tooltip content={badge ? `${label}: ${badgeTitle}` : label} side="right" disabled={expanded}>
      <NavLink to={to} end={end} title={expanded && badge ? badgeTitle : undefined} className={({ isActive }) => sideItemClass(expanded, isActive)}>
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-accent" aria-hidden />}
            <Icon aria-hidden className={cn('h-4 w-4 shrink-0', isActive && 'text-accent-soft')} strokeWidth={1.9} />
            {expanded && <span className="truncate">{label}</span>}
            {badge ? (
              <span
                className={cn(
                  'rounded-full bg-warning/20 text-[10px] font-semibold tabular-nums text-warning',
                  expanded ? 'ml-auto px-1.5' : 'absolute right-0.5 top-0.5 h-3.5 min-w-3.5 px-1 leading-[14px]',
                )}
                aria-label={badgeTitle}
              >
                {badge}
              </span>
            ) : null}
          </>
        )}
      </NavLink>
    </Tooltip>
  )
}

function SideButton({ label, onClick, icon, expanded, active, kbd }: { label: string; onClick: () => void; icon: ReactNode; expanded: boolean; active?: boolean; kbd?: string }) {
  return (
    <Tooltip content={label} side="right" disabled={expanded}>
      <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={sideItemClass(expanded, active)}>
        {icon}
        {expanded && <span className="truncate">{label}</span>}
        {expanded && kbd && <kbd className="ml-auto rounded border border-border px-1 text-[10px] text-muted">{kbd}</kbd>}
      </button>
    </Tooltip>
  )
}

function ViewerHeaderControls() {
  const [open, setOpen] = useState(false)
  const check = useQuery({ queryKey: ['model-check'], queryFn: api.checkModel, enabled: open })
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-soft hover:bg-fg/5"
        title="Check the model for errors"
      >
        <ListChecks className="h-3.5 w-3.5" /> Check model
      </button>
      <ModelCheckDialog open={open} onOpenChange={setOpen} check={check.data} />
      <Link to="/" className="rounded-md px-2 py-1 text-xs text-fg-soft hover:bg-fg/5">
        Add files
      </Link>
      <a
        href={DOWNLOAD_URL}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-strong"
        title="Running models needs the desktop app, which runs SWMM on your computer"
      >
        Get the app to run models
      </a>
    </div>
  )
}




export function AppShell({
  projectPath,
  children,
}: {
  projectPath: string | null
  children: ReactNode
}) {
  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
    enabled: Boolean(projectPath),
    retry: false,
  })

  useVersionMismatchNotice()
  const showAudio = usePref('show-broadcast-audio') === '1'
  const audio = useBroadcastAudio()
  const [audioOpen, setAudioOpen] = useState(false)
  const [crsOpen, setCrsOpen] = useState(false)
  const sidePref = usePref('sidebar', '')
  const expanded = sidePref ? sidePref === 'open' : typeof window !== 'undefined' && window.innerWidth >= 1360
  const theme = useResolvedTheme()
  const editorDirty = useEditorDirty()
  const runSummary = useRunSummary(project.data?.has_out ? project.data.path : null)
  const flooded = project.data?.has_out ? runSummary.data?.flooded_nodes ?? 0 : 0

  useEffect(() => {
    const onTheme = () => setPref('theme', theme === 'light' ? 'dark' : 'light')
    const onSide = () => setPref('sidebar', expanded ? 'closed' : 'open')
    window.addEventListener('saturday-swmm-toggle-theme', onTheme)
    window.addEventListener('saturday-swmm-toggle-sidebar', onSide)
    return () => {
      window.removeEventListener('saturday-swmm-toggle-theme', onTheme)
      window.removeEventListener('saturday-swmm-toggle-sidebar', onSide)
    }
  }, [theme, expanded])

  const toggleAudio = () => {
    setAudioOpen((open) => {
      const next = !open
      if (!next) audio.stop()
      return next
    })
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 bg-surface text-fg">
        <aside
          className={cn(
            'print-hidden flex h-full shrink-0 flex-col border-r border-border bg-elevated transition-[width] duration-150',
            expanded ? 'w-52 px-2.5' : 'w-14 items-center px-2',
          )}
        >
          <div className={cn('flex h-12 shrink-0 items-center gap-2.5', expanded ? 'px-1' : 'justify-center')}>
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
              <Droplets className="h-4 w-4" strokeWidth={2.2} />
            </span>
            {expanded && (
              <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">
                Saturday-SWMM
              </span>
            )}
          </div>

          <div className={cn('pb-1', !expanded && 'flex justify-center')}>
            <SideButton
              label="Search"
              kbd="Ctrl K"
              onClick={() => window.dispatchEvent(new Event('saturday-swmm-palette'))}
              expanded={expanded}
              icon={<Search className="h-4 w-4 shrink-0" />}
            />
          </div>
          <nav className={cn('flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-1', !expanded && 'items-center')} aria-label="Main">
            <NavItem to="/" label={IS_VIEWER ? 'Open files' : 'Projects'} icon={FolderOpen} end expanded={expanded} />
            {projectPath &&
              NAV_GROUPS.map((g) => (
                <div key={g.label} className={cn('flex flex-col gap-0.5', !expanded && 'items-center')}>
                  {expanded ? (
                    <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-muted/80">{g.label}</div>
                  ) : (
                    <div className="my-2 h-px w-6 bg-border" />
                  )}
                  {g.items
                    .filter((item) => !IS_VIEWER || !VIEWER_HIDDEN.has(item.to))
                    .map((item) => (
                      <NavItem
                        key={item.to}
                        {...item}
                        expanded={expanded}
                        badge={item.to === '/results' && flooded ? flooded : undefined}
                        badgeTitle={`${flooded} flooded node${flooded === 1 ? '' : 's'} in the last run`}
                      />
                    ))}
                </div>
              ))}
            {projectPath && showAudio && (
              <div className={cn('mt-2', !expanded && 'flex justify-center')}>
                <SideButton label="Broadcast audio" onClick={toggleAudio} active={audioOpen} expanded={expanded} icon={<Radio className="h-4 w-4 shrink-0" />} />
              </div>
            )}
          </nav>

          <div className={cn('flex shrink-0 flex-col gap-0.5 border-t border-border py-2', !expanded && 'items-center')}>
            {!IS_VIEWER && <UpdateNavButton expanded={expanded} />}
            <SideButton
              label="Keyboard shortcuts"
              onClick={() => window.dispatchEvent(new Event('saturday-swmm-shortcuts'))}
              expanded={expanded}
              icon={<Keyboard className="h-4 w-4 shrink-0" />}
            />
            <SideButton
              label={theme === 'light' ? 'Dark theme' : 'Light theme'}
              onClick={() => setPref('theme', theme === 'light' ? 'dark' : 'light')}
              expanded={expanded}
              icon={theme === 'light' ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
            />
            <NavItem to="/about" label="About" icon={CircleHelp} expanded={expanded} />
            {!IS_VIEWER && <QuitNavButton expanded={expanded} />}
            <SideButton
              label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
              onClick={() => setPref('sidebar', expanded ? 'closed' : 'open')}
              expanded={expanded}
              icon={expanded ? <PanelLeftClose className="h-4 w-4 shrink-0" /> : <PanelLeftOpen className="h-4 w-4 shrink-0" />}
            />
          </div>
        </aside>
        <KeyboardShortcuts enabled={Boolean(projectPath)} />
        <CommandPalette enabled={Boolean(projectPath)} />

        {projectPath && crsOpen && (
          <aside className="flex h-full w-[22rem] shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-elevated p-3 scrollbar-none">
            <ProjectCrsControls projectPath={projectPath} className="border-0 bg-transparent p-0 shadow-none" />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="print-hidden relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-elevated px-4">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {project.data ? (
                <>
                  <Tooltip content={project.data.path} side="bottom">
                    <span className="truncate text-[14px] font-semibold text-fg">{project.data.inp_name.replace(/\.inp$/i, '')}</span>
                  </Tooltip>
                  {editorDirty && (
                    <Link to="/editor" className="shrink-0 rounded px-1.5 text-[11px] text-warning hover:bg-fg/[0.06]" title="The INP editor has changes that are not saved yet">
                      Unsaved edits
                    </Link>
                  )}
                  {!IS_VIEWER && <ScenarioSwitcher name={project.data.scenario_name} />}
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setCrsOpen((o) => !o)}
                    aria-pressed={crsOpen}
                    className={cn(
                      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-fg/[0.06]',
                      crsOpen ? 'text-fg' : 'text-muted',
                    )}
                    title="Coordinate system"
                  >
                    <Compass className="h-3.5 w-3.5" />
                    {project.data.crs ?? 'CRS'}
                  </button>
                  {!IS_VIEWER && (
                    <Link
                      to="/settings"
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-fg/[0.06] hover:text-fg"
                      title="Simulation engine (change in Simulation settings)"
                    >
                      <Cpu className="h-3.5 w-3.5" />
                      {ENGINE_LABELS[project.data.simulation_engine ?? 'openswmm']}
                    </Link>
                  )}
                </>
              ) : (
                <span className="text-[13px] text-muted">{IS_VIEWER ? 'Browser viewer' : 'No project open'}</span>
              )}
            </div>
            {projectPath && (
              <div className="flex shrink-0 items-center gap-1.5">
                {audioOpen && <BroadcastControls audio={audio} />}
                {IS_VIEWER ? (
                  <ViewerHeaderControls />
                ) : (
                  <>
                    <UndoRedoControls />
                    <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                    <HeaderRunControls />
                  </>
                )}
              </div>
            )}
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
