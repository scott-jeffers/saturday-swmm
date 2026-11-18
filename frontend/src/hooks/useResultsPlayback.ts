/**
 * Coordinated 1D/2D results playback: period scrubbing, envelope mode, live vs post-run.
 */

import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  api,
  type LiveSnapshotResponse,
  type OutSnapshotResponse,
  type TwoDBinarySnapshot,
  type TwoDSnapshotResponse,
} from '../api/client'
import { MESH_LARGE_THRESHOLD } from '../lib/meshConstants'
import { useMesh2DResults, type Mesh2DSource } from './useMesh2DResults'

function liveToOutSnapshot(live: LiveSnapshotResponse): OutSnapshotResponse {
  return {
    period: -1,
    time: live.time ?? null,
    node_ids: live.node_ids,
    link_ids: live.link_ids,
    subcatchment_ids: live.subcatchment_ids ?? [],
    node_depths: live.node_depths,
    link_flows: live.link_flows,
    subcatchment_runoffs: live.subcatchment_runoffs ?? [],
    node_depth_min: live.node_depth_min,
    node_depth_max: live.node_depth_max,
    link_flow_min: live.link_flow_min,
    link_flow_max: live.link_flow_max,
    subcatchment_runoff_min: live.subcatchment_runoff_min ?? 0,
    subcatchment_runoff_max: live.subcatchment_runoff_max ?? 0,
  }
}

function liveToTwoDSnapshot(live: LiveSnapshotResponse): TwoDSnapshotResponse | null {
  if (!live.has_twod || !(live.twod_values?.length ?? 0)) return null
  return {
    period: -1,
    time: live.time ?? null,
    triangle_count: live.twod_triangle_count ?? live.twod_values!.length,
    values: live.twod_values!,
    value_min: live.twod_value_min ?? 0,
    value_max: live.twod_value_max ?? 0,
    variable: 'depth',
    unit: '',
  }
}

export type UseResultsPlaybackArgs = {
  projectPath: string
  inpPath?: string | null
  hasOut?: boolean
  runStatus?: string | null
  liveActive: boolean
  resultsSymbology: boolean
  show2dDepth: boolean
  hasTwoDResults: boolean
  triangleCount: number
  meshSource?: Mesh2DSource
}

export function useResultsPlayback({
  projectPath,
  inpPath,
  hasOut,
  runStatus,
  liveActive,
  resultsSymbology,
  show2dDepth,
  hasTwoDResults,
  triangleCount,
  meshSource = 'openswmm',
}: UseResultsPlaybackArgs) {
  const [period, setPeriod] = useState(0)
  const [queryPeriod, setQueryPeriod] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showAllPeaks, setShowAllPeaks] = useState(false)

  const largeMesh = triangleCount >= MESH_LARGE_THRESHOLD

  useEffect(() => {
    const t = window.setTimeout(() => setQueryPeriod(period), 130)
    return () => window.clearTimeout(t)
  }, [period])

  useEffect(() => {
    if (liveActive) {
      setPlaying(false)
      setShowAllPeaks(false)
    }
  }, [liveActive])

  const liveSnapshot = useQuery({
    queryKey: ['run-live-snapshot', projectPath],
    queryFn: api.getLiveSnapshot,
    enabled: liveActive,
    refetchInterval: liveActive ? 500 : false,
    staleTime: 0,
  })

  const periods = useQuery({
    queryKey: ['out-periods', inpPath, hasOut, runStatus],
    queryFn: api.getOutPeriods,
    enabled: Boolean(inpPath && hasOut),
    retry: false,
  })

  const snapshot = useQuery({
    queryKey: ['out-snapshot', queryPeriod, inpPath, runStatus],
    queryFn: () => api.getOutSnapshot(queryPeriod),
    enabled: Boolean(
      !liveActive && !showAllPeaks && periods.data && periods.data.period_count > 0,
    ),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const outEnvelope = useQuery({
    queryKey: ['out-envelope', inpPath, runStatus],
    queryFn: api.getOutEnvelope,
    enabled: Boolean(
      !liveActive && showAllPeaks && periods.data && periods.data.period_count > 0,
    ),
    staleTime: 60_000,
    retry: false,
  })

  const twodPeriods = useQuery({
    queryKey: ['2d-periods', projectPath, inpPath, runStatus],
    queryFn: api.getTwoDPeriods,
    enabled: Boolean(hasTwoDResults),
    staleTime: 60_000,
    retry: false,
  })

  const twodSnapshot = useQuery({
    queryKey: ['2d-snapshot', queryPeriod, inpPath, runStatus],
    queryFn: () => api.getTwoDSnapshot(queryPeriod, 'depth'),
    enabled: Boolean(
      !largeMesh &&
        !liveActive &&
        !showAllPeaks &&
        hasTwoDResults &&
        periods.data &&
        periods.data.period_count > 0 &&
        resultsSymbology &&
        show2dDepth,
    ),
    placeholderData: keepPreviousData,
    retry: false,
  })

  const twodEnvelope = useQuery({
    queryKey: ['2d-envelope', inpPath, runStatus],
    queryFn: () => api.getTwoDEnvelope('depth'),
    enabled: Boolean(
      !largeMesh &&
        !liveActive &&
        showAllPeaks &&
        hasTwoDResults &&
        resultsSymbology &&
        show2dDepth,
    ),
    staleTime: 60_000,
    retry: false,
  })

  const twodPeriodCount = twodPeriods.data?.period_count ?? 0
  const outPeriodCount = periods.data?.period_count ?? 0

  const scrubberPeriodCount = outPeriodCount || twodPeriodCount

  const twodQueryPeriod =
    twodPeriodCount > 0 ? Math.min(queryPeriod, twodPeriodCount - 1) : queryPeriod

  const twodBinary = useMesh2DResults({
    enabled: Boolean(
      largeMesh &&
        !liveActive &&
        hasTwoDResults &&
        twodPeriodCount > 0 &&
        resultsSymbology &&
        show2dDepth,
    ),
    period: twodQueryPeriod,
    periodCount: twodPeriodCount,
    envelope: showAllPeaks,
    variable: 'depth',
    source: meshSource,
  })

  // Keep period in range when periods load / shrink.
  useEffect(() => {
    const n = scrubberPeriodCount
    if (n > 0 && period >= n) setPeriod(n - 1)
  }, [scrubberPeriodCount, period])

  const displaySnapshot = useMemo((): OutSnapshotResponse | null | undefined => {
    if (liveActive && liveSnapshot.data?.available) {
      return liveToOutSnapshot(liveSnapshot.data)
    }
    if (showAllPeaks) return outEnvelope.data
    return snapshot.data
  }, [liveActive, liveSnapshot.data, showAllPeaks, outEnvelope.data, snapshot.data])

  const displayTwodSnapshot = useMemo((): TwoDSnapshotResponse | null => {
    if (liveActive && liveSnapshot.data?.available) {
      if (largeMesh) return null
      return liveToTwoDSnapshot(liveSnapshot.data)
    }
    if (largeMesh) return null
    if (showAllPeaks) return twodEnvelope.data ?? null
    return twodSnapshot.data ?? null
  }, [
    liveActive,
    liveSnapshot.data,
    showAllPeaks,
    twodEnvelope.data,
    twodSnapshot.data,
    largeMesh,
  ])

  const displayTwodBinary = useMemo((): TwoDBinarySnapshot | null => {
    if (!largeMesh) return null
    if (liveActive && liveSnapshot.data?.available && liveSnapshot.data.twod_values?.length) {
      const vals = liveSnapshot.data.twod_values
      return {
        values: Float32Array.from(vals),
        period: -1,
        triangle_count: liveSnapshot.data.twod_triangle_count ?? vals.length,
        value_min: liveSnapshot.data.twod_value_min ?? 0,
        value_max: liveSnapshot.data.twod_value_max ?? 0,
        variable: 'depth',
        unit: '',
        time: liveSnapshot.data.time ?? null,
      }
    }
    return twodBinary.data
  }, [largeMesh, liveActive, liveSnapshot.data, twodBinary.data])

  const staticSymbologyExtents = useMemo(() => {
    const depthMax = Math.max(
      periods.data?.peak_depth_max ?? displaySnapshot?.node_depth_max ?? 0.01,
      0.01,
    )
    const flowMax = Math.max(
      periods.data?.peak_flow_max ?? displaySnapshot?.link_flow_max ?? 0.01,
      0.01,
    )
    const runoffMax = Math.max(
      periods.data?.peak_runoff_max ?? displaySnapshot?.subcatchment_runoff_max ?? 0.01,
      0.01,
    )
    const twodDepthMax = Math.max(
      twodPeriods.data?.peak_depth_max ??
        twodBinary.data?.value_max ??
        twodEnvelope.data?.value_max ??
        displayTwodSnapshot?.value_max ??
        0.01,
      0.01,
    )
    return { depthMax, flowMax, runoffMax, twodDepthMax }
  }, [
    periods.data?.peak_depth_max,
    periods.data?.peak_flow_max,
    periods.data?.peak_runoff_max,
    twodPeriods.data?.peak_depth_max,
    twodEnvelope.data?.value_max,
    twodBinary.data?.value_max,
    displaySnapshot,
    displayTwodSnapshot,
  ])

  const timeLabel = useMemo(() => {
    if (liveActive && liveSnapshot.data?.available && liveSnapshot.data.time) {
      return liveSnapshot.data.time
    }
    if (!periods.data?.times?.length) return snapshot.data?.time
    return periods.data.times[period] ?? snapshot.data?.time
  }, [
    liveActive,
    liveSnapshot.data,
    periods.data,
    period,
    snapshot.data?.time,
  ])

  const hasResultPeriods = scrubberPeriodCount > 0
  const canShowResults =
    hasResultPeriods || Boolean(liveActive && liveSnapshot.data?.available)

  return {
    period,
    setPeriod,
    queryPeriod,
    playing,
    setPlaying,
    showAllPeaks,
    setShowAllPeaks,
    largeMesh,
    liveSnapshot,
    periods,
    snapshot,
    outEnvelope,
    twodPeriods,
    twodSnapshot,
    twodEnvelope,
    twodBinary,
    displaySnapshot,
    displayTwodSnapshot,
    displayTwodBinary,
    symbologyExtents: staticSymbologyExtents,
    timeLabel,
    hasResultPeriods,
    canShowResults,
    scrubberPeriodCount,
  }
}
