import { IS_VIEWER } from '../lib/mode'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { api } from '../api/client'
import { InpEditor } from '../components/InpEditor'
import { Button, useToast } from '../components/ui'

interface EditorPageProps {
  projectPath: string
  onClose: () => void
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

export function EditorPage({ projectPath, onClose }: EditorPageProps) {
  const [editorText, setEditorText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [jumpTo, setJumpTo] = useState<number | null>(null)
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
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[19px] font-semibold tracking-[-0.01em] text-fg">
            {project.data?.inp_name ?? 'Project'}
            {dirty && !IS_VIEWER ? <span className="ml-2 align-middle text-[12px] font-medium text-warning">Unsaved changes</span> : null}
          </h1>
          <p className="m-0 mt-1 truncate text-[12px] text-muted">{project.data?.path ?? projectPath}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!IS_VIEWER && (
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex min-h-0 flex-col gap-4 overflow-auto" aria-label="INP sections">
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
        </nav>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border">
          <InpEditor
            value={editorText}
            onChange={(v) => {
              setEditorText(v)
              setDirty(true)
            }}
            jumpTo={jumpTo}
            readOnly={IS_VIEWER}
          />
        </section>

      </div>
    </div>
  )
}
