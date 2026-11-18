/** Python console: run a script against the open model. */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { api } from '../api/client'
import { InpEditor } from '../components/InpEditor'
import { refreshAfterEdit } from '../components/UndoRedo'
import { Button, PageHeader } from '../components/ui'
import { getPref, setPref } from '../lib/prefs'

const EXAMPLES: [string, string][] = [
  [
    'Peak flow of every link (pyswmm)',
    `from pyswmm import Output
from swmm.toolkit.shared_enum import LinkAttribute

with Output(MODEL_OUT) as out:
    peaks = []
    for link in out.links:
        series = out.link_series(link, LinkAttribute.FLOW_RATE)
        peaks.append((max(series.values()), link))
for q, link in sorted(peaks, reverse=True)[:10]:
    print(f"{link:12} {q:10.3f}")
`,
  ],
  [
    'Count elements in each section',
    `import re
counts, section = {}, None
for line in open(MODEL_INP, encoding="utf-8", errors="replace"):
    m = re.match(r"\\s*\\[(.+?)\\]", line)
    if m:
        section = m.group(1).upper()
    elif section and line.strip() and not line.lstrip().startswith(";"):
        counts[section] = counts.get(section, 0) + 1
for k, v in counts.items():
    print(f"{k:16} {v}")
`,
  ],
  [
    "Raise Manning's n of every conduit by 10 % (edits the model; Ctrl+Z undoes it)",
    `lines, section = [], None
for line in open(MODEL_INP, encoding="utf-8").read().splitlines():
    s = line.strip()
    if s.startswith("["):
        section = s.upper()
    elif section == "[CONDUITS]" and s and not s.startswith(";"):
        t = line.split()
        t[4] = f"{float(t[4]) * 1.1:.4f}"
        line = "  ".join(t)
    lines.append(line)
open(MODEL_INP, "w", encoding="utf-8").write("\\n".join(lines) + "\\n")
print("Updated roughness")
`,
  ],
]

export function ConsolePage() {
  const qc = useQueryClient()
  const [code, setCode] = useState(() => getPref('console-code') || EXAMPLES[0][1])
  const run = useMutation({
    mutationFn: () => api.runScript(code),
    onSuccess: () => refreshAfterEdit(qc),
  })
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-6 py-5">
      <PageHeader
        title="Python console"
        description="Run Python against the open model. MODEL_INP, MODEL_OUT and MODEL_RPT hold the file paths; pyswmm is available. Changes a script makes to the .inp are one undo step."
        actions={
          <>
            <select className="field h-8 w-72" value="" onChange={(e) => e.target.value && setCode(EXAMPLES[Number(e.target.value)][1])} aria-label="Load an example">
              <option value="">Load an example…</option>
              {EXAMPLES.map(([l], i) => (
                <option key={l} value={i}>
                  {l}
                </option>
              ))}
            </select>
            <Button variant="primary" disabled={run.isPending} onClick={() => run.mutate()} title="Run (Ctrl+Enter in the editor runs the model instead)">
              <Play className="h-3.5 w-3.5 fill-current" /> {run.isPending ? 'Running…' : 'Run script'}
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <section className="min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-border">
          <InpEditor
            value={code}
            language="python"
            onChange={(v) => {
              setCode(v)
              setPref('console-code', v)
            }}
          />
        </section>
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border bg-elevated">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px] text-muted">
            Output
            {run.data && <span className={run.data.exit_code === 0 ? 'text-success' : 'text-danger'}>exit code {run.data.exit_code}</span>}
          </div>
          <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-[12px] text-fg">
            {run.isError ? <span className="text-danger">{(run.error as Error).message}</span> : null}
            {run.data?.stdout}
            {run.data?.stderr ? <span className="text-danger">{run.data.stderr}</span> : null}
            {!run.data && !run.isError && <span className="text-muted">Press Run script. Output appears here.</span>}
          </pre>
        </section>
      </div>
    </div>
  )
}
