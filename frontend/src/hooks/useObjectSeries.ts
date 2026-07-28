import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type OutVariableInfo, type TimeSeriesResponse } from '../api/client'
import { useRunStatus } from './useRunStatus'

export type SeriesKind = 'node' | 'link' | 'subcatchment'

const DEFAULT_VAR: Record<SeriesKind, string> = {
  node: 'depth',
  link: 'flow',
  subcatchment: 'runoff',
}

export function useObjectSeries(kind: SeriesKind | null | undefined, id: string | null | undefined) {
  const { data: runStatus } = useRunStatus()
  const [variable, setVariable] = useState<string>(
    kind ? DEFAULT_VAR[kind] : 'depth',
  )

  useEffect(() => {
    if (kind) setVariable(DEFAULT_VAR[kind])
  }, [kind])

  const variablesQuery = useQuery({
    queryKey: ['out-variables', kind, runStatus?.status],
    queryFn: () => api.getOutVariables(kind!),
    enabled: Boolean(kind),
    retry: false,
    staleTime: 60_000,
  })

  const variables: OutVariableInfo[] = variablesQuery.data?.variables ?? []

  useEffect(() => {
    if (variables.length === 0) return
    if (!variables.some((v) => v.id === variable)) {
      setVariable(variables[0].id)
    }
  }, [variables, variable])

  const seriesQuery = useQuery({
    queryKey: ['object-series', kind, id, variable, runStatus?.status],
    queryFn: (): Promise<TimeSeriesResponse> => {
      if (kind === 'node') return api.getNodeSeries(id!, variable)
      if (kind === 'link') return api.getLinkSeries(id!, variable)
      return api.getSubcatchmentSeries(id!, variable)
    },
    enabled: Boolean(kind && id && variable),
    retry: false,
  })

  const active = variables.find((v) => v.id === variable)
  const yLabel = active
    ? active.unit
      ? `${active.label} (${active.unit})`
      : active.label
    : seriesQuery.data?.variable_label || variable

  return {
    variables,
    variable,
    setVariable,
    series: seriesQuery,
    yLabel,
    unit: active?.unit ?? seriesQuery.data?.unit ?? '',
    variableLabel: active?.label ?? seriesQuery.data?.variable_label ?? variable,
  }
}
