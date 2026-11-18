/**
 * App-level lifecycle UI: update notice, version mismatch warning, and the
 * Quit button for the portable build.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowUpCircle, Power } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { UpdatesPanel, useUpdates } from './UpdatesPanel'
import { AlertDialog, Tooltip, useToast } from './ui'

export const UI_VERSION = __APP_VERSION__

export function useAppInfo() {
  return useQuery({ queryKey: ['app-info'], queryFn: api.appInfo, staleTime: 60_000, retry: 1 })
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

/** Sidebar row style shared with the shell's nav items. */
export function sideItemClass(expanded: boolean, active = false) {
  return [
    'relative flex h-8 shrink-0 items-center rounded-md text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50',
    expanded ? 'w-full gap-2.5 px-2.5' : 'w-9 justify-center',
    active ? 'bg-fg/[0.08] font-medium text-fg' : 'text-muted hover:bg-fg/[0.05] hover:text-fg',
  ].join(' ')
}

export function UpdateNavButton({ expanded = false }: { expanded?: boolean }) {
  const upd = useUpdates()
  const n = upd.data?.updates_available ?? 0
  if (!n && !upd.data?.restart_required) return null
  const label = upd.data?.restart_required
    ? 'Restart to finish updating'
    : `${n} update${n > 1 ? 's' : ''} available`
  return (
    <Tooltip content={label} side="right">
      <Link to="/about#updates" aria-label={label} className={`${sideItemClass(expanded)} !text-success`}>
        <ArrowUpCircle className="h-4 w-4 shrink-0" />
        {expanded && <span className="truncate">{upd.data?.restart_required ? 'Restart to update' : 'Updates'}</span>}
        {n > 0 && (
          <span className={`rounded-full bg-success px-1.5 text-[10px] font-semibold leading-4 text-white ${expanded ? 'ml-auto' : 'absolute -right-0.5 -top-0.5'}`}>
            {n}
          </span>
        )}
      </Link>
    </Tooltip>
  )
}

export function QuitNavButton({ expanded = false }: { expanded?: boolean }) {
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
        <button type="button" aria-label="Quit Saturday-SWMM" onClick={() => setOpen(true)} className={`${sideItemClass(expanded)} hover:!text-danger`}>
          <Power className="h-4 w-4 shrink-0" />
          {expanded && <span>Quit</span>}
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

/** About page: version and the update center. */
export function VersionPanelBody() {
  const info = useAppInfo()
  return (
    <div className="space-y-4 text-sm text-fg-soft">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          Saturday-SWMM <strong className="text-fg">v{info.data?.version ?? UI_VERSION}</strong>
        </span>
        <span className="text-xs text-muted">
          {info.data?.distribution === 'portable' ? 'Portable release' : 'Running from source'}
        </span>
      </div>
      <UpdatesPanel />
    </div>
  )
}
