import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks, Loader2, Play, Square } from 'lucide-react'
import { api, ENGINE_LABELS } from '../api/client'
import type { ModelCheck, RunStatus } from '../api/client'
import { ModelCheckDialog } from './ModelCheckDialog'
import { useRunStatus } from '../hooks/useRunStatus'
import { getLiveRendering } from '../lib/liveRenderingStore'
import { Button, Tooltip, useToast } from './ui'
import { explainEngineMessage } from '../lib/engineErrors'
import { useRunSummary } from './RunSummaryCard'
import { useT } from '../lib/i18n'

/** Prefer the exception line; drop Python traceback noise for UI surfaces. */
function summarizeRunError(
  error: string | null | undefined,
  fallback = 'Simulation failed',
): string {
  if (!error?.trim()) return fallback
  const lines = error
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  // Backend format: `${exc}\n${traceback}` — first line is the useful reason.
  const first = lines[0] ?? fallback
  // If the first line is only "Traceback ...", take the last non-file line.
  if (/^traceback/i.test(first)) {
    const last = [...lines].reverse().find((l) => !/^\s*File\s+"/i.test(l) && !/^traceback/i.test(l))
    return clip(last || fallback)
  }
  const e = explainEngineMessage(first)
  return clip(e.hint ? `${e.text} ${e.hint}` : e.text)
}

function clip(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function invalidateAfterRun(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
  void queryClient.invalidateQueries({ queryKey: ['run-live-snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
  void queryClient.invalidateQueries({ queryKey: ['periods'] })
  void queryClient.invalidateQueries({ queryKey: ['out-periods'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['out-snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['project'] })
  void queryClient.invalidateQueries({ queryKey: ['flow-accum'] })
  void queryClient.invalidateQueries({ queryKey: ['rpt-summary'] })
}

function startRun() {
  return api.startRun({ live_rendering: getLiveRendering() })
}

/** Compact simulation controls for the app header (top-right). */
export function HeaderRunControls() {
  const t = useT()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: status } = useRunStatus()
  const prevStatus = useRef<RunStatus | undefined>(undefined)

  const project = useQuery({
    queryKey: ['project'],
    queryFn: api.currentProject,
  })

  const start = useMutation({
    mutationFn: startRun,
    onSuccess: () => {
      invalidateAfterRun(queryClient)
    },
    onError: (err) => {
      const msg = (err as Error).message || 'Unknown error'
      toast({
        title: 'Could not start run',
        description: msg,
        tone: 'danger',
      })
    },
  })

  const [check, setCheck] = useState<ModelCheck | undefined>()
  const [checkOpen, setCheckOpen] = useState(false)
  const [checkBeforeRun, setCheckBeforeRun] = useState(false)
  const checking = useMutation({
    mutationFn: api.checkModel,
    onSuccess: (c) => setCheck(c),
  })
  const openCheck = () => {
    setCheck(undefined)
    setCheckBeforeRun(false)
    setCheckOpen(true)
    checking.mutate()
  }
  // Run = check first; only stop to ask when the check finds errors.
  const runWithCheck = async () => {
    try {
      const c = await checking.mutateAsync()
      if (c.errors > 0) {
        setCheck(c)
        setCheckBeforeRun(true)
        setCheckOpen(true)
        return
      }
    } catch {
      /* a failed check never blocks a run */
    }
    start.mutate()
  }

  // Ctrl/Cmd+Enter runs, Ctrl/Cmd+Shift+K checks (anywhere in the app).
  const keyRef = useRef({ run: runWithCheck, check: openCheck, busy: false })
  keyRef.current = { run: runWithCheck, check: openCheck, busy: status?.status === 'running' || start.isPending }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || keyRef.current.busy) return
      if (e.key === 'Enter' && !e.shiftKey && !(e.target as HTMLElement | null)?.closest?.('.monaco-editor')) {
        e.preventDefault()
        void keyRef.current.run()
      } else if (e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        keyRef.current.check()
      }
    }
    window.addEventListener('keydown', onKey)
    const onRun = () => !keyRef.current.busy && void keyRef.current.run()
    const onCheck = () => keyRef.current.check()
    window.addEventListener('saturday-swmm-run', onRun)
    window.addEventListener('saturday-swmm-check', onCheck)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('saturday-swmm-run', onRun)
      window.removeEventListener('saturday-swmm-check', onCheck)
    }
  }, [])

  const cancel = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
    },
    onError: (err) => {
      toast({
        title: 'Could not cancel run',
        description: (err as Error).message || 'Unknown error',
        tone: 'danger',
      })
    },
  })

  // Toast when a live run ends in failure (async job error already on status.error).
  useEffect(() => {
    const next = status?.status
    const prev = prevStatus.current
    if (next === 'failed' && prev === 'running') {
      toast({
        title: 'Simulation failed',
        description: summarizeRunError(status?.error, status?.message || 'Simulation failed'),
        tone: 'danger',
      })
      invalidateAfterRun(queryClient)
    } else if (next === 'completed' && prev === 'running') {
      toast({
        title: 'Simulation completed',
        description: status?.engine ? `${ENGINE_LABELS[status.engine]} · results are ready` : 'Results are ready',
        tone: 'success',
      })
      invalidateAfterRun(queryClient)
    } else if ((next === 'cancelled' || next === 'failed') && prev === 'running') {
      invalidateAfterRun(queryClient)
    }
    prevStatus.current = next
  }, [status?.status, status?.error, status?.message, status?.engine, toast, queryClient])

  const running = status?.status === 'running'
  const progress = status?.progress ?? 0
  const stepLabel =
    status?.step_count != null
      ? status.expected_steps != null
        ? `Step ${status.step_count.toLocaleString()} / ${status.expected_steps.toLocaleString()}`
        : `Step ${status.step_count.toLocaleString()}`
      : ''
  const displayMessage =
    status?.status === 'failed'
      ? summarizeRunError(status?.error, status?.message || 'Simulation failed')
      : status?.message || status?.error || ''
  const err = (start.error ?? cancel.error) as Error | null
  const starting = start.isPending

  const tipParts = [
    status?.status === 'failed' ? status?.error || displayMessage : displayMessage,
    status?.out_path,
    err?.message,
  ].filter(Boolean)
  const tip =
    tipParts.length > 0 ? (
      <span className="whitespace-pre-wrap break-all">{tipParts.join('\n\n')}</span>
    ) : (
      'Simulation'
    )

  const summary = useRunSummary(status?.status)
  const stale = Boolean(project.data?.results_stale)
  const sm = summary.data?.available ? summary.data : undefined
  const resultsTip = sm
    ? [
        stale ? 'The model changed after this run. Run again to update the results.' : null,
        `Continuity error: runoff ${sm.runoff_continuity_pct?.toFixed(2) ?? '—'} %, routing ${sm.routing_continuity_pct?.toFixed(2) ?? '—'} %`,
        `${sm.flooded_nodes ?? 0} flooded nodes, ${sm.surcharged_conduits ?? 0} surcharged conduits`,
        sm.elapsed ? `Run time ${sm.elapsed}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : tip
  const failed = status?.status === 'failed'
  const completed = status?.status === 'completed'
  const busy = running || starting
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Tooltip content="Check the model for errors (Ctrl+Shift+K)" side="bottom">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-soft hover:bg-fg/[0.06] hover:text-fg disabled:opacity-40"
          disabled={running}
          onClick={openCheck}
          aria-label="Check model"
        >
          <ListChecks className="h-4 w-4" />
          <span className="hidden xl:inline">{t('Check')}</span>
        </button>
      </Tooltip>
      <ModelCheckDialog
        open={checkOpen}
        onOpenChange={setCheckOpen}
        check={check}
        onRunAnyway={checkBeforeRun ? () => start.mutate() : undefined}
      />

      {busy ? (
        <Tooltip content={tip} side="bottom">
          <span className="inline-flex h-8 items-center gap-2 rounded-md bg-accent/10 px-2.5 text-[12px] text-accent-soft tabular-nums">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={starting ? 'Starting run' : 'Simulation running'} />
            {starting ? 'Starting…' : `Running ${progress.toFixed(0)}%`}
            {stepLabel && <span className="hidden text-muted 2xl:inline">{stepLabel}</span>}
          </span>
        </Tooltip>
      ) : failed ? (
        <Tooltip content={tip} side="bottom">
          <span className="inline-flex h-8 cursor-default items-center gap-1.5 rounded-md px-2 text-[12px] text-danger">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden /> {t('Run failed')}
          </span>
        </Tooltip>
      ) : completed || project.data?.has_out ? (
        <Tooltip content={<span className="whitespace-pre-line">{resultsTip}</span>} side="bottom">
          <span className={`hidden h-8 cursor-default items-center gap-1.5 px-1.5 text-[12px] lg:inline-flex ${stale ? 'text-warning' : 'text-muted'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-warning' : 'bg-success'}`} aria-hidden />
            {stale ? t('Results out of date') : t('Results ready')}
          </span>
        </Tooltip>
      ) : null}

      {running ? (
        <Button variant="outline" size="md" disabled={cancel.isPending} onClick={() => cancel.mutate()} aria-label="Stop the run">
          <Square className="h-3 w-3 fill-current" /> {t('Stop')}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="md"
          disabled={start.isPending || checking.isPending}
          onClick={() => void runWithCheck()}
          title={`Run with ${ENGINE_LABELS[project.data?.simulation_engine ?? 'openswmm']} (Ctrl+Enter)`}
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          {t('Run')}
        </Button>
      )}
      {busy && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden>
          <span className="block h-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(3, Math.min(100, starting ? 3 : progress))}%` }} />
        </span>
      )}
    </div>
  )
}
