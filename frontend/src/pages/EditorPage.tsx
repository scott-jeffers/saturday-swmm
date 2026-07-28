import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { api } from '../api/client'
import { InpEditor } from '../components/InpEditor'
import { Button, Panel, useToast } from '../components/ui'
import { cn } from '../lib/cn'

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
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold">
            {project.data?.inp_name ?? 'Project'}
            {dirty ? <span className="ml-2 text-sm font-medium text-warning">• unsaved</span> : null}
          </h1>
          <p className="m-0 text-sm text-muted">{project.data?.path ?? projectPath}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="h-3.5 w-3.5" />
            Save INP
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[180px_minmax(0,1fr)_300px]">
        <Panel title="Sections" className="max-h-full overflow-auto">
          <ul className="m-0 list-none space-y-0.5 p-0">
            {sections.map((s) => (
              <li key={`${s.name}-${s.index}`}>
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-border/50 hover:text-fg',
                  )}
                  onClick={() => setJumpTo(s.index)}
                >
                  [{s.name}]
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border">
          <InpEditor
            value={editorText}
            onChange={(v) => {
              setEditorText(v)
              setDirty(true)
            }}
            jumpTo={jumpTo}
          />
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto">
          <Panel title="Files">
            <ul className="m-0 list-disc space-y-1 pl-4 text-sm text-fg-soft">
              {(project.data?.files ?? []).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
