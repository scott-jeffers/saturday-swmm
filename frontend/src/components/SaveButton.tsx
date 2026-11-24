/** The header's Save button.
 *
 * Browser viewer: the model lives in this browser, so Save writes the .inp to
 * your computer (to the same file each time where the browser allows, else a
 * download) and shows when there are changes not saved yet. Ctrl+S saves.
 *
 * Desktop: every change is already written to the .inp; the button says so,
 * and offers a copy elsewhere.
 */

import * as DM from '@radix-ui/react-dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Download, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import { IS_VIEWER } from '../lib/mode'
import { getProject, getVersion, subscribe, type ViewerProject } from '../viewer/store'
import { downloadProjectZip, isFolderProject, projectFingerprint, PROJECT_SAVED_KEY } from '../viewer/projectZip'
import { Tooltip, useToast } from './ui'

import { fingerprint } from '../lib/fingerprint'

const SAVED_KEY = (name: string) => `saturday-swmm.saved:${name}`
/** The file Save writes: the model's own name, or with the scenario's name when one is open
 *  (so a scenario is never saved over the base model). */
const saveName = (p: ViewerProject | null) =>
  !p ? 'model.inp' : p.scenario && p.scenario.id !== 'base' ? `${p.inpName.replace(/\.inp$/i, '')} (${p.scenario.name.replace(/[\\/:*?"<>|]+/g, '-')}).inp` : p.inpName
/** A model made in this browser has never been saved: mark it so. */
export function markUnsaved(inpName: string) {
  try {
    localStorage.setItem(SAVED_KEY(inpName), 'never')
  } catch {
    /* private mode */
  }
}

type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>

function downloadInp(name: string, text: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

const menuItem = 'flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-fg/[0.06]'

function ViewerSave() {
  const { toast } = useToast()
  // Re-render on every change to the project in this browser.
  const version = useSyncExternalStore(subscribe, getVersion)
  const p = getProject()
  const name = useSyncExternalStore(subscribe, () => saveName(getProject()))
  // A project with scenarios or storms is saved to the computer as a .zip; a single model as its .inp.
  const folder = useMemo(() => isFolderProject(), [version]) // eslint-disable-line react-hooks/exhaustive-deps
  const fp = useMemo(() => (folder ? projectFingerprint() : fingerprint(getProject()?.inpText ?? '')), [version, folder]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = folder ? PROJECT_SAVED_KEY(p?.inpName ?? '') : SAVED_KEY(name)
  const [savedMark, setSavedMark] = useState(0)
  const handle = useRef<{ name: string; h: FileSystemFileHandle } | null>(null)

  // What was last saved for this model; a model opened from a file counts as saved.
  // (A project that has grown scenarios since was never saved as a .zip.)
  const saved = useMemo(() => {
    if (!p) return null
    try {
      let v = localStorage.getItem(key)
      if (v == null && !folder) localStorage.setItem(key, (v = fingerprint(p.inpText)))
      return v
    } catch {
      return null
    }
  }, [key, folder, savedMark]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = Boolean(p) && saved !== fp

  const saveInp = useCallback(
    async (as = false) => {
      const cur = getProject()
      if (!cur) return
      const file = saveName(cur)
      const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker
      let where = 'your Downloads folder'
      try {
        if (picker) {
          if (as || !handle.current || handle.current.name !== file) {
            handle.current = { name: file, h: await picker({ suggestedName: file, types: [{ description: 'SWMM input file', accept: { 'text/plain': ['.inp'] } }] }) }
          }
          const w = await handle.current.h.createWritable()
          await w.write(cur.inpText)
          await w.close()
          where = handle.current.h.name
        } else downloadInp(file, cur.inpText)
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return
        toast({ title: 'The model wasn’t saved', error: e, description: (e as Error).message, tone: 'danger' })
        return
      }
      try {
        localStorage.setItem(SAVED_KEY(file), fingerprint(cur.inpText))
      } catch {
        /* ignore */
      }
      setSavedMark((n) => n + 1)
      toast({ title: `Saved ${file} to your computer`, description: picker ? `Written to ${where}. Ctrl+S saves to it again.` : `Downloaded to ${where}.`, tone: 'success', key: 'save' })
    },
    [toast],
  )

  const saveZip = useCallback(() => {
    downloadProjectZip()
    setSavedMark((n) => n + 1)
    toast({ title: 'Saved the project to your computer', description: 'A .zip with every scenario, storm and saved version is in your Downloads folder. Open it here again, or in the desktop app.', tone: 'success', key: 'save' })
  }, [toast])

  // A .zip saved from elsewhere (History) counts too.
  useEffect(() => {
    const on = () => setSavedMark((n) => n + 1)
    window.addEventListener('saturday-swmm-saved', on)
    return () => window.removeEventListener('saturday-swmm-saved', on)
  }, [])

  const save = useCallback((as = false) => (isFolderProject() && !as ? saveZip() : void saveInp(as)), [saveInp, saveZip])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // In the INP text editor, Ctrl+S applies the text there first.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's' && !(e.target as HTMLElement | null)?.closest('.monaco-editor')) {
        e.preventDefault()
        save(e.shiftKey)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [save])

  if (!p) return null
  const what = folder ? 'the project (.zip)' : name
  return (
    <div className="flex items-center">
      <Tooltip
        content={
          dirty
            ? `Your changes are kept in this browser, but ${what} on your computer is out of date. Click (or Ctrl+S) to save it.`
            : `${folder ? 'The project .zip' : name} on your computer matches what's here. Changes are always kept in this browser too.`
        }
      >
        <button
          type="button"
          onClick={() => save()}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-l-md border px-2.5 text-xs font-medium transition-colors',
            dirty ? 'border-accent bg-accent/10 text-accent-soft hover:bg-accent/15' : 'border-border text-fg-soft hover:bg-fg/5',
          )}
        >
          {dirty ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-success" />}
          <span className="max-lg:hidden">
            {dirty ? 'Save' : 'Saved'}
            <span className="max-xl:hidden"> to computer</span>
          </span>
          {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="not saved to your computer" />}
        </button>
      </Tooltip>
      <DM.Root>
        <DM.Trigger asChild>
          <button
            type="button"
            aria-label="More ways to save"
            className={cn('inline-flex h-7 items-center rounded-r-md border border-l-0 px-1', dirty ? 'border-accent text-accent-soft hover:bg-accent/15' : 'border-border text-muted hover:bg-fg/5')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content align="end" sideOffset={4} className="z-50 w-72 rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]">
            <p className="m-0 px-2 py-1.5 text-[11.5px] leading-snug text-muted">
              Every change is kept in this browser as you make it. Saving puts a copy on your computer, to keep it safe or open it elsewhere.
            </p>
            <DM.Item className={menuItem} onSelect={saveZip}>
              <Download className="h-3.5 w-3.5 text-muted" /> Save the project (.zip)
              {folder && <span className="ml-auto text-[11px] text-muted">Ctrl+S</span>}
            </DM.Item>
            <p className="m-0 px-2 pb-1 pl-7 text-[11px] leading-snug text-muted">Every scenario, storm and saved version.</p>
            <DM.Item className={menuItem} onSelect={() => void saveInp()}>
              <Save className="h-3.5 w-3.5 text-muted" /> Save this model (.inp)
              {!folder && <span className="ml-auto text-[11px] text-muted">Ctrl+S</span>}
            </DM.Item>
            <DM.Item className={menuItem} onSelect={() => void saveInp(true)}>
              <Save className="h-3.5 w-3.5 text-muted" /> Save this model as… <span className="ml-auto text-[11px] text-muted">Ctrl+Shift+S</span>
            </DM.Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
    </div>
  )
}

function DesktopSave() {
  const { toast } = useToast()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject, retry: false })
  const file = project.data?.inp_path?.split(/[\\/]/).pop() ?? 'the .inp'
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's' && !(e.target as HTMLElement | null)?.closest('.monaco-editor')) {
        e.preventDefault()
        toast({ title: 'Already saved', description: `Every change is written to ${file} as you make it.`, tone: 'success', key: 'save' })
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [file, toast])
  if (!project.data) return null
  return (
    <DM.Root>
      <Tooltip content={`Every change is saved to ${file} as you make it`}>
        <DM.Trigger asChild>
          <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-fg-soft hover:bg-fg/5">
            <Check className="h-3.5 w-3.5 text-success" /> Saved
            <ChevronDown className="h-3 w-3 text-muted" />
          </button>
        </DM.Trigger>
      </Tooltip>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 w-64 rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-panel)]">
          <p className="m-0 px-2 py-1.5 text-[11.5px] leading-snug text-muted">Every change is written to {file} as you make it. Undo goes back step by step.</p>
          <DM.Item
            className={menuItem}
            onSelect={async () => {
              const { text } = await api.getInp()
              downloadInp(file.endsWith('.inp') ? file : `${file}.inp`, text)
            }}
          >
            <Download className="h-3.5 w-3.5 text-muted" /> Save a copy (.inp)…
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}

export function SaveButton() {
  return IS_VIEWER ? <ViewerSave /> : <DesktopSave />
}
