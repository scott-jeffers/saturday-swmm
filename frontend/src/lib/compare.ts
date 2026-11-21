/**
 * Compare the current results with another scenario's (app) or another result
 * set (viewer). One choice, shared by the map, Graphs and Profile: pick it
 * once and every view shows both.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, type CompareTarget, type OutSnapshotResponse } from '../api/client'
import { IS_VIEWER } from './mode'
import { setPref, usePref } from './prefs'

/** What the map shows while comparing. */
export type CompareMapMode = 'current' | 'other' | 'change'

const MAP_MODE = 'compare-map'
/** Remembered per project: scenario ids repeat between projects. */
const targetKey = (projectPath: string | null | undefined) => `compare-target:${projectPath ?? ''}`

export function setCompareTarget(id: string | null, projectPath: string | null | undefined) {
  setPref(targetKey(projectPath), id ?? '')
}

export function useCompare(runStamp = '') {
  const qc = useQueryClient()
  const project = useQuery({ queryKey: ['project'], queryFn: api.currentProject })
  const hasProject = Boolean(project.data)
  const targetsQ = useQuery({
    queryKey: ['compare-targets', project.data?.inp_path, project.data?.has_out, runStamp],
    queryFn: api.getCompareTargets,
    enabled: hasProject,
    retry: false,
  })
  const path = project.data?.path
  const picked = usePref(targetKey(path), '')
  const mapPref = usePref(MAP_MODE, 'current') as CompareMapMode
  const targets = targetsQ.data?.targets ?? []
  const target: CompareTarget | null = targets.find((t) => t.id === picked && t.has_results) ?? null
  const current = targetsQ.data?.current ?? null
  const active = Boolean(target && project.data?.has_out)

  return {
    targets,
    current,
    target: active ? target : null,
    /** The map's view: current results, the other one's, or the change between them. */
    mapMode: active ? mapPref : ('current' as CompareMapMode),
    setTarget: (id: string | null) => setCompareTarget(id, path),
    setMapMode: (m: CompareMapMode) => setPref(MAP_MODE, m),
    /** Make the compared one current and compare with the one that was. */
    swap: async () => {
      if (!target || !current) return
      if (IS_VIEWER) {
        const { makeCurrent } = await import('../viewer/store')
        await makeCurrent(target.id)
      } else if (target.kind === 'scenario' && target.scenario_id) {
        await api.setActiveScenario(target.scenario_id)
      } else return
      setCompareTarget(current.id, path)
      await qc.invalidateQueries()
    },
  }
}

/** The compared run's results at the same time step, or its peaks. */
export function useCompareSnapshot(targetId: string | null, period: number | null, peaks: boolean) {
  return useQuery({
    queryKey: ['compare-snapshot', targetId, peaks ? 'peaks' : period],
    queryFn: () => (peaks ? api.runEnvelope(targetId!) : api.runSnapshot(targetId!, period ?? 0)),
    enabled: Boolean(targetId) && (peaks || period != null),
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })
}

/**
 * Current minus compared, element by element: positive where the current
 * run is higher. Flows compare in size (direction aside).
 */
export function changeSnapshot(cur: OutSnapshotResponse | null | undefined, other: OutSnapshotResponse | null | undefined): OutSnapshotResponse | null {
  if (!cur || !other) return null
  const diff = (ids: string[], a: number[], oIds: string[], o: number[], abs = false) => {
    const m = new Map(oIds.map((id, i) => [id, o[i]]))
    return ids.map((id, i) => {
      const b = m.get(id)
      if (b == null || a[i] == null) return 0
      return abs ? Math.abs(a[i]) - Math.abs(b) : a[i] - b
    })
  }
  const nd = diff(cur.node_ids, cur.node_depths, other.node_ids, other.node_depths)
  const lf = diff(cur.link_ids, cur.link_flows, other.link_ids, other.link_flows, true)
  const sr = cur.subcatchment_ids && other.subcatchment_ids && cur.subcatchment_runoffs && other.subcatchment_runoffs
    ? diff(cur.subcatchment_ids, cur.subcatchment_runoffs, other.subcatchment_ids, other.subcatchment_runoffs)
    : undefined
  const ext = (v: number[]) => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
  return {
    ...cur,
    node_depths: nd,
    link_flows: lf,
    subcatchment_runoffs: sr,
    node_depth_min: -ext(nd),
    node_depth_max: ext(nd),
    link_flow_min: -ext(lf),
    link_flow_max: ext(lf),
    subcatchment_runoff_min: sr ? -ext(sr) : 0,
    subcatchment_runoff_max: sr ? ext(sr) : 0,
  }
}

export function useCompareLabels(current: { label: string } | null, target: CompareTarget | null) {
  return useMemo(() => ({ a: current?.label ?? 'Current', b: target?.label ?? '' }), [current, target])
}
