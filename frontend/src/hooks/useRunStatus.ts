import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/** Keep polling briefly after leave-running so the terminal status is not missed. */
const POST_RUN_POLL_MS = 2500

export function useRunStatus(enabled = true) {
  const lastRunningAt = useRef(0)

  return useQuery({
    queryKey: ['runStatus'],
    queryFn: api.getRunStatus,
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'running') {
        lastRunningAt.current = Date.now()
        return 500
      }
      if (
        lastRunningAt.current > 0 &&
        Date.now() - lastRunningAt.current < POST_RUN_POLL_MS
      ) {
        return 400
      }
      return false
    },
  })
}
