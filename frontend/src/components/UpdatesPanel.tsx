/**
 * One place to see whether Saturday-SWMM and each engine are up to date,
 * and update them with one click (engines: pip with automatic rollback;
 * app: portable download + restart into the new version).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, Download, RefreshCw, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { api, type UpdateComponent } from '../api/client'
import { Badge, Button, useToast } from './ui'

export function useUpdates() {
  return useQuery({
    queryKey: ['updates'],
    queryFn: () => api.getUpdates(false),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  })
}

async function waitForServer(timeoutMs = 90_000) {
  const t0 = Date.now()
  await new Promise((r) => setTimeout(r, 1500))
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch('/api/app', { cache: 'no-store' })
      if (r.ok) return true
    } catch {
      /* still restarting */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

function RestartOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-surface/95 p-6 text-center">
      <div>
        <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-accent-soft" />
        <p className="m-0 text-base font-semibold text-fg">{message}</p>
        <p className="mt-1 text-sm text-muted">This page reloads by itself when Saturday-SWMM is back.</p>
      </div>
    </div>
  )
}

function fmtSize(bytes?: number | null) {
  return bytes ? `${Math.round(bytes / 1e6)} MB` : ''
}

function Row({
  c,
  busy,
  onUpdate,
  onRollback,
}: {
  c: UpdateComponent
  busy: boolean
  onUpdate: () => void
  onRollback: () => void
}) {
  const pending = c.loaded && c.installed && c.loaded !== c.installed
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border py-3 first:border-t-0">
      <div className="min-w-[12rem] flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          {c.name}
          {c.update_available ? (
            <Badge tone="running">Update available</Badge>
          ) : c.error ? (
            <Badge tone="idle">Not checked</Badge>
          ) : c.installed ? (
            <Badge tone="completed">Up to date</Badge>
          ) : (
            <Badge tone="failed">Not installed</Badge>
          )}
        </div>
        <div className="text-xs text-muted">{c.role}</div>
      </div>
      <div className="w-44 text-xs tabular-nums text-fg-soft">
        <div>Installed {c.installed ?? '—'}{pending ? ` (restart to use)` : ''}</div>
        <div className="text-muted">Latest {c.latest ?? '—'}</div>
      </div>
      <div className="flex w-56 justify-end gap-2">
        {c.previous && !c.update_available && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRollback} title={`Go back to ${c.previous}`}>
            <RotateCcw className="h-3.5 w-3.5" /> Undo
          </Button>
        )}
        {c.update_available && c.can_update && (
          <Button size="sm" variant="primary" disabled={busy} onClick={onUpdate}>
            <Download className="h-3.5 w-3.5" />
            {c.id === 'saturday-swmm' ? `Install ${c.latest}` : `Update to ${c.latest}`}
          </Button>
        )}
        {c.update_available && !c.can_update && c.notes_url && (
          <a className="text-xs text-accent-soft underline" href={c.notes_url} target="_blank" rel="noreferrer">
            Get {c.latest}
          </a>
        )}
      </div>
      {c.update_available && c.id === 'saturday-swmm' && (
        <p className="m-0 w-full text-[11px] text-muted">
          {c.can_update
            ? `Downloads ${fmtSize(c.download_size)}, checks it, and installs it next to this copy. Your projects stay where they are.`
            : c.how_to_update}
          {c.notes_url && (
            <>
              {' '}
              <a className="underline" href={c.notes_url} target="_blank" rel="noreferrer">
                What’s new
              </a>
            </>
          )}
        </p>
      )}
      {c.error && <p className="m-0 w-full text-[11px] text-muted">{c.error}</p>}
    </li>
  )
}

export function UpdatesPanel() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const updates = useUpdates()
  const [restarting, setRestarting] = useState<string | null>(null)

  const check = useMutation({
    mutationFn: () => api.getUpdates(true),
    onSuccess: (d) => qc.setQueryData(['updates'], d),
    onError: (e: Error) => toast({ title: 'Couldn’t check for updates', description: e.message, tone: 'danger' }),
  })

  const restart = async (into?: string, label = 'Restarting Saturday-SWMM…') => {
    setRestarting(label)
    try {
      await api.restartApp(into)
    } catch (e) {
      setRestarting(null)
      toast({ title: 'Couldn’t restart', description: (e as Error).message, tone: 'danger' })
      return
    }
    if (await waitForServer()) window.location.reload()
    else setRestarting('Saturday-SWMM didn’t come back. Start it again from its folder.')
  }

  const install = useMutation({
    mutationFn: (c: UpdateComponent) => api.installUpdate(c.id),
    onSuccess: (d, c) => {
      qc.setQueryData(['updates'], d)
      toast({ title: d.message ?? 'Done', tone: 'success' })
      if (c.id === 'saturday-swmm' && d.path) void restart(d.path, `Starting Saturday-SWMM ${d.version}…`)
    },
    onError: (e: Error) => toast({ title: 'Update failed', description: e.message, tone: 'danger' }),
  })

  const rollback = useMutation({
    mutationFn: (c: UpdateComponent) => api.rollbackUpdate(c.id),
    onSuccess: (d) => {
      qc.setQueryData(['updates'], d)
      toast({ title: d.message ?? 'Done', tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Couldn’t go back', description: e.message, tone: 'danger' }),
  })

  const d = check.data ?? updates.data
  const busy = install.isPending || rollback.isPending || check.isPending

  return (
    <div className="space-y-3">
      {restarting && <RestartOverlay message={restarting} />}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {d ? (
          d.updates_available ? (
            <span className="inline-flex items-center gap-1.5 text-fg">
              <CircleAlert className="h-4 w-4 text-amber-300" />
              {d.updates_available} update{d.updates_available > 1 ? 's' : ''} available
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-fg">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Everything is up to date
            </span>
          )
        ) : (
          <span className="text-muted">Checking…</span>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => check.mutate()}>
          <RefreshCw className={`h-3.5 w-3.5 ${check.isPending ? 'animate-spin' : ''}`} /> Check now
        </Button>
        {d?.restart_required && (
          <Button size="sm" variant="primary" disabled={!d.can_restart} onClick={() => void restart()}>
            Restart to finish updating
          </Button>
        )}
        {install.isPending && <span className="text-xs text-muted">Downloading and installing… this can take a few minutes.</span>}
      </div>
      {d && (
        <ul className="m-0 list-none p-0">
          {d.components.map((c) => (
            <Row
              key={c.id}
              c={c}
              busy={busy}
              onUpdate={() => install.mutate(c)}
              onRollback={() => rollback.mutate(c)}
            />
          ))}
        </ul>
      )}
      {d && <p className="m-0 text-[11px] text-muted">Last checked {new Date(d.checked_at).toLocaleString()}.</p>}
    </div>
  )
}
