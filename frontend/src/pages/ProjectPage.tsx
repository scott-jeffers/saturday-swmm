import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, FolderOpen, FolderPlus, Map as MapIcon, X } from 'lucide-react'
import { openNewModel } from '../lib/newModel'
import { api, type ProjectInfo } from '../api/client'
import { SystemStatusCard } from '../components/SystemStatusCard'
import { Button, useToast } from '../components/ui'
import { invalidateProjectQueries } from '../lib/projectQueries'
import { forgetProject, readRecentProjects, rememberProject, timeAgo } from '../lib/recentProjects'

interface ProjectPageProps {
  projectPath: string | null
  onOpen: (path: string) => void
}


export function ProjectPage({ projectPath, onOpen }: ProjectPageProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [pathInput, setPathInput] = useState(projectPath ?? '')
  const examples = useQuery({ queryKey: ['examples'], queryFn: api.examples, staleTime: Infinity })
  const [browsing, setBrowsing] = useState(false)
  const [recent, setRecent] = useState(readRecentProjects)
  const abortRef = useRef<AbortController | null>(null)

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
    enabled: Boolean(projectPath),
    retry: false,
  })

  const finishOpen = (info: ProjectInfo, kind: 'opened' | 'created') => {
    onOpen(info.path)
    setRecent(rememberProject(info.path, info.inp_name))
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

  // Sidebar → Open → a recent project: /?open=<path>
  const [search, setSearch] = useSearchParams()
  const openParam = search.get('open')
  useEffect(() => {
    if (!openParam || open.isPending) return
    setSearch({}, { replace: true })
    open.mutate(openParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParam])

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

  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: 1, refetchInterval: 30_000 })
  const healthy = health.data?.status === 'ok'

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-[22px] font-semibold tracking-[-0.015em] text-fg">Welcome to Saturday-SWMM</h1>
            <p className="mt-1 text-sm text-fg-soft">
              Open a folder that contains a SWMM <code>.inp</code> file, or start a new model.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void browse('open')}>
              <FolderOpen className="h-4 w-4" /> Open project…
            </Button>
            <Button variant="outline" disabled={busy} onClick={openNewModel}>
              <FolderPlus className="h-4 w-4" /> New model…
            </Button>
          </div>
        </header>

        {health.isError || (health.data && !healthy) ? (
          <SystemStatusCard />
        ) : null}

        {projectPath && project.data && (
          <section className="flex flex-wrap items-center gap-4 rounded-xl border border-accent/40 bg-accent/5 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted">Open now</div>
              <div className="truncate font-medium text-fg">{project.data.inp_name}</div>
              <div className="truncate text-xs text-muted">{project.data.path}</div>
            </div>
            <Button variant="primary" onClick={() => navigate('/map')}>
              <MapIcon className="h-4 w-4" /> Continue
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onOpen('')
                toast({ title: 'Project closed' })
              }}
            >
              Close
            </Button>
          </section>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <section>
            <h2 className="m-0 mb-3 text-sm font-semibold text-fg">Recent projects</h2>
            {recent.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted">
                Projects you open appear here. Try one of the examples to get started.
              </p>
            ) : (
              <ul className="m-0 list-none divide-y divide-border overflow-hidden rounded-xl border border-border p-0">
                {recent.map((r) => (
                  <li key={r.path} className="group flex items-center gap-3 bg-elevated/60 hover:bg-elevated">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => open.mutate(r.path)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{r.name}</span>
                        <span className="block truncate text-xs text-muted">{r.path}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(r.openedAt)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${r.name} from recent projects`}
                      title="Remove from list"
                      onClick={() => setRecent(forgetProject(r.path))}
                      className="mr-2 rounded p-1 text-muted opacity-0 hover:text-fg group-hover:opacity-100 focus:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6">
              <label htmlFor="project-path" className="mb-1.5 block text-xs text-muted">
                Or type a folder path
              </label>
              <div className="flex gap-2">
                <input
                  id="project-path"
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitOpen()}
                  placeholder="C:\Models\My project"
                  className="field h-9 min-w-0 flex-1"
                />
                <Button variant="outline" disabled={busy || !pathInput.trim()} onClick={submitOpen}>
                  Open
                </Button>
              </div>
              {pathInput.trim() && (
                <p className="m-0 mt-2 text-xs text-muted">
                  No model there yet?{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={submitCreate}
                    className="text-accent-soft underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    Start a new model in this folder
                  </button>
                </p>
              )}
            </div>
          </section>

          <section>
            <h2 className="m-0 mb-3 text-sm font-semibold text-fg">Examples</h2>
            <div className="grid gap-3">
              {(examples.data ?? []).map((ex) => (
                <button
                  key={ex.path}
                  type="button"
                  disabled={busy}
                  onClick={() => open.mutate(ex.path)}
                  className="rounded-xl border border-border bg-elevated/60 px-4 py-3 text-left transition-colors hover:border-accent/60 hover:bg-elevated"
                >
                  <span className="block text-sm font-medium text-fg">{ex.name}</span>
                  <span className="block text-xs text-muted">{EXAMPLE_BLURB[ex.name] ?? ex.path}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">
              {healthy ? 'OpenSWMM 6 and EPA SWMM 5 are ready.' : health.isLoading ? 'Checking engines…' : ''}{' '}
              <Link to="/about#updates" className="text-accent-soft underline-offset-2 hover:underline">
                Versions and updates
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

const EXAMPLE_BLURB: Record<string, string> = {
  'Sample model': 'A small storm sewer in Philadelphia that surcharges in a 2-year storm. Runs in seconds.',
  'LID sample': 'The sample sewer with seven kinds of green infrastructure: rain gardens, permeable paving, a green roof and more.',
  Bellinge: 'Real network from Odense, Denmark: about 1,000 manholes. 1D only.',
  'Bellinge 2D': 'The same network with a 2D surface mesh for street flooding (OpenSWMM 6).',
}
