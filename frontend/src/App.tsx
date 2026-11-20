import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ProjectPage } from './pages/ProjectPage'
import { ViewerHomePage } from './pages/ViewerHomePage'
import { IS_VIEWER } from './lib/mode'
import { SimOptionsReadOnly } from './components/SimOptionsReadOnly'
import { MapPage } from './pages/MapPage'

// Secondary pages load on first visit so the app starts faster
// (the code editor, charts and storm tools are large).
const ResultsPage = lazy(() => import('./pages/ResultsPage').then((m) => ({ default: m.ResultsPage })))
const TablePage = lazy(() => import('./pages/TablePage').then((m) => ({ default: m.TablePage })))
const StormPage = lazy(() => import('./pages/StormPage').then((m) => ({ default: m.StormPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const ModelDataPage = lazy(() => import('./pages/ModelDataPage').then((m) => ({ default: m.ModelDataPage })))
function EditorRedirect() {
  const loc = useLocation()
  const q = new URLSearchParams(loc.search)
  q.set('view', 'text')
  return <Navigate to={`/data?${q.toString()}`} replace />
}
const LidPage = lazy(() => import('./pages/LidPage').then((m) => ({ default: m.LidPage })))
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const ScenariosPage = lazy(() => import('./pages/ScenariosPage').then((m) => ({ default: m.ScenariosPage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const ConsolePage = lazy(() => import('./pages/ConsolePage').then((m) => ({ default: m.ConsolePage })))
const DesignPage = lazy(() => import('./pages/DesignPage').then((m) => ({ default: m.DesignPage })))
const SiteDataPage = lazy(() => import('./pages/SiteDataPage').then((m) => ({ default: m.SiteDataPage })))
const AboutPage = lazy(() => import('./pages/AboutPage').then((m) => ({ default: m.AboutPage })))

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="m-0 text-sm text-muted">Loading…</p>
    </div>
  )
}
import { AppShell } from './components/layout/AppShell'
import { ToastProvider, useToast } from './components/ui'
import { api } from './api/client'
import { cn } from './lib/cn'
import {
  clearStoredProjectPath,
  readStoredProjectPath,
  writeStoredProjectPath,
} from './lib/projectSession'

function AppInner() {
  const [projectPath, setProjectPathState] = useState(readStoredProjectPath)
  const [bootstrapped, setBootstrapped] = useState(() => !readStoredProjectPath())
  const needsBootstrap = useRef(Boolean(readStoredProjectPath()))
  const location = useLocation()
  const { toast } = useToast()
  const onMap = location.pathname === '/map'

  const setActiveProject = useCallback((path: string | null) => {
    const trimmed = path?.trim() || null
    if (trimmed) {
      writeStoredProjectPath(trimmed)
      setProjectPathState(trimmed)
    } else {
      clearStoredProjectPath()
      setProjectPathState(null)
    }
  }, [])

  // Rehydrate backend active project after reload / lost in-memory state
  useEffect(() => {
    if (!projectPath) {
      needsBootstrap.current = false
      setBootstrapped(true)
      return
    }

    let cancelled = false
    void api
      .openProject(projectPath)
      .then(() => {
        if (cancelled) return
        needsBootstrap.current = false
        setBootstrapped(true)
      })
      .catch((err) => {
        if (cancelled) return
        if (needsBootstrap.current) {
          needsBootstrap.current = false
          clearStoredProjectPath()
          setProjectPathState(null)
          toast({
            title: 'Project no longer available',
            description: (err as Error).message,
            tone: 'danger',
          })
        }
        setBootstrapped(true)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, toast])

  if (projectPath && !bootstrapped) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-surface text-fg">
        <p className="m-0 text-sm text-muted">Restoring project…</p>
      </div>
    )
  }

  return (
    <AppShell projectPath={projectPath}>
      <div className="relative h-full min-h-0">
        {/* Keep map mounted so camera / GL context survive tab switches */}
        {projectPath && (
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-col',
              onMap ? 'z-10' : 'print-hidden pointer-events-none invisible z-0',
            )}
            aria-hidden={!onMap}
          >
            <MapPage projectPath={projectPath} visible={onMap} />
          </div>
        )}

        <div
          className={cn(
            'h-full min-h-0',
            onMap ? 'pointer-events-none invisible' : 'relative z-10',
          )}
        >
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route
              path="/"
              element={
                IS_VIEWER ? (
                  <ViewerHomePage onOpen={(path) => setActiveProject(path)} />
                ) : (
                  <ProjectPage
                    projectPath={projectPath}
                    onOpen={(path) => setActiveProject(path || null)}
                  />
                )
              }
            />
            <Route path="/editor" element={<EditorRedirect />} />
            <Route
              path="/map"
              element={projectPath ? null : <Navigate to="/" replace />}
            />
            <Route
              path="/settings"
              element={
                projectPath ? (
                  IS_VIEWER ? <SimOptionsReadOnly /> : <SettingsPage projectPath={projectPath} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/table"
              element={projectPath ? <TablePage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/storm"
              element={
                projectPath ? (
                  <StormPage projectPath={projectPath} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/results"
              element={projectPath ? <ResultsPage /> : <Navigate to="/" replace />}
            />
            <Route
              path="/data"
              element={projectPath ? <ModelDataPage /> : <Navigate to="/" replace />}
            />
            <Route path="/lid" element={projectPath ? <LidPage /> : <Navigate to="/" replace />} />
            <Route path="/overview" element={projectPath ? <OverviewPage /> : <Navigate to="/" replace />} />
            <Route path="/scenarios" element={projectPath ? <ScenariosPage /> : <Navigate to="/" replace />} />
            <Route path="/report" element={projectPath ? <ReportPage /> : <Navigate to="/" replace />} />
            <Route path="/console" element={projectPath && !IS_VIEWER ? <ConsolePage /> : <Navigate to="/" replace />} />
            <Route path="/design" element={<DesignPage />} />
            <Route path="/site-data" element={projectPath && !IS_VIEWER ? <SiteDataPage /> : <Navigate to="/" replace />} />
            <Route path="/about" element={<AboutPage />} />
          </Routes>
          </Suspense>
        </div>
      </div>
    </AppShell>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  )
}
