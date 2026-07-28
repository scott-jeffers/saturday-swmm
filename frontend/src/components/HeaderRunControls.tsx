import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import { api } from '../api/client'
import { useRunStatus } from '../hooks/useRunStatus'
import { Badge, Button, Tooltip } from './ui'
import type { BadgeTone } from './ui/Badge'
import { cn } from '../lib/cn'

/** Compact simulation controls for the app header (top-right). */
export function HeaderRunControls() {
  const queryClient = useQueryClient()
  const { data: status } = useRunStatus()

  const start = useMutation({
    mutationFn: api.startRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      void queryClient.invalidateQueries({ queryKey: ['periods'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-info'] })
      void queryClient.invalidateQueries({ queryKey: ['2d-snapshot'] })
      void queryClient.invalidateQueries({ queryKey: ['snapshot'] })
    },
  })

  const cancel = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
    },
  })

  const running = status?.status === 'running'
  const tone = (status?.status ?? 'idle') as BadgeTone
  const progress = status?.progress ?? 0
  const message = status?.message || status?.error || ''
  const err = (start.error ?? cancel.error) as Error | null

  const tipParts = [message, status?.out_path, err?.message].filter(Boolean)
  const tip =
    tipParts.length > 0 ? (
      <span className="whitespace-pre-wrap break-all">{tipParts.join('\n')}</span>
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
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-fg-soft">
            {progress.toFixed(0)}%
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
          <span className="hidden min-w-0 max-w-[10rem] truncate text-[11px] text-muted lg:inline">
            {message || '—'}
          </span>
        </div>
      </Tooltip>
    </div>
  )
}
