import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import { api } from '../api/client'
import { useRunStatus } from '../hooks/useRunStatus'
import { Badge, Button, Panel } from './ui'
import type { BadgeTone } from './ui/Badge'

export function RunPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient()
  const { data: status } = useRunStatus()

  const start = useMutation({
    mutationFn: api.startRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
    },
  })

  const cancel = useMutation({
    mutationFn: api.cancelRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runStatus'] })
    },
  })

  const running = status?.status === 'running'
  const error = start.error ?? cancel.error
  const tone = (status?.status ?? 'idle') as BadgeTone

  return (
    <Panel title="Simulation">
      <div className="flex gap-2">
        <Button
          variant="primary"
          size={compact ? 'sm' : 'md'}
          disabled={running || start.isPending}
          onClick={() => start.mutate()}
        >
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button
          variant="danger"
          size={compact ? 'sm' : 'md'}
          disabled={!running || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <Square className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Status</dt>
        <dd>
          <Badge tone={tone}>{status?.status ?? 'idle'}</Badge>
        </dd>
        <dt className="text-muted">Progress</dt>
        <dd>{(status?.progress ?? 0).toFixed(1)}%</dd>
        <dt className="text-muted">Message</dt>
        <dd className="truncate text-fg-soft">{status?.message || '—'}</dd>
      </dl>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-strong to-accent-soft transition-[width]"
          style={{ width: `${Math.min(100, status?.progress ?? 0)}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Window, steps, and threads live in{' '}
        <Link to="/settings" className="text-accent-soft underline-offset-2 hover:underline">
          Settings
        </Link>
        .
      </p>

      {status?.error && (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-danger/30 bg-surface p-2 text-xs text-danger">
          {status.error}
        </pre>
      )}
      {error && <p className="mt-2 text-sm text-danger">{(error as Error).message}</p>}

      {status?.out_path && (status.status === 'completed' || status.status === 'idle') && (
        <p className="mt-2 text-xs text-muted">
          {status.message === 'Existing results loaded' ? 'Using existing output: ' : 'Output: '}
          {status.out_path}
        </p>
      )}
    </Panel>
  )
}
