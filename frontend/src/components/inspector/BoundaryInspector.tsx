import type { Feature } from 'geojson'
import { Button, Panel } from '../ui'
import { BC_TYPE_COLORS, BC_TYPE_LABELS } from '../../lib/boundaryColors'

export function BoundaryInspector({
  feature,
  bcTypes,
  bcDraftType,
  bcDraftParam1,
  onTypeChange,
  onParam1Change,
  onSave,
  onClear,
  saving,
}: {
  feature: Feature
  bcTypes?: string[]
  bcDraftType: string
  bcDraftParam1: string
  onTypeChange: (v: string) => void
  onParam1Change: (v: string) => void
  onSave: () => void
  onClear: () => void
  saving?: boolean
}) {
  const props = feature.properties ?? {}
  const edgeId = String(props.id ?? '')
  const needsParam =
    bcDraftType === 'NORMAL_FLOW' ||
    bcDraftType === 'SPECIFIED_STAGE' ||
    bcDraftType === 'SPECIFIED_FLOW'

  return (
    <Panel title={`Boundary · Edge ${edgeId}`}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted">
          Triangle {String(props.triangle_index ?? '—')} · side {String(props.edge ?? '—')}
        </p>
        <label className="block text-xs text-muted">
          Type
          <select
            className="mt-1 w-full rounded border border-border bg-elevated px-2 py-1.5 text-sm text-fg"
            value={bcDraftType}
            onChange={(e) => onTypeChange(e.target.value)}
          >
            {(bcTypes ?? Object.keys(BC_TYPE_COLORS)).map((t) => (
              <option key={t} value={t}>
                {BC_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        {needsParam && (
          <label className="block text-xs text-muted">
            Param 1
            <input
              type="number"
              step="any"
              className="mt-1 w-full rounded border border-border bg-elevated px-2 py-1.5 text-sm text-fg"
              value={bcDraftParam1}
              onChange={(e) => onParam1Change(e.target.value)}
              placeholder={
                bcDraftType === 'NORMAL_FLOW'
                  ? 'slope'
                  : bcDraftType === 'SPECIFIED_STAGE'
                    ? 'stage'
                    : 'flow'
              }
            />
          </label>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            className="flex-1"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="outline" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </Panel>
  )
}
