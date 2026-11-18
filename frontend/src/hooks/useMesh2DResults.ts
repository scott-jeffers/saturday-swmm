/**
 * Fetch + LRU-cache binary 2D depth snapshots; prefetch adjacent periods.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type TwoDBinarySnapshot } from '../api/client'
import { MESH_SNAPSHOT_CACHE_SIZE } from '../lib/meshConstants'

type CacheEntry = TwoDBinarySnapshot

export type Mesh2DSource = 'openswmm'

export type UseMesh2DResultsArgs = {
  enabled: boolean
  period: number
  periodCount: number
  /** When true, fetch envelope instead of a period snapshot. */
  envelope?: boolean
  variable?: string
  /** Results source (OpenSWMM *.2d.h5). */
  source?: Mesh2DSource
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
  source = 'openswmm',
}: UseMesh2DResultsArgs): UseMesh2DResultsResult {
  const [data, setData] = useState<TwoDBinarySnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const orderRef = useRef<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const cacheKey = useCallback(
    (p: number | 'env') => `${source}:${variable}:${p}`,
    [source, variable],
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

  const fetchPeriod = useCallback(
    (p: number, signal?: AbortSignal) =>
      api.fetchTwoDSnapshotBinary(p, variable, signal),
    [variable],
  )

  const prefetch = useCallback(
    (p: number) => {
      if (p < 0 || p >= periodCount) return
      const key = cacheKey(p)
      if (cacheRef.current.has(key)) return
      void fetchPeriod(p)
        .then((snap) => putCache(key, snap))
        .catch(() => {
          /* ignore prefetch errors */
        })
    },
    [cacheKey, fetchPeriod, periodCount, putCache],
  )

  useEffect(() => {
    // Clear cache when switching engines so periods do not collide.
    cacheRef.current.clear()
    orderRef.current = []
  }, [source])

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
      : fetchPeriod(period, ac.signal)

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
  }, [
    enabled,
    period,
    periodCount,
    envelope,
    variable,
    source,
    cacheKey,
    putCache,
    prefetch,
    fetchPeriod,
  ])

  return {
    data,
    isLoading,
    isError: Boolean(error),
    error,
  }
}
