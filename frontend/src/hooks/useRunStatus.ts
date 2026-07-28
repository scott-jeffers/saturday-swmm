import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export function useRunStatus(enabled = true) {
  return useQuery({
    queryKey: ['runStatus'],
    queryFn: api.getRunStatus,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 500 : false,
  })
}
