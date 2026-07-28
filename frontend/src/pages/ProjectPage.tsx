import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen, FolderPlus, Map as MapIcon, Code2 } from 'lucide-react'
import { api, type ProjectInfo } from '../api/client'
import { SystemStatusCard } from '../components/SystemStatusCard'
import { Button, useToast } from '../components/ui'

interface ProjectPageProps {
  projectPath: string | null
  onOpen: (path: string) => void
}

function invalidateProjectQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['project'] })
  void queryClient.invalidateQueries({ queryKey: ['inp'] })
  void queryClient.invalidateQueries({ queryKey: ['network'] })
  void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
  void queryClient.invalidateQueries({ queryKey: ['out-periods'] })
  void queryClient.invalidateQueries({ queryKey: ['out-snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['out-nodes'] })
  void queryClient.invalidateQueries({ queryKey: ['out-links'] })
  void queryClient.invalidateQueries({ queryKey: ['rpt'] })
  void queryClient.invalidateQueries({ queryKey: ['series'] })
  void queryClient.invalidateQueries({ queryKey: ['map-series'] })
  void queryClient.invalidateQueries({ queryKey: ['profile'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-mesh'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
  void queryClient.invalidateQueries({ queryKey: ['gis-layers'] })
}

export function ProjectPage({ projectPath, onOpen }: ProjectPageProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [pathInput, setPathInput] = useState(
    projectPath ?? 'C:\\Users\\smj46\\Code\\SWMM6-JS\\examples\\Bellinge_SWMM',
  )
  const [browsing, setBrowsing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
    enabled: Boolean(projectPath),
    retry: false,
  })

  const finishOpen = (info: ProjectInfo, kind: 'opened' | 'created') => {
    onOpen(info.path)
    invalidateProjectQueries(queryClient)
    toast({
      title: kind === 'created' ? 'Project created' : 'Project opened',
      description: info.has_out
        ? `${info.inp_name} · existing results found`
        : info.inp_name,
      tone: 'success',
    })
    navigate('/map')
  }

  const open = useMutation({
    mutationFn: (path: string) => api.openProject(path),
    onSuccess: (info) => finishOpen(info, 'opened'),
    onError: (err) =>
      toast({ title: 'Open failed', description: (err as Error).message, tone: 'danger' }),
  })

  const create = useMutation({
    mutationFn: (path: string) => api.createProject(path),
    onSuccess: (info) => finishOpen(info, 'created'),
    onError: (err) =>
      toast({ title: 'Create failed', description: (err as Error).message, tone: 'danger' }),
  })

  const cancelBrowse = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setBrowsing(false)
  }

  const browse = async (nextMode: 'open' | 'create') => {
    cancelBrowse()
    const ac = new AbortController()
    abortRef.current = ac
    setBrowsing(true)
    try {
      const title =
        nextMode === 'open'
          ? 'Select an existing project folder'
          : 'Select or create a folder for the new project'
      const picked = await api.browseFolder(title, true, ac.signal)
      if (ac.signal.aborted) return
      if (picked.cancelled || !picked.path) {
        toast({
          title: 'No folder selected',
          description:
            'If no dialog appeared, paste the folder path below and click Open / Create.',
        })
        return
      }
      setPathInput(picked.path)
      if (nextMode === 'open') open.mutate(picked.path)
      else create.mutate(picked.path)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      toast({
        title: 'Folder picker unavailable',
        description:
          `${(err as Error).message}. Paste an absolute folder path below instead.`,
        tone: 'danger',
      })
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setBrowsing(false)
    }
  }

  const busy = open.isPending || create.isPending || browsing

  const submitOpen = () => {
    const path = pathInput.trim()
    if (path) open.mutate(path)
  }

  const submitCreate = () => {
    const path = pathInput.trim()
    if (path) create.mutate(path)
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-elevated p-8 shadow-[var(--shadow-panel)]">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-strong/20 text-accent-soft">
          <FolderOpen className="h-5 w-5" />
        </div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-2 text-sm text-fg-soft">
          Open an existing SWMM project folder, or choose an empty folder for a new blank model.
        </p>

        <SystemStatusCard />

        {projectPath && project.data && (
          <div className="mt-5 rounded-xl border border-border bg-surface/80 p-4">
            <div className="text-xs uppercase tracking-wide text-muted">Current project</div>
            <div className="mt-1 font-medium text-fg">{project.data.inp_name}</div>
            <div className="truncate text-xs text-muted">{project.data.path}</div>
            <div className="mt-1 text-xs text-muted">
              CRS {project.data.crs ?? 'EPSG:25832'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => navigate('/map')}>
                <MapIcon className="h-3.5 w-3.5" />
                Continue to map
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/editor')}>
                <Code2 className="h-3.5 w-3.5" />
                INP editor
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onOpen('')
                  toast({ title: 'Project closed' })
                }}
              >
                Close project
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void browse('open')}
            className="rounded-xl border border-border-strong bg-surface p-5 text-left transition-colors hover:border-accent hover:bg-border/30 disabled:opacity-50"
          >
            <FolderOpen className="mb-3 h-6 w-6 text-accent-soft" />
            <div className="font-semibold text-fg">Browse to open</div>
            <p className="mt-1 text-sm text-muted">
              System folder dialog for a folder that already has a <code>.inp</code>.
            </p>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void browse('create')}
            className="rounded-xl border border-border-strong bg-surface p-5 text-left transition-colors hover:border-accent hover:bg-border/30 disabled:opacity-50"
          >
            <FolderPlus className="mb-3 h-6 w-6 text-accent-soft" />
            <div className="font-semibold text-fg">Browse for new</div>
            <p className="mt-1 text-sm text-muted">
              Pick an empty folder; a starter <code>.inp</code> is created there.
            </p>
          </button>
        </div>

        {browsing && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/70 px-3 py-2">
            <p className="m-0 flex-1 text-sm text-muted">
              Waiting for the system folder dialog… Check the taskbar if it is behind other
              windows.
            </p>
            <Button size="sm" variant="outline" onClick={cancelBrowse}>
              Cancel
            </Button>
          </div>
        )}

        <div className="mt-6 border-t border-border pt-4">
          <p className="mb-2 text-xs text-muted">Or enter a folder path</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              spellCheck={false}
              placeholder="C:\path\to\project\folder"
              className="min-w-0 flex-1 rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitOpen()
              }}
            />
            <Button variant="primary" disabled={!pathInput.trim() || busy} onClick={submitOpen}>
              <FolderOpen className="h-3.5 w-3.5" />
              Open project
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!pathInput.trim() || busy}
              onClick={submitCreate}
              className="text-xs text-muted underline-offset-2 transition-colors hover:text-accent-soft hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              No <code>.inp</code> there yet? Create a new project in this folder
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const p = 'C:\\Users\\smj46\\Code\\SWMM6-JS\\examples\\Bellinge_SWMM'
                setPathInput(p)
                open.mutate(p)
              }}
            >
              Bellinge
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                const p = 'C:\\Users\\smj46\\Code\\SWMM6-JS\\examples'
                setPathInput(p)
                open.mutate(p)
              }}
            >
              Sample
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
