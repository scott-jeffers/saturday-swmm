/** A short, dismissible checklist the first few times someone opens a model. */

import { Check, X } from 'lucide-react'
import { setPref, usePref } from '../../lib/prefs'

type Step = { label: string; detail: string; done: boolean }

export function GettingStarted({ selected, ran, hasScenarios, viewer = false }: { selected: boolean; ran: boolean; hasScenarios: boolean; viewer?: boolean }) {
  const dismissed = usePref('guide-dismissed') === '1'
  if (dismissed) return null
  const steps: Step[] = viewer ? [
    { label: 'Click a pipe or node', detail: 'Its properties open on the right.', done: selected },
    { label: 'Load results', detail: 'Add the .rpt and .out from a run under Add files.', done: ran },
    { label: 'Play the storm', detail: 'Press Play or Peak on the time bar, or open the Profile tab.', done: false },
    { label: 'Compare two runs', detail: 'Add a second run’s files, then Results → Compare runs.', done: hasScenarios },
  ] : [
    { label: 'Click a pipe or node', detail: 'Its properties open on the right, ready to edit.', done: selected },
    { label: 'Press Run', detail: 'Or Ctrl+Enter. The model is checked first.', done: ran },
    { label: 'Read the results', detail: 'Colors show peak depth and flow; Results has the tables.', done: ran },
    { label: 'Try a what-if', detail: 'Make a scenario from the Base menu, change it, run, then compare.', done: hasScenarios },
  ]
  const left = steps.filter((s) => !s.done).length
  const expandedPref = usePref('guide-expanded')
  // After the first run the card folds to a small pill unless the user opens it.
  const collapsed = expandedPref ? expandedPref === '0' : ran
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setPref('guide-expanded', '1')}
        className="map-overlay pointer-events-auto absolute bottom-3 left-14 z-20 inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] text-fg-soft hover:text-fg"
      >
        <Check className="h-3 w-3 text-success" />
        Getting started: {steps.length - left} of {steps.length} done
      </button>
    )
  }
  return (
    <section
      aria-label="Getting started"
      className="pointer-events-auto absolute bottom-12 left-14 z-20 w-72 map-overlay p-3 text-xs"
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="m-0 flex-1 text-sm font-semibold text-fg">{left ? 'Getting started' : 'You’re all set'}</h2>
        <button
          type="button"
          aria-label="Fold getting started"
          onClick={() => setPref('guide-expanded', '0')}
          className="rounded px-1 text-[11px] text-muted hover:bg-fg/5 hover:text-fg"
        >
          Fold
        </button>
        <button
          type="button"
          aria-label="Hide getting started"
          onClick={() => setPref('guide-dismissed', '1')}
          className="rounded p-1 text-muted hover:bg-fg/5 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <ol className="m-0 list-none space-y-2 p-0">
        {steps.map((s, i) => (
          <li key={s.label} className="flex gap-2">
            <span
              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                s.done ? 'bg-success/20 text-success' : 'border border-border-strong text-muted'
              }`}
            >
              {s.done ? <Check className="h-3 w-3" aria-label="Done" /> : i + 1}
            </span>
            <span>
              <span className={s.done ? 'text-muted line-through' : 'text-fg'}>{s.label}</span>
              <span className="block text-muted">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-0 mt-2 text-[11px] text-muted">Press ? any time for keyboard shortcuts.</p>
    </section>
  )
}
