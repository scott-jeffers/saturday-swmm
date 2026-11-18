/**
 * App-level lifecycle UI: update notice, version mismatch warning, and the
 * Quit button for the portable build.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { AlertDialog, Tooltip, useToast } from './ui'

export const UI_VERSION = __APP_VERSION__

export function useAppInfo() {
  return useQuery({ queryKey: ['app-info'], queryFn: api.appInfo, staleTime: 60_000, retry: 1 })
}

export function useUpdateCheck() {
  return useQuery({
    queryKey: ['update-check'],
    queryFn: () => api.checkForUpdate(false),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  })
}

/** Toasts once if the open page and the running server are different versions. */
export function useVersionMismatchNotice() {
  const info = useAppInfo()
  const { toast } = useToast()
  const shown = useRef(false)
  useEffect(() => {
    const server = info.data?.version
    if (!server || shown.current || server === UI_VERSION) return
    shown.current = true
    toast({
      title: 'Please reload the page',
      description: `This page is version ${UI_VERSION} but Saturday-SWMM ${server} is running. Reload (Ctrl+Shift+R) to get the matching version.`,
      tone: 'danger',
    })
  }, [info.data?.version, toast])
}

const navBtn =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl leading-none transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50'

export function UpdateNavButton() {
  const upd = useUpdateCheck()
  if (!upd.data?.update_available || !upd.data.url) return null
  return (
    <Tooltip content={`Update available: v${upd.data.latest} (you have v${upd.data.current})`} side="right">
      <a
        href={upd.data.url}
        target="_blank"
        rel="noreferrer"
        aria-label="Update available"
        className={`${navBtn} bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25`}
      >
        <ArrowUpCircle className="h-[18px] w-[18px]" strokeWidth={1.9} />
      </a>
    </Tooltip>
  )
}

export function QuitNavButton() {
  const info = useAppInfo()
  const [open, setOpen] = useState(false)
  const [stopped, setStopped] = useState(false)
  const quit = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/app/shutdown', { method: 'POST' })
      if (!res.ok) throw new Error(res.statusText)
    },
    onSuccess: () => setStopped(true),
  })

  if (!info.data?.can_quit) return null
  if (stopped) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface/95 p-6 text-center">
        <div>
          <p className="m-0 text-lg font-semibold text-fg">Saturday-SWMM has stopped</p>
          <p className="mt-2 text-sm text-muted">
            You can close this tab. Double-click Saturday-SWMM.cmd to start it again.
          </p>
        </div>
      </div>
    )
  }
  return (
    <>
      <Tooltip content="Quit Saturday-SWMM" side="right">
        <button
          type="button"
          aria-label="Quit Saturday-SWMM"
          onClick={() => setOpen(true)}
          className={`${navBtn} bg-rose-500/10 text-rose-300 opacity-70 hover:opacity-100`}
        >
          <Power className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </button>
      </Tooltip>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title="Quit Saturday-SWMM?"
        description="This stops the local server. Any simulation that is running will be stopped. Saved model changes are already on disk."
        confirmLabel="Quit"
        confirming={quit.isPending}
        onConfirm={() => quit.mutate()}
      />
    </>
  )
}

/** About page: version, engines, and a manual update check. */
export function VersionPanelBody() {
  const info = useAppInfo()
  const upd = useUpdateCheck()
  const recheck = useMutation({
    mutationFn: () => api.checkForUpdate(true),
    onSuccess: () => void upd.refetch(),
  })
  const u = recheck.data ?? upd.data
  return (
    <div className="space-y-3 text-sm text-fg-soft">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          Saturday-SWMM <strong className="text-fg">v{info.data?.version ?? UI_VERSION}</strong>
        </span>
        <span className="text-xs text-muted">
          {info.data?.distribution === 'portable' ? 'Portable release' : 'Running from source'}
        </span>
      </div>
      <ul className="m-0 grid list-none gap-1 p-0 text-xs sm:grid-cols-2">
        {(info.data?.engines ?? []).map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${e.available ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="text-fg">{e.label}</span>
            <span className="text-muted">{e.available ? (e.version ? `v${e.version}` : 'ready') : 'not available'}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 hover:border-border-strong"
          disabled={recheck.isPending}
          onClick={() => recheck.mutate()}
        >
          {recheck.isPending ? 'Checking…' : 'Check for updates'}
        </button>
        {u &&
          (u.update_available ? (
            <a className="text-emerald-300 underline" href={u.url ?? info.data?.releases_url} target="_blank" rel="noreferrer">
              v{u.latest} is available — download
            </a>
          ) : u.ok ? (
            <span className="text-muted">You have the latest release{u.latest ? ` (v${u.latest})` : ''}.</span>
          ) : (
            <span className="text-muted">Couldn’t reach GitHub to check for updates.</span>
          ))}
      </div>
    </div>
  )
}
