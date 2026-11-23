import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { browserRunState, runInBrowser, subscribeBrowserRun } from '../../viewer/engine/run'
import { Logo } from './Logo'
import { Link, NavLink, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { useIsPhone } from '../../lib/useMedia'
import { Check, History, FlaskConical,
  CircleHelp,
  Code2,
  Compass,
  Map as MapIcon,
  ChartColumnIncreasing,
  Table2,
  CloudRain,
  Settings2,
  Radio,
  Keyboard,
  ListChecks,
  Moon,
  Sun,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  LayoutDashboard,
  FileText,
  SquareTerminal,
  Loader2,
  Play,
  Sprout,
  BookOpen,
  Workflow, Menu, X as XIcon, FolderOpen, LayoutGrid } from 'lucide-react'
import { KeyboardShortcuts } from '../KeyboardShortcuts'
import { ModelCheckDialog } from '../ModelCheckDialog'
import { UndoRedoControls } from '../UndoRedo'
import { IS_VIEWER } from '../../lib/mode'
import { useResolvedTheme } from '../../lib/theme'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../ui'
import { api, ENGINE_LABELS } from '../../api/client'
import { Tooltip, TooltipProvider } from '../ui/Tooltip'
import { cn } from '../../lib/cn'
import { HeaderRunControls } from '../HeaderRunControls'
import { SaveButton } from '../SaveButton'
import { fingerprint } from '../../lib/fingerprint'
import { getProject as getViewerProject, subscribe as subscribeViewer } from '../../viewer/store'
import { ContextBar } from './ContextBar'
import { useRunSummary } from '../RunSummaryCard'
import { CommandPalette } from '../CommandPalette'
import { useT } from '../../lib/i18n'
import { useEditorDirty } from '../../lib/editorDirty'
import { QuitNavButton, sideItemClass, UpdateNavButton, useVersionMismatchNotice } from '../AppLifecycle'
import { BroadcastControls } from '../BroadcastControls'
import { ProjectCrsControls } from '../ProjectCrsControls'
import { useBroadcastAudio } from '../../hooks/useBroadcastAudio'
import { setPref, usePref } from '../../lib/prefs'
import { MANUAL } from '../../lib/manual'

const VIEWER_HIDDEN = new Set(['/scenarios', '/console', '/site-data', '/runs', '/history'])

type NavDef = { to: string; label: string; icon: typeof MapIcon; tone?: string; badge?: number; badgeTitle?: string }
const NAV_GROUPS: { label: string; items: NavDef[] }[] = [
  {
    label: 'Model',
    items: [
      { to: '/map', label: 'Map', icon: MapIcon, tone: 'text-ic-land' },
      { to: '/overview', label: 'Overview', icon: LayoutDashboard, tone: 'text-ic-water' },
      { to: '/table', label: 'Elements', icon: Table2, tone: 'text-ic-data' },
      { to: '/settings', label: 'Simulation options', icon: Settings2, tone: 'text-ic-tools' },
      { to: '/lid', label: 'LID controls', icon: Sprout, tone: 'text-ic-land' },
      { to: '/quality', label: 'Water quality', icon: FlaskConical, tone: 'text-ic-water' },
      { to: '/controls', label: 'Control rules', icon: Workflow, tone: 'text-ic-scen' },
      { to: '/storm', label: 'Rainfall', icon: CloudRain, tone: 'text-ic-rain' },
      { to: '/history', label: 'History', icon: History, tone: 'text-ic-tools' },
      { to: '/data', label: 'INP text', icon: Code2, tone: 'text-ic-code' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/runs', label: 'Runs', icon: LayoutGrid, tone: 'text-ic-scen' },
      { to: '/results', label: 'Results', icon: ChartColumnIncreasing, tone: 'text-ic-results' },
      { to: '/report', label: 'Report', icon: FileText, tone: 'text-ic-report' },
      { to: '/console', label: 'Python console', icon: SquareTerminal, tone: 'text-ic-code' },
    ],
  },
]

function NavItem({ to, label: raw, icon: Icon, tone, end, expanded, badge, badgeTitle }: NavDef & { end?: boolean; expanded: boolean }) {
  const t = useT()
  const label = t(raw)
  // A plain className string: the tooltip wrapper cannot merge NavLink's function form.
  const isActive = Boolean(useMatch({ path: to, end: end ?? false }))
  return (
    <Tooltip content={badge ? `${label}: ${badgeTitle}` : label} side="right" disabled={expanded}>
      <NavLink to={to} end={end} aria-label={expanded ? undefined : label} title={expanded && badge ? badgeTitle : undefined} className={sideItemClass(expanded, isActive)}>
        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-accent" aria-hidden />}
        <Icon aria-hidden className={cn('h-4 w-4 shrink-0', tone)} strokeWidth={isActive ? 2.2 : 1.9} />
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
      </NavLink>
    </Tooltip>
  )
}

function SideButton({ label: raw, onClick, icon, expanded, active, kbd }: { label: string; onClick: () => void; icon: ReactNode; expanded: boolean; active?: boolean; kbd?: string }) {
  const label = useT()(raw)
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

function BrowserRunButton() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const navigate = useNavigate()
  const run = useSyncExternalStore(subscribeBrowserRun, browserRunState)
  const busy = run.status === 'running'
  // Are the results shown from this exact model? (Fingerprint taken when they were made.)
  const inpText = useSyncExternalStore(subscribeViewer, () => getViewerProject()?.inpText ?? '')
  const resultPrint = useSyncExternalStore(subscribeViewer, () => getViewerProject()?.results[0]?.inpPrint ?? null)
  const hasResults = useSyncExternalStore(subscribeViewer, () => Boolean(getViewerProject()?.results[0]?.out))
  const print = useMemo(() => fingerprint(inpText), [inpText])
  const upToDate = hasResults && resultPrint === print
  const stale = hasResults && resultPrint != null && resultPrint !== print
  const go = async () => {
    await runInBrowser()
    const st = browserRunState()
    void qc.invalidateQueries()
    if (st.status === 'completed') toast({ title: `Run finished in ${st.seconds < 1 ? 'under a second' : `${st.seconds.toFixed(1)} s`}`, description: 'EPA SWMM 5.2, run in this browser. Nothing was uploaded.', tone: 'success' })
    if (st.status === 'failed')
      toast({
        title: 'Run failed',
        description: st.error,
        tone: 'danger',
        goTo: st.rptText ? { label: 'Open the report', onClick: () => navigate('/data?view=report') } : undefined,
      })
  }
  return (
    <Tooltip
      side="bottom"
      content={
        busy
          ? 'EPA SWMM 5.2 is running in this browser'
          : upToDate
            ? 'Nothing has changed since the last run, so the results shown are current.'
            : stale
              ? 'You changed the model after the last run: the results shown are from before. Run to update them.'
              : 'Run the model with EPA SWMM 5.2 in this browser. Nothing is uploaded.'
      }
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (upToDate) {
            toast({
              title: 'Results are up to date',
              description: 'Nothing has changed in the model since the last run, so running again gives the same results.',
              action: { label: 'Run anyway', onClick: () => void go() },
              key: 'run-same',
            })
            return
          }
          void go()
        }}
        className={cn(
          'relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-70',
          upToDate ? 'border border-border text-fg-soft hover:bg-fg/5' : 'bg-accent text-white hover:bg-accent-strong',
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : upToDate ? <Check className="h-3.5 w-3.5 text-success" /> : <Play className="h-3.5 w-3.5" />}
        {busy ? `Running ${run.percent} %` : upToDate ? 'Up to date' : stale ? 'Run again' : 'Run'}
        {stale && !busy && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warning" aria-label="results out of date" />}
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
        <ListChecks className="h-3.5 w-3.5" /> <span className="max-lg:hidden">Check model</span>
      </button>
      <ModelCheckDialog open={open} onOpenChange={setOpen} check={check.data} />
      <Link to="/" className="rounded-md px-2 py-1 text-xs text-fg-soft hover:bg-fg/5 max-lg:hidden">
        Add files
      </Link>
      <SaveButton />
      <BrowserRunButton />
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
  const audio = useBroadcastAudio()
  const [audioOpen, setAudioOpen] = useState(false)
  const [crsOpen, setCrsOpen] = useState(false)
  const sidePref = usePref('sidebar', '')
  const showRadio = usePref('show-radio', '') === '1'
  const phone = useIsPhone()
  // Phones: the navigation slides in from the left instead of taking a column.
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMenuOpen(false), [location.pathname, phone])
  const expanded = phone || (sidePref ? sidePref === 'open' : typeof window !== 'undefined' && window.innerWidth >= 1360)
  const theme = useResolvedTheme()
  const t = useT()
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

  // Radio stays reachable from the command palette even when it's not in the sidebar.
  useEffect(() => {
    const on = () => toggleAudio()
    window.addEventListener('saturday-swmm-radio', on)
    return () => window.removeEventListener('saturday-swmm-radio', on)
  })

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
        {phone && menuOpen && (
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden />
        )}
        <aside
          className={cn(
            'print-hidden flex h-full shrink-0 flex-col border-r border-border bg-elevated transition-[width] duration-150',
            expanded ? 'w-52 px-2.5' : 'w-14 items-center px-2',
            phone && 'fixed inset-y-0 left-0 z-50 w-64 shadow-2xl',
            phone && !menuOpen && 'hidden',
          )}
          aria-label={phone ? 'Menu' : undefined}
        >
          <div className={cn('flex h-12 shrink-0 items-center gap-2.5', expanded ? 'px-1' : 'justify-center')}>
            <Logo size={28} className="shrink-0" />
            {expanded && (
              <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">
                Saturday-SWMM
              </span>
            )}
            {phone && (
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="ml-auto rounded-md p-1.5 text-muted hover:bg-fg/[0.06]">
                <XIcon className="h-4 w-4" />
              </button>
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
            <NavItem to="/" label="Projects" icon={FolderOpen} end expanded={expanded} />
            {projectPath &&
              NAV_GROUPS.map((g) => (
                <div key={g.label} className={cn('flex flex-col gap-0.5', !expanded && 'items-center')}>
                  {expanded ? (
                    <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-muted/80">{t(g.label)}</div>
                  ) : (
                    <div className="my-2 h-px w-6 bg-border" />
                  )}
                  {g.items
                    .filter((item) => !IS_VIEWER || !VIEWER_HIDDEN.has(item.to))
                    .map((item) => (
                      <NavItem
                        key={item.to}
                        {...item}
                        label={item.label}
                        expanded={expanded}
                        badge={item.to === '/results' && flooded ? flooded : undefined}
                        badgeTitle={`${flooded} flooded node${flooded === 1 ? '' : 's'} in the last run`}
                      />
                    ))}
                </div>
              ))}
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
            {(showRadio || audioOpen) && (
              <SideButton label="Radio" onClick={toggleAudio} active={audioOpen} expanded={expanded} icon={<Radio className="h-4 w-4 shrink-0" />} />
            )}
            <SideButton
              label="SWMM manual"
              onClick={() => window.open(MANUAL.home, '_blank', 'noopener')}
              expanded={expanded}
              icon={<BookOpen className="h-4 w-4 shrink-0" />}
            />
            <NavItem to="/about" label="About" icon={CircleHelp} expanded={expanded} />
            {!IS_VIEWER && <QuitNavButton expanded={expanded} />}
            {!phone && <SideButton
              label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
              onClick={() => setPref('sidebar', expanded ? 'closed' : 'open')}
              expanded={expanded}
              icon={expanded ? <PanelLeftClose className="h-4 w-4 shrink-0" /> : <PanelLeftOpen className="h-4 w-4 shrink-0" />}
            />}
          </div>
        </aside>
        <KeyboardShortcuts enabled={Boolean(projectPath)} />
        <CommandPalette enabled={Boolean(projectPath)} />

        {projectPath && crsOpen && (
          <aside className="flex h-full w-[22rem] shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-elevated p-3 scrollbar-none max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-12 max-md:z-40 max-md:h-auto max-md:w-full">
            <ProjectCrsControls projectPath={projectPath} className="border-0 bg-transparent p-0 shadow-none" />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="print-hidden relative flex h-12 shrink-0 items-center gap-3 border-b border-border bg-elevated px-4 max-md:gap-1.5 max-md:px-2">
            {phone && (
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menu" className="-ml-0.5 shrink-0 rounded-md p-2 text-fg-soft hover:bg-fg/[0.06]">
                <Menu className="h-5 w-5" />
              </button>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {project.data ? (
                <>
                  <ContextBar project={project.data} />
                  {editorDirty && (
                    <Link to="/data?view=text" className="shrink-0 rounded px-1.5 text-[11px] text-warning hover:bg-fg/[0.06]" title="The INP text has changes that are not saved yet">
                      {t('Unsaved edits')}
                    </Link>
                  )}
                  <span className="mx-1 h-4 w-px shrink-0 bg-border max-md:hidden" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setCrsOpen((o) => !o)}
                    aria-pressed={crsOpen}
                    className={cn(
                      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] hover:bg-fg/[0.06] max-md:hidden',
                      crsOpen ? 'text-fg' : 'text-muted',
                    )}
                    title={`Coordinate system: ${project.data.crs ?? 'not set'}`}
                  >
                    <Compass className="h-3.5 w-3.5" />
                    <span className="max-lg:hidden">{project.data.crs_confirmed === false ? 'No coordinate system' : (project.data.crs ?? 'CRS')}</span>
                  </button>
                  {!IS_VIEWER && (
                    <Link
                      to="/settings"
                      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-fg/[0.06] hover:text-fg max-md:hidden"
                      title={`Simulation engine: ${ENGINE_LABELS[project.data.simulation_engine ?? 'pyswmm']} (change in Simulation options)`}
                    >
                      <Cpu className="h-3.5 w-3.5" />
                      <span className="max-xl:hidden">{ENGINE_LABELS[project.data.simulation_engine ?? 'pyswmm']}</span>
                    </Link>
                  )}
                </>
              ) : (
                <span className="text-[13px] text-muted">{IS_VIEWER ? 'Browser viewer' : t('No project open')}</span>
              )}
            </div>
            {audioOpen && !projectPath && (
              <div className="flex shrink-0 items-center gap-1.5">
                <BroadcastControls audio={audio} />
              </div>
            )}
            {projectPath && (
              <div className="flex shrink-0 items-center gap-1.5">
                {audioOpen && <BroadcastControls audio={audio} />}
                <UndoRedoControls />
                <span className="mx-1 h-5 w-px bg-border max-md:hidden" aria-hidden />
                {IS_VIEWER ? (
                  <ViewerHeaderControls />
                ) : (
                  <div className="flex items-center gap-2">
                    <SaveButton />
                    <HeaderRunControls />
                  </div>
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
