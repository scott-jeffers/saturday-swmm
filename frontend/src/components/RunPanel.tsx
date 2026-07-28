import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import { api } from '../api/client'
import { useRunStatus } from '../hooks/useRunStatus'
import { Badge, Button, Panel } from './ui'
import type { BadgeTone } from './ui/Badge'

/** SWMM MM/DD/YYYY + HH:MM:SS → datetime-local YYYY-MM-DDTHH:MM */
function toLocalInput(date?: string | null, time?: string | null): string {
  if (!date) return ''
  const dp = date.replace(/-/g, '/').split('/')
  let y = 0
  let m = 0
  let d = 0
  if (dp.length === 3) {
    if (dp[0].length === 4) {
      y = Number(dp[0])
      m = Number(dp[1])
      d = Number(dp[2])
    } else {
      m = Number(dp[0])
      d = Number(dp[1])
      y = Number(dp[2])
    }
  }
  if (!y || !m || !d) return ''
  const tp = (time || '00:00:00').split(':')
  const hh = String(Number(tp[0] || 0)).padStart(2, '0')
  const mi = String(Number(tp[1] || 0)).padStart(2, '0')
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${hh}:${mi}`
}

/** datetime-local → SWMM date/time parts */
function fromLocalInput(value: string): { date: string; time: string } | null {
  if (!value) return null
  const [datePart, timePart] = value.split('T')
  if (!datePart || !timePart) return null
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mi] = timePart.split(':').map(Number)
  if (!y || !m || !d) return null
  return {
    date: `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`,
    time: `${String(hh || 0).padStart(2, '0')}:${String(mi || 0).padStart(2, '0')}:00`,
  }
}

export function RunPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient()
  const { data: status } = useRunStatus()
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')

  const windowQ = useQuery({
    queryKey: ['simulation-window'],
    queryFn: api.getSimulationWindow,
    retry: false,
  })

  useEffect(() => {
    if (!windowQ.data) return
    setStartLocal(toLocalInput(windowQ.data.start_date, windowQ.data.start_time))
    setEndLocal(toLocalInput(windowQ.data.end_date, windowQ.data.end_time))
  }, [windowQ.data])

  const saveWindow = useMutation({
    mutationFn: async () => {
      const s = fromLocalInput(startLocal)
      const e = fromLocalInput(endLocal)
      if (!s || !e) throw new Error('Enter valid start and end date/time')
      return api.setSimulationWindow({
        start_date: s.date,
        start_time: s.time,
        end_date: e.date,
        end_time: e.time,
        sync_report_start: true,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['simulation-window'] })
      void queryClient.invalidateQueries({ queryKey: ['inp'] })
    },
  })

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
  const error = start.error ?? cancel.error ?? saveWindow.error
  const tone = (status?.status ?? 'idle') as BadgeTone
  const dirty =
    Boolean(windowQ.data) &&
    (startLocal !== toLocalInput(windowQ.data?.start_date, windowQ.data?.start_time) ||
      endLocal !== toLocalInput(windowQ.data?.end_date, windowQ.data?.end_time))

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

      <div className="mt-3 space-y-2">
        <label className="block text-xs text-muted">
          Start
          <input
            type="datetime-local"
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            disabled={running}
          />
        </label>
        <label className="block text-xs text-muted">
          End
          <input
            type="datetime-local"
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            disabled={running}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saveWindow.isPending || running}
          onClick={() => saveWindow.mutate()}
        >
          {saveWindow.isPending ? 'Saving…' : 'Apply times to INP'}
        </Button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-strong to-accent-soft transition-[width]"
          style={{ width: `${Math.min(100, status?.progress ?? 0)}%` }}
        />
      </div>

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
