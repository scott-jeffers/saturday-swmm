import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type OutVariableInfo, type TimeSeriesResponse } from '../api/client'
import { useRunStatus } from './useRunStatus'

const DEFAULT_VAR = 'depth'

export function useTriangleSeries(faceIndex: number | null | undefined) {
  const { data: runStatus } = useRunStatus()
  const [variable, setVariable] = useState(DEFAULT_VAR)

  useEffect(() => {
    setVariable(DEFAULT_VAR)
  }, [faceIndex])

  const variablesQuery = useQuery({
    queryKey: ['2d-variables', runStatus?.status],
    queryFn: async (): Promise<OutVariableInfo[]> => {
      const meta = await api.getTwoDMetadata()
      return meta.variables ?? []
    },
    enabled: faceIndex != null && faceIndex >= 0,
    retry: false,
    staleTime: 60_000,
  })

  const variables: OutVariableInfo[] = variablesQuery.data ?? []

  useEffect(() => {
    if (variables.length === 0) return
    if (!variables.some((v) => v.id === variable)) {
      setVariable(variables[0]?.id ?? DEFAULT_VAR)
    }
  }, [variables, variable])

  const seriesQuery = useQuery({
    queryKey: ['triangle-series', faceIndex, variable, runStatus?.status],
    queryFn: (): Promise<TimeSeriesResponse> =>
      api.getTwoDFaceSeries(faceIndex!, variable),
    enabled: faceIndex != null && faceIndex >= 0 && Boolean(variable),
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
