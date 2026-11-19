/**
 * Settings panel: choose which engine runs when you press Run.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api, ENGINE_LABELS, type SimulationEngine, type SimulationEngineChoice } from '../api/client'
import { EngineSelector } from './EngineSelector'
import { Panel, useToast } from './ui'

export function EnginePanel({ projectPath }: { projectPath: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const project = useQuery({ queryKey: ['project', projectPath], queryFn: api.currentProject })
  const engine: SimulationEngine = project.data?.simulation_engine ?? 'pyswmm'
  const choice: SimulationEngineChoice = project.data?.simulation_engine_choice ?? 'auto'

  const setEngine = useMutation({
    mutationFn: (eng: SimulationEngineChoice) => api.setSimulationEngine(eng),
    onSuccess: (_d, eng) => {
      void queryClient.invalidateQueries({ queryKey: ['project'] })
      toast({ title: eng === 'auto' ? 'Engine picked automatically per model' : `Runs now use ${ENGINE_LABELS[eng]}`, tone: 'success' })
    },
    onError: (e: Error) => toast({ title: 'Could not change engine', description: e.message, tone: 'danger' }),
  })

  return (
    <Panel title="Simulation engine">
      <p className="mb-3 text-xs text-muted">
        Automatic runs EPA SWMM 5.2, the reference engine regulators know, for 1D models, and
        OpenSWMM 6 only when the model has a 2D mesh. OpenSWMM 6 is still a pre-release, so pick it
        by hand only to test it. Flow accumulation skips SWMM and maps floodplains from the DEM.
      </p>
      <button
        type="button"
        role="radio"
        aria-checked={choice === 'auto'}
        disabled={setEngine.isPending}
        onClick={() => choice !== 'auto' && setEngine.mutate('auto')}
        className={[
          'mb-2 flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
          choice === 'auto' ? 'border-accent bg-accent/10' : 'border-border hover:border-border-strong hover:bg-fg/5',
        ].join(' ')}
      >
        <Sparkles className={`mt-0.5 h-4 w-4 shrink-0 ${choice === 'auto' ? 'text-accent-soft' : 'text-muted'}`} />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">Automatic (recommended)</span>
          <span className="block text-[11px] text-muted">
            {choice === 'auto'
              ? `This model runs with ${ENGINE_LABELS[engine]}${project.data?.simulation_engine_reason ? ` because ${project.data.simulation_engine_reason}` : ''}.`
              : 'EPA SWMM 5.2 for 1D models, OpenSWMM 6 when there is a 2D mesh'}
          </span>
        </span>
      </button>
      <EngineSelector
        value={choice}
        disabled={setEngine.isPending}
        onChange={(e) => e !== choice && setEngine.mutate(e)}
      />
      {engine === 'pyswmm' && choice !== 'auto' && (
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
