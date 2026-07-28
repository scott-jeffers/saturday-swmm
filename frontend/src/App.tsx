import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ProjectPage } from './pages/ProjectPage'
import { EditorPage } from './pages/EditorPage'
import { ResultsPage } from './pages/ResultsPage'
import { MapPage } from './pages/MapPage'
import { TablePage } from './pages/TablePage'
import { StormPage } from './pages/StormPage'
import { SettingsPage } from './pages/SettingsPage'
import { AppShell } from './components/layout/AppShell'
import { ToastProvider } from './components/ui'
import { api } from './api/client'
import { cn } from './lib/cn'

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const location = useLocation()
  const onMap = location.pathname === '/map'

  // Rehydrate backend active project after reload / lost in-memory state
  useEffect(() => {
    if (!projectPath) return
    void api.openProject(projectPath).catch(() => {
      /* Storm/Map pages also ensure-open before writes */
    })
  }, [projectPath])

  return (
    <ToastProvider>
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
                    onOpen={(path) => setProjectPath(path || null)}
                  />
                }
              />
              <Route
                path="/editor"
                element={
                  projectPath ? (
                    <EditorPage
                      projectPath={projectPath}
                      onClose={() => setProjectPath(null)}
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
            </Routes>
          </div>
        </div>
      </AppShell>
    </ToastProvider>
  )
}
