/**
 * History: every saved version of the model (restore points), what changed
 * since, element by element, restoring any of them, optional Git commits, and
 * packaging the project to share.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, GitBranch, History, MapPin, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ModelSnapshot, type VersionChange } from '../api/client'
import { Button, PageHeader, useToast } from '../components/ui'
import { refreshAfterEdit } from '../components/UndoRedo'
import { cn } from '../lib/cn'
import { focusOnMap } from '../lib/mapFocus'

const when = (iso: string) => {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}
const CHANGE_TONE: Record<VersionChange['change'], string> = { added: 'text-success', removed: 'text-danger', modified: 'text-warning' }
const CHANGE_WORD: Record<VersionChange['change'], string> = { added: 'Added since', removed: 'Removed since', modified: 'Changed since' }

export function HistoryPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const snaps = useQuery({ queryKey: ['snapshots'], queryFn: api.listSnapshots })
  const git = useQuery({ queryKey: ['git-status'], queryFn: api.gitStatus, retry: false })
  const [showAuto, setShowAuto] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [against, setAgainst] = useState('current')
  const [label, setLabel] = useState('')
  const [commit, setCommit] = useState(true)

  const list = useMemo(() => (snaps.data?.snapshots ?? []).filter((s) => showAuto || !s.auto), [snaps.data, showAuto])
  useEffect(() => {
    if (!sel && list[0]) setSel(list[0].id)
  }, [list, sel])
  const selected = (snaps.data?.snapshots ?? []).find((s) => s.id === sel) ?? null
  const cmp = useQuery({ queryKey: ['version-compare', sel, against], queryFn: () => api.compareSnapshot(sel!, against), enabled: Boolean(sel) })

  const save = useMutation({
    mutationFn: () => api.saveVersion(label.trim() || `Version of ${new Date().toLocaleString()}`, Boolean(git.data?.repo && commit)),
    onSuccess: (v) => {
      setLabel('')
      setSel(v.id)
      void qc.invalidateQueries({ queryKey: ['snapshots'] })
      void qc.invalidateQueries({ queryKey: ['git-status'] })
      toast({ title: `Saved “${v.label}”`, description: v.git ? 'Committed to Git too.' : undefined, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t save the version', description: e.message, tone: 'danger' }),
  })
  const restore = useMutation({
    mutationFn: (s: ModelSnapshot) => api.restoreSnapshot(s.id),
    onSuccess: (_r, s) => {
      refreshAfterEdit(qc)
      void qc.invalidateQueries({ queryKey: ['snapshots'] })
      toast({ title: `Restored “${s.label}”`, description: 'What was there before is saved as a version too, and Ctrl+Z undoes it.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t restore', description: e.message, tone: 'danger' }),
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameSnapshot(id, name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['snapshots'] }),
  })
  const gitInit = useMutation({
    mutationFn: api.gitInit,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['git-status'] })
      toast({ title: 'This project is now a Git repository', description: 'Results and caches are ignored; save a version to make the first commit.', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t set up Git', description: e.message, tone: 'danger' }),
  })

  const bySection = useMemo(() => {
    const m = new Map<string, VersionChange[]>()
    for (const c of cmp.data?.changes ?? []) m.set(c.section, [...(m.get(c.section) ?? []), c])
    return [...m]
  }, [cmp.data])
  const showOnMap = (c: VersionChange) => {
    if (!c.object || c.change === 'removed') return
    focusOnMap({ object_type: c.object, id: c.id })
    navigate('/map')
  }

  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          title="History"
          description="Saved versions of the model: one is kept automatically before every run, and you can save your own. See what changed since any of them, element by element, and go back to it."
          actions={
            <>
              <a href="/api/projects/package/full" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-fg-soft hover:bg-fg/[0.05]" title="Model, scenarios, storms, rain files, GIS layers and named versions, without results">
                <Download className="h-3.5 w-3.5" /> Project (.zip)
              </a>
              <a href="/api/projects/package" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-fg-soft hover:bg-fg/[0.05]" title="Model and results for a reviewer, who opens it at saturday-swmm.com/viewer">
                <Download className="h-3.5 w-3.5" /> Review package
              </a>
            </>
          }
        />

        <section className="mt-2 flex flex-wrap items-end gap-3 rounded-[var(--radius-panel)] border border-border bg-elevated p-4">
          <label className="block min-w-[280px] flex-1 text-[12px] font-medium text-fg-soft">
            Save this version as
            <input
              className="field mt-1 w-full"
              value={label}
              placeholder="e.g. 30 % design, pipes upsized on Market St"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save.mutate()}
            />
          </label>
          {git.data?.repo && (
            <label className="flex h-9 items-center gap-2 text-[12.5px] text-fg-soft">
              <input type="checkbox" checked={commit} onChange={(e) => setCommit(e.target.checked)} /> Also commit to Git
              {git.data.branch && <span className="text-muted">({git.data.branch})</span>}
            </label>
          )}
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            <Save className="h-3.5 w-3.5" /> Save version
          </Button>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-fg-soft">{list.length} {list.length === 1 ? "version" : "versions"}</span>
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} /> Automatic ones too
              </label>
            </div>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {list.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSel(s.id)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left',
                      sel === s.id ? 'border-accent/60 bg-accent/10' : 'border-border bg-elevated hover:border-border-strong',
                    )}
                  >
                    <span className={cn('block truncate text-[13px]', s.auto ? 'text-fg-soft' : 'font-medium text-fg')}>{s.label}</span>
                    <span className="text-[11px] text-muted" title={new Date(s.created).toLocaleString()}>
                      {when(s.created)}
                      {s.auto ? ' · automatic' : ''}
                    </span>
                  </button>
                </li>
              ))}
              {!snaps.isLoading && list.length === 0 && (
                <li className="rounded-lg border border-dashed border-border p-4 text-[12.5px] text-muted">
                  No versions yet. One is saved automatically before each run, or save one above.
                </li>
              )}
            </ol>

            <section className="mt-3 rounded-[var(--radius-panel)] border border-border bg-elevated p-3 text-[12px]">
              <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                <GitBranch className="h-3.5 w-3.5" /> Git
              </h2>
              {!git.data ? (
                <p className="m-0 text-muted">Checking…</p>
              ) : !git.data.available ? (
                <p className="m-0 text-muted">Git isn’t installed. Versions above work without it; install Git to also keep the model in a repository.</p>
              ) : !git.data.repo ? (
                <>
                  <p className="mb-2 mt-0 text-muted">Keep the model files in a Git repository too, for teams and code review. Results and caches are left out. Saturday-SWMM never pushes.</p>
                  <Button size="sm" variant="outline" disabled={gitInit.isPending} onClick={() => gitInit.mutate()}>
                    Track this project with Git
                  </Button>
                </>
              ) : (
                <>
                  <p className="mb-1.5 mt-0 text-muted">
                    Repository at <code className="text-[11px]">{git.data.top}</code>
                    {git.data.branch ? `, branch ${git.data.branch}` : ''}.
                  </p>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {(git.data.commits ?? []).slice(0, 6).map((c) => (
                      <li key={c.hash} className="truncate" title={`${c.hash.slice(0, 10)} · ${c.author}`}>
                        <code className="text-[11px] text-muted">{c.hash.slice(0, 7)}</code> {c.message} <span className="text-muted">· {when(c.date)}</span>
                      </li>
                    ))}
                    {!git.data.commits?.length && <li className="text-muted">No commits yet.</li>}
                  </ul>
                </>
              )}
            </section>
          </aside>

          <main className="min-w-0">
            {selected ? (
              <section className="rounded-[var(--radius-panel)] border border-border bg-elevated p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <input
                      key={selected.id}
                      defaultValue={selected.label}
                      aria-label="Version name"
                      className="w-full rounded border border-transparent bg-transparent px-1 text-[16px] font-semibold text-fg hover:border-border focus:border-accent focus:outline-none"
                      onBlur={(e) => e.target.value.trim() && e.target.value !== selected.label && rename.mutate({ id: selected.id, name: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <p className="m-0 px-1 text-[12px] text-muted">
                      Saved {new Date(selected.created).toLocaleString()} · {selected.lines.toLocaleString('en-US')} lines
                      {selected.auto ? ' · renaming it keeps it for good' : ''}
                    </p>
                  </div>
                  <a
                    href={`/api/snapshots/${encodeURIComponent(selected.id)}/text`}
                    download={`${selected.label.replace(/[^\w.-]+/g, '_')}.inp`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-fg-soft hover:bg-fg/[0.05]"
                  >
                    <Download className="h-3.5 w-3.5" /> .inp
                  </a>
                  <Button
                    variant="outline"
                    disabled={restore.isPending}
                    onClick={() => window.confirm(`Go back to “${selected.label}”? The model as it is now is saved as a version first.`) && restore.mutate(selected)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Restore this version
                  </Button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="text-fg-soft">What changed going to</span>
                  <select className="field h-8 w-auto" value={against} onChange={(e) => setAgainst(e.target.value)} aria-label="Compare with">
                    <option value="current">the model now</option>
                    {(snaps.data?.snapshots ?? [])
                      .filter((s) => s.id !== selected.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} ({when(s.created)})
                        </option>
                      ))}
                  </select>
                  {cmp.data && (
                    <span className="ml-auto text-muted">
                      <span className="text-success">{cmp.data.counts.added} added</span> · <span className="text-warning">{cmp.data.counts.modified} changed</span> ·{' '}
                      <span className="text-danger">{cmp.data.counts.removed} removed</span>
                    </span>
                  )}
                </div>

                <div className="mt-3">
                  {cmp.isLoading && <p className="text-[13px] text-muted">Comparing…</p>}
                  {cmp.data && cmp.data.changes.length === 0 && <p className="text-[13px] text-muted">No differences: the model is the same.</p>}
                  {bySection.map(([section, rows]) => (
                    <details key={section} open={rows.length <= 12} className="border-t border-border py-2">
                      <summary className="cursor-pointer text-[12.5px] font-medium text-fg">
                        {section.charAt(0) + section.slice(1).toLowerCase().replace(/_/g, ' ')} <span className="font-normal text-muted">{rows.length}</span>
                      </summary>
                      <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
                        {rows.map((c) => (
                          <li key={`${c.change}-${c.id}`} className="rounded-md bg-fg/[0.03] px-2.5 py-1.5 text-[12px]">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium text-fg">{c.id}</span>
                              <span className={CHANGE_TONE[c.change]}>{CHANGE_WORD[c.change]}</span>
                              {c.object && c.change !== 'removed' && (
                                <button type="button" onClick={() => showOnMap(c)} className="ml-auto inline-flex items-center gap-1 text-accent-soft hover:underline">
                                  <MapPin className="h-3 w-3" /> On the map
                                </button>
                              )}
                            </div>
                            {c.change === 'modified' && (
                              <div className="mt-1 grid gap-0.5 font-mono text-[11px]">
                                {c.a.map((l, i) => (
                                  <div key={`a${i}`} className="truncate text-danger/90">− {l}</div>
                                ))}
                                {c.b.map((l, i) => (
                                  <div key={`b${i}`} className="truncate text-success">+ {l}</div>
                                ))}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </section>
            ) : (
              <section className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-border p-10 text-center text-[13px] text-muted">
                <History className="mb-2 h-6 w-6" />
                Pick a version to see what changed since.
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
