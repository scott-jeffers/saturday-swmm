import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ProjectPage } from './pages/ProjectPage'
import { EditorPage } from './pages/EditorPage'
import { ResultsPage } from './pages/ResultsPage'
import { MapPage } from './pages/MapPage'
import { TablePage } from './pages/TablePage'
import { StormPage } from './pages/StormPage'
import { SettingsPage } from './pages/SettingsPage'
import { AboutPage } from './pages/AboutPage'
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
  const navigate = useNavigate()
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
              onMap ? 'z-10' : 'pointer-events-none invisible z-0',
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
          <Routes>
            <Route
              path="/"
              element={
                <ProjectPage
                  projectPath={projectPath}
                  onOpen={(path) => setActiveProject(path || null)}
                />
              }
            />
            <Route
              path="/editor"
              element={
                projectPath ? (
                  <EditorPage
                    projectPath={projectPath}
                    onClose={() => navigate('/map')}
                  />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/map"
              element={projectPath ? null : <Navigate to="/" replace />}
            />
            <Route
              path="/settings"
              element={
                projectPath ? (
                  <SettingsPage projectPath={projectPath} />
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
            <Route path="/about" element={<AboutPage />} />
          </Routes>
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
