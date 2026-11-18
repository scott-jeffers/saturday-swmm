/**
 * Engine picker: one card per engine the backend reports, with availability
 * and version, so users see at a glance what each option runs.
 */

import { useQuery } from '@tanstack/react-query'
import { Box, Cpu, FlaskConical, Waves } from 'lucide-react'
import type { ComponentType } from 'react'
import { api, type EngineInfo, type SimulationEngine } from '../api/client'

const ICONS: Record<SimulationEngine, ComponentType<{ className?: string }>> = {
  openswmm: Cpu,
  pyswmm: FlaskConical,
  hybrid: Box,
  flow_accum: Waves,
}

export function EngineSelector({
  value,
  onChange,
  disabled,
}: {
  value: SimulationEngine
  onChange: (engine: SimulationEngine) => void
  disabled?: boolean
}) {
  const info = useQuery({ queryKey: ['app-info'], queryFn: api.appInfo, staleTime: 60_000 })
  const engines: EngineInfo[] = info.data?.engines ?? []

  if (info.isLoading) return <p className="text-xs text-muted">Checking available engines…</p>

  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Simulation engine">
      {engines.map((e) => {
        const Icon = ICONS[e.id] ?? Cpu
        const selected = e.id === value
        return (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || (!e.available && !selected)}
            onClick={() => onChange(e.id)}
            title={e.available ? e.description : e.error ?? 'Not available'}
            className={[
              'flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors',
              selected
                ? 'border-accent bg-accent/10'
                : 'border-border hover:border-border-strong hover:bg-white/5',
              !e.available ? 'opacity-50' : '',
              'disabled:cursor-not-allowed',
            ].join(' ')}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-accent-soft' : 'text-muted'}`} />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                {e.label}
                {e.version && (
                  <span className="text-[10px] font-normal text-muted">v{e.version}</span>
                )}
              </span>
              <span className="block text-[11px] text-muted">
                {e.available ? e.description : e.error ?? 'Not installed'}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
