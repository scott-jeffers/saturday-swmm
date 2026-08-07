/**
 * Fetch + LRU-cache binary 2D depth snapshots; prefetch adjacent periods.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type TwoDBinarySnapshot } from '../api/client'
import { MESH_SNAPSHOT_CACHE_SIZE } from '../lib/meshConstants'

type CacheEntry = TwoDBinarySnapshot

export type UseMesh2DResultsArgs = {
  enabled: boolean
  period: number
  periodCount: number
  /** When true, fetch envelope instead of a period snapshot. */
  envelope?: boolean
  variable?: string
}

export type UseMesh2DResultsResult = {
  data: TwoDBinarySnapshot | null
  isLoading: boolean
  isError: boolean
  error: Error | null
}

export function useMesh2DResults({
  enabled,
  period,
  periodCount,
  envelope = false,
  variable = 'depth',
}: UseMesh2DResultsArgs): UseMesh2DResultsResult {
  const [data, setData] = useState<TwoDBinarySnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const orderRef = useRef<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const cacheKey = useCallback(
    (p: number | 'env') => `${variable}:${p}`,
    [variable],
  )

  const putCache = useCallback((key: string, entry: CacheEntry) => {
    const cache = cacheRef.current
    const order = orderRef.current
    if (cache.has(key)) {
      order.splice(order.indexOf(key), 1)
    }
    cache.set(key, entry)
    order.push(key)
    while (order.length > MESH_SNAPSHOT_CACHE_SIZE) {
      const evict = order.shift()
      if (evict) cache.delete(evict)
    }
  }, [])

  const prefetch = useCallback(
    (p: number) => {
      if (p < 0 || p >= periodCount) return
      const key = cacheKey(p)
      if (cacheRef.current.has(key)) return
      void api
        .fetchTwoDSnapshotBinary(p, variable)
        .then((snap) => putCache(key, snap))
        .catch(() => {
          /* ignore prefetch errors */
        })
    },
    [cacheKey, periodCount, putCache, variable],
  )

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setIsLoading(false)
      setError(null)
      return
    }

    const key = envelope ? cacheKey('env') : cacheKey(period)
    const hit = cacheRef.current.get(key)
    if (hit) {
      setData(hit)
      setIsLoading(false)
      setError(null)
      if (!envelope) {
        prefetch(period - 1)
        prefetch(period + 1)
      }
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setIsLoading(true)
    setError(null)

    const run = envelope
      ? api.fetchTwoDEnvelopeBinary(variable, ac.signal)
      : api.fetchTwoDSnapshotBinary(period, variable, ac.signal)

    void run
      .then((snap) => {
        if (ac.signal.aborted) return
        putCache(key, snap)
        setData(snap)
        setIsLoading(false)
        if (!envelope) {
          prefetch(period - 1)
          prefetch(period + 1)
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return
        }
        setError(err instanceof Error ? err : new Error(String(err)))
        setIsLoading(false)
      })

    return () => ac.abort()
  }, [enabled, period, envelope, variable, cacheKey, putCache, prefetch])

  return {
    data,
    isLoading,
    isError: Boolean(error),
    error,
  }
}
