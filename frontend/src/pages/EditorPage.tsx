import { useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hash, Replace, Save, Search } from 'lucide-react'
import { api } from '../api/client'
import { InpEditor, type InpEditorCommand } from '../components/InpEditor'
import { Button, useToast } from '../components/ui'
import { editorDraft, setEditorDirty } from '../lib/editorDirty'

interface EditorPageProps {
  projectPath: string
  onClose: () => void
  /** Inside the INP text page: no page chrome or section list, jump to `section`. */
  embedded?: boolean
  section?: string | null
}

function extractSections(text: string): Array<{ name: string; index: number }> {
  const sections: Array<{ name: string; index: number }> = []
  const lines = text.split(/\r?\n/)
  let offset = 0
  for (const line of lines) {
    const m = line.trim().match(/^\[(.+)\]$/)
    if (m) sections.push({ name: m[1], index: offset })
    offset += line.length + 1
  }
  return sections
}

export function EditorPage({ projectPath, onClose, embedded = false, section = null }: EditorPageProps) {
  const [editorText, setEditorText] = useState(editorDraft.text ?? '')
  const [dirty, setDirtyState] = useState(editorDraft.text != null)
  const setDirty = (v: boolean) => {
    setDirtyState(v)
    setEditorDirty(v)
  }
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  const [command, setCommand] = useState<{ what: InpEditorCommand; nonce: number } | null>(null)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
    retry: false,
  })

  const inp = useQuery({
    queryKey: ['inp'],
    queryFn: api.getInp,
    retry: false,
  })

  useEffect(() => {
    if (inp.data && !dirty) {
      setEditorText(inp.data.text)
    }
  }, [inp.data, dirty])

  const sections = useMemo(() => extractSections(editorText), [editorText])

  // /editor?section=JUNCTIONS opens at that section (e.g. from Model data).
  const [params, setParams] = useSearchParams()
  const wantSection = params.get('section')?.toUpperCase() ?? null
  useEffect(() => {
    if (!wantSection || !sections.length) return
    const hit = sections.find((x) => x.name.toUpperCase() === wantSection)
    if (hit) setJumpTo(hit.index)
    params.delete('section')
    setParams(params, { replace: true })
  }, [wantSection, sections, params, setParams])

  // Embedded: follow the section picked in the INP text page's list.
  useEffect(() => {
    if (!embedded || !section || !sections.length) return
    const hit = sections.find((x) => x.name.toUpperCase() === section.toUpperCase())
    if (hit) setJumpTo(hit.index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, section, sections.length])

  const save = useMutation({
    mutationFn: () => api.saveInp(editorText),
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
      void queryClient.invalidateQueries({ queryKey: ['network'] })
      toast({ title: 'INP saved', tone: 'success' })
    },
    onError: (err) =>
      toast({ title: 'Save failed', description: (err as Error).message, tone: 'danger' }),
  })

  return (
    <div className={embedded ? 'flex min-h-0 flex-1 flex-col gap-3' : 'flex h-full min-h-0 flex-col gap-3 px-6 py-5'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={embedded ? 'm-0 text-[19px] font-semibold tracking-[-0.01em] text-fg' : 'm-0 text-[19px] font-semibold tracking-[-0.01em] text-fg'}>
            {project.data?.inp_name ?? 'Project'}
            {dirty ? <span className="ml-2 align-middle text-[12px] font-medium text-warning">Unsaved changes</span> : null}
          </h1>
          <p className="m-0 mt-1 truncate text-[12px] text-muted">{embedded ? 'The whole file as text. Pick a section on the left to jump to it.' : (project.data?.path ?? projectPath)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setCommand({ what: 'find', nonce: Date.now() })} title="Find (Ctrl+F)">
            <Search className="h-3.5 w-3.5" /> Find
          </Button>
          {(
            <Button variant="ghost" size="sm" onClick={() => setCommand({ what: 'replace', nonce: Date.now() })} title="Find and replace (Ctrl+H)">
              <Replace className="h-3.5 w-3.5" /> Replace
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setCommand({ what: 'goto', nonce: Date.now() })} title="Go to line (Ctrl+G)">
            <Hash className="h-3.5 w-3.5" /> Go to line
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setDirty(false)
                if (inp.data) setEditorText(inp.data.text)
              }}
            >
              Discard
            </Button>
          )}
          {!embedded && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
          {(
            <Button
              variant="primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="h-3.5 w-3.5" />
              Save INP
            </Button>
          )}
        </div>
      </header>

      <div className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]'}>
        {!embedded && <nav className="flex min-h-0 flex-col gap-4 overflow-auto" aria-label="INP sections">
          <div>
            <div className="mb-1 px-2 text-[11px] font-medium text-muted">Sections</div>
            {sections.map((s) => (
              <button
                key={`${s.name}-${s.index}`}
                type="button"
                className="block w-full truncate rounded-md px-2 py-[3px] text-left font-mono text-[12px] text-fg-soft hover:bg-fg/[0.05] hover:text-fg"
                onClick={() => setJumpTo(s.index)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {(project.data?.files ?? []).length > 0 && (
            <div>
              <div className="mb-1 px-2 text-[11px] font-medium text-muted">Project files</div>
              {(project.data?.files ?? []).map((f) => (
                <div key={f} className="truncate px-2 py-[3px] text-[12px] text-muted" title={f}>
                  {f}
                </div>
              ))}
            </div>
          )}
        </nav>}

        <section className={`flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border${embedded ? " flex-1" : ""}`}>
          <InpEditor
            value={editorText}
            onChange={(v) => {
              setEditorText(v)
              editorDraft.text = v
              setDirty(true)
            }}
            jumpTo={jumpTo}
            command={command}
          />
        </section>

      </div>
    </div>
  )
}
