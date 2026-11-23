/** The active scenario's own changes from its parent (desktop; Base and the browser viewer have none). */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, type InheritedChange, type InheritFlag } from '../api/client'
import { IS_VIEWER } from '../lib/mode'

export type InheritanceIndex = {
  parentName: string | null
  /** "link:C12" → its changes. */
  byObject: Map<string, InheritedChange[]>
  /** "link:C12:roughness" → the change. */
  byField: Map<string, InheritedChange>
  flagsByField: Map<string, InheritFlag>
  /** Objects removed here, as "link:C12". */
  removed: Set<string>
  added: Set<string>
  changes: InheritedChange[]
  flags: InheritFlag[]
  locked: boolean
  sid: string
}

const SECTION_OBJECT: Record<string, 'node' | 'link' | 'subcatchment'> = {
  JUNCTIONS: 'node', OUTFALLS: 'node', STORAGE: 'node', DIVIDERS: 'node', COORDINATES: 'node',
  CONDUITS: 'link', PUMPS: 'link', ORIFICES: 'link', WEIRS: 'link', OUTLETS: 'link', XSECTIONS: 'link',
  SUBCATCHMENTS: 'subcatchment', SUBAREAS: 'subcatchment',
}

export function useInheritance(scenarioId: string | null | undefined): InheritanceIndex | null {
  const enabled = !IS_VIEWER && Boolean(scenarioId) && scenarioId !== 'base'
  const q = useQuery({
    queryKey: ['inheritance', scenarioId],
    queryFn: () => api.scenarioInheritance(scenarioId ?? 'active'),
    enabled,
    retry: false,
  })
  return useMemo(() => {
    if (!enabled || !q.data || !q.data.parent) return null
    const byObject = new Map<string, InheritedChange[]>()
    const byField = new Map<string, InheritedChange>()
    const removed = new Set<string>()
    const added = new Set<string>()
    for (const c of q.data.changes) {
      const obj = c.object ?? SECTION_OBJECT[c.section.toUpperCase()]
      if (!obj) continue
      const k = `${obj}:${c.id}`
      byObject.set(k, [...(byObject.get(k) ?? []), c])
      if (c.key) byField.set(`${k}:${c.key}`, c)
      if (c.change === 'removed' && !['COORDINATES', 'XSECTIONS', 'SUBAREAS'].includes(c.section.toUpperCase())) removed.add(k)
      if (c.change === 'added' && !['COORDINATES', 'XSECTIONS', 'SUBAREAS'].includes(c.section.toUpperCase())) added.add(k)
    }
    const flagsByField = new Map<string, InheritFlag>()
    for (const f of q.data.flags) {
      const obj = SECTION_OBJECT[f.section.toUpperCase()]
      if (obj) flagsByField.set(`${obj}:${f.id}:${f.key ?? '*'}`, f)
    }
    return {
      parentName: q.data.parent_name,
      byObject,
      byField,
      flagsByField,
      removed,
      added,
      changes: q.data.changes,
      flags: q.data.flags,
      locked: q.data.locked,
      sid: q.data.id,
    }
  }, [enabled, q.data])
}
