import { useResolvedTheme } from '../lib/theme'
import Editor from '@monaco-editor/react'
import '../lib/monacoSetup'
import { useEffect, useRef } from 'react'

interface InpEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  jumpTo?: number | null
  /** Change the nonce to run a command (find, replace, go to line). */
  command?: { what: InpEditorCommand; nonce: number } | null
}

type MonacoEditorInstance = {
  getModel: () => { getPositionAt: (offset: number) => unknown } | null
  revealPositionInCenter: (pos: unknown) => void
  setPosition: (pos: unknown) => void
  focus: () => void
  getAction: (id: string) => { run: () => Promise<void> } | null
}

export type InpEditorCommand = 'find' | 'replace' | 'goto'

export function InpEditor({
  value,
  onChange,
  readOnly = false,
  jumpTo = null,
  command = null,
}: InpEditorProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const theme = useResolvedTheme()

  useEffect(() => {
    if (jumpTo == null || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return
    const pos = model.getPositionAt(jumpTo)
    editorRef.current.revealPositionInCenter(pos)
    editorRef.current.setPosition(pos)
    editorRef.current.focus()
  }, [jumpTo])

  useEffect(() => {
    if (!command || !editorRef.current) return
    const id = { find: 'actions.find', replace: 'editor.action.startFindReplaceAction', goto: 'editor.action.gotoLine' }[command.what]
    editorRef.current.focus()
    void editorRef.current.getAction(id)?.run()
  }, [command])

  return (
    <div className="editor-shell h-full min-h-[360px] overflow-hidden">
      <Editor
        height="100%"
        defaultLanguage="ini"
        theme={theme === 'light' ? 'vs' : 'vs-dark'}
        value={value}
        onMount={(ed) => {
          editorRef.current = ed as unknown as MonacoEditorInstance
        }}
        onChange={(v) => onChange(v ?? '')}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 8 },
        }}
      />
    </div>
  )
}
