import Editor from '@monaco-editor/react'
import '../lib/monacoSetup'
import { useEffect, useRef } from 'react'

interface InpEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  jumpTo?: number | null
}

type MonacoEditorInstance = {
  getModel: () => { getPositionAt: (offset: number) => unknown } | null
  revealPositionInCenter: (pos: unknown) => void
  setPosition: (pos: unknown) => void
  focus: () => void
}

export function InpEditor({
  value,
  onChange,
  readOnly = false,
  jumpTo = null,
}: InpEditorProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null)

  useEffect(() => {
    if (jumpTo == null || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return
    const pos = model.getPositionAt(jumpTo)
    editorRef.current.revealPositionInCenter(pos)
    editorRef.current.setPosition(pos)
    editorRef.current.focus()
  }, [jumpTo])

  return (
    <div className="editor-shell h-full min-h-[360px] overflow-hidden">
      <Editor
        height="100%"
        defaultLanguage="ini"
        theme="vs-dark"
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
