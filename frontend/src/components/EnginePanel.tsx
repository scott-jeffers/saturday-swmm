/**
 * Settings panel: choose which engine runs when you press Run.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ENGINE_LABELS, type SimulationEngine } from '../api/client'
import { EngineSelector } from './EngineSelector'
import { Panel, useToast } from './ui'

export function EnginePanel({ projectPath }: { projectPath: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const project = useQuery({ queryKey: ['project', projectPath], queryFn: api.currentProject })
  const engine: SimulationEngine = project.data?.simulation_engine ?? 'openswmm'

  const setEngine = useMutation({
    mutationFn: (eng: SimulationEngine) => api.setSimulationEngine(eng),
    onSuccess: (_d, eng) => {
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      toast({ title: `Runs now use ${ENGINE_LABELS[eng]}`, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Could not change engine', description: e.message, tone: 'danger' }),
  })

  return (
    <Panel title="Simulation engine">
      <p className="mb-3 text-xs text-muted">
        Pick the engine that runs when you press Run. OpenSWMM 6 handles 1D networks plus
        built-in 2D overland flow. EPA SWMM 5 is the reference 1D engine — use it to cross-check
        results or for models built for SWMM 5. Flow accumulation skips SWMM and maps
        floodplains from the project DEM.
      </p>
      <EngineSelector
        value={engine}
        disabled={setEngine.isPending}
        onChange={(e) => e !== engine && setEngine.mutate(e)}
      />
      {engine === 'pyswmm' && (
        <p className="mt-3 text-[11px] text-muted">
          Runs the model with EPA SWMM 5.2. OpenSWMM-only content ([2D_*] sections, [END]) is
          left out of a temporary copy; your .inp is not changed. Results open in the same map,
          profile and time-series views.
        </p>
      )}
      {engine === 'flow_accum' && (
        <p className="mt-3 text-[11px] text-muted">
          Run fills the DEM, traces streams from flow accumulation, and floods valley floors with
          Height Above Nearest Drainage (HAND). Results are floodplain polygons. No SWMM run. A
          DEM layer is required.
        </p>
      )}
    </Panel>
  )
}
