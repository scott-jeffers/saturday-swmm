import { ClimatologyPanel } from './ClimatologyPanel'
import { PageHeader } from './ui'
import { ManualLink } from './ManualLink'
import { MANUAL } from '../lib/manual'
import { SimOptionsPanel } from './SimOptionsPanel'

/** The viewer's Simulation options: every [OPTIONS] value, editable in the browser. */
export function ViewerSimOptions() {
  return (
    <div className="h-full overflow-auto px-6 py-5">
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Simulation options"
          description="How this model runs: units, routing, dates, time steps and climate. Changes are saved to the model in this browser."
          actions={<ManualLink href={MANUAL.running}>Simulation options in the manual</ManualLink>}
        />
        <SimOptionsPanel />
        <ClimatologyPanel className="mt-4" />
      </div>
    </div>
  )
}
