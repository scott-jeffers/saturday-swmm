import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Play, Square } from 'lucide-react'
import { api } from '../api/client'
import type { RunStatus } from '../api/client'
import { useRunStatus } from '../hooks/useRunStatus'
import { Badge, Button, Tooltip, useToast } from './ui'
import type { BadgeTone } from './ui/Badge'
import { cn } from '../lib/cn'

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
  return clip(first)
}

function clip(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function invalidateAfterRun(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
  void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
  void queryClient.invalidateQueries({ queryKey: ['periods'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
  void queryClient.invalidateQueries({ queryKey: ['2d-snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
  void queryClient.invalidateQueries({ queryKey: ['project'] })
}

/** Compact simulation controls for the app header (top-right). */
export function HeaderRunControls() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: status } = useRunStatus()
  const prevStatus = useRef<RunStatus | undefined>(undefined)

  const start = useMutation({
    mutationFn: api.startRun,
    onSuccess: () => {
      invalidateAfterRun(queryClient)
    },
    onError: (err) => {
      toast({
        title: 'Could not start run',
        description: (err as Error).message || 'Unknown error',
        tone: 'danger',
      })
    },
  })

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
    } else if (
      (next === 'completed' || next === 'cancelled' || next === 'failed') &&
      prev === 'running'
    ) {
      invalidateAfterRun(queryClient)
    }
    prevStatus.current = next
  }, [status?.status, status?.error, status?.message, toast, queryClient])

  const running = status?.status === 'running'
  const tone = (status?.status ?? 'idle') as BadgeTone
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

  return (
    <div className="flex min-w-0 max-w-[min(36rem,52vw)] items-center gap-2">
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="primary"
          size="sm"
          className="h-7 px-2.5"
          disabled={running || start.isPending}
          onClick={() => start.mutate()}
        >
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="h-7 px-2"
          disabled={!running || cancel.isPending}
          onClick={() => cancel.mutate()}
          aria-label="Cancel run"
        >
          <Square className="h-3 w-3" />
        </Button>
      </div>

      <Badge tone={tone} className="shrink-0">
        {status?.status ?? 'idle'}
      </Badge>

      <Tooltip content={tip} side="bottom">
        <div className="flex min-w-0 flex-1 cursor-default items-center gap-2">
          {running && (
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin text-accent-strong"
              aria-label="Simulation running"
            />
          )}
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-fg-soft">
            {progress.toFixed(1)}%
          </span>
          <div className="h-1.5 min-w-[4rem] flex-1 overflow-hidden rounded-full bg-border" aria-hidden>
            <div
              className={cn(
                'h-full rounded-full transition-[width]',
                running
                  ? 'bg-gradient-to-r from-accent-strong to-accent-soft'
                  : status?.status === 'failed'
                    ? 'bg-danger'
                    : 'bg-accent-soft/80',
              )}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
          <span
            className={cn(
              'min-w-0 truncate text-[11px] tabular-nums',
              running
                ? 'max-w-[12rem] text-fg-soft'
                : 'hidden max-w-[14rem] text-muted lg:inline',
              status?.status === 'failed' && !running && 'text-danger',
            )}
            title={stepLabel || displayMessage || undefined}
          >
            {(running ? stepLabel || displayMessage : displayMessage) || '—'}
          </span>
        </div>
      </Tooltip>
    </div>
  )
}
