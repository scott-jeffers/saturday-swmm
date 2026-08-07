import { useEffect, useState } from 'react'
import {
  linkFlowCssGradient,
  meshDepthCssGradient,
  nodeDepthCssGradient,
  runoffCssGradient,
} from '../../lib/resultsSymbology'

type LegendKey = 'depthMax' | 'flowMax' | 'runoffMax' | 'twodDepthMax'

function LegendMaxControl({
  value,
  autoValue,
  digits,
  overridden,
  onCommit,
  onReset,
}: {
  value: number
  autoValue: number
  digits: number
  overridden: boolean
  onCommit: (v: number) => void
  onReset: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value.toFixed(digits))

  useEffect(() => {
    if (!editing) setDraft(value.toFixed(digits))
  }, [value, digits, editing])

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          step="any"
          min={0}
          autoFocus
          className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-[10px] text-fg"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft)
            setEditing(false)
            if (Number.isFinite(n) && n > 0) onCommit(n)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = Number(draft)
              setEditing(false)
              if (Number.isFinite(n) && n > 0) onCommit(n)
            } else if (e.key === 'Escape') {
              setEditing(false)
              setDraft(value.toFixed(digits))
            }
          }}
        />
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        title="Click to set scale max"
        className={`rounded px-0.5 hover:bg-border/40 hover:text-fg ${
          overridden ? 'font-medium text-[var(--color-accent)]' : ''
        }`}
        onClick={() => setEditing(true)}
      >
        {value.toFixed(digits)}
      </button>
      {overridden && (
        <button
          type="button"
          title={`Reset to auto (${autoValue.toFixed(digits)})`}
          className="text-[9px] text-muted underline hover:text-fg"
          onClick={onReset}
        >
          auto
        </button>
      )}
    </span>
  )
}

export function MapLegend({
  depthMax,
  flowMax,
  runoffMax,
  hasSnapshot,
  resultsSymbology,
  twodDepthMax,
  show2dDepth,
  autoDepthMax,
  autoFlowMax,
  autoRunoffMax,
  autoTwodDepthMax,
  overrides = {},
  onOverrideChange,
}: {
  depthMax: number
  flowMax: number
  runoffMax: number
  hasSnapshot: boolean
  resultsSymbology: boolean
  twodDepthMax?: number
  show2dDepth?: boolean
  autoDepthMax?: number
  autoFlowMax?: number
  autoRunoffMax?: number
  autoTwodDepthMax?: number
  overrides?: Partial<Record<LegendKey, number>>
  onOverrideChange?: (key: LegendKey, value: number | null) => void
}) {
  if (!resultsSymbology) {
    return (
      <div className="absolute bottom-3 right-3 z-10 w-44 rounded-xl border border-border bg-elevated/95 p-3 text-xs shadow-[var(--shadow-panel)] backdrop-blur">
        <div className="mb-2 font-medium text-fg-soft">Element types</div>
        <div className="space-y-1.5 text-muted">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-[#1d4ed8]" />
            Conduit
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-[#db2777]" />
            Pump
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-[#7c3aed]" />
            Orifice
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-[#ca8a04]" />
            Weir
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full bg-[#ea580c]" />
            Outlet
          </div>
        </div>
        {hasSnapshot && (
          <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted">
            Switch to Results colors to show depth / flow.
          </p>
        )}
      </div>
    )
  }

  if (!hasSnapshot) {
    return (
      <div className="absolute bottom-3 right-3 z-10 rounded-xl border border-border bg-elevated/90 px-3 py-2 text-xs text-muted shadow">
        No results yet — run a simulation
      </div>
    )
  }

  const setMax = (key: LegendKey, value: number | null) => {
    onOverrideChange?.(key, value)
  }

  return (
    <div className="absolute bottom-3 right-3 z-10 w-48 rounded-xl border border-border bg-elevated/95 p-3 text-xs shadow-[var(--shadow-panel)] backdrop-blur">
      <div className="mb-2 font-medium text-fg-soft">Results legend</div>
      <p className="mb-2 text-[9px] text-muted">Click a max to set the color scale</p>
      {show2dDepth && twodDepthMax != null && (
        <>
          <div className="mb-1 text-muted">2D depth</div>
          <div
            className="mb-2 h-2 rounded-full"
            style={{ background: meshDepthCssGradient() }}
          />
          <div className="mb-3 flex justify-between text-[10px] text-muted">
            <span>0</span>
            <LegendMaxControl
              value={twodDepthMax}
              autoValue={autoTwodDepthMax ?? twodDepthMax}
              digits={3}
              overridden={overrides.twodDepthMax != null}
              onCommit={(v) => setMax('twodDepthMax', v)}
              onReset={() => setMax('twodDepthMax', null)}
            />
          </div>
        </>
      )}
      <div className="mb-1 text-muted">Node depth</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{ background: nodeDepthCssGradient() }}
      />
      <div className="mb-3 flex justify-between text-[10px] text-muted">
        <span>0</span>
        <LegendMaxControl
          value={depthMax}
          autoValue={autoDepthMax ?? depthMax}
          digits={2}
          overridden={overrides.depthMax != null}
          onCommit={(v) => setMax('depthMax', v)}
          onReset={() => setMax('depthMax', null)}
        />
      </div>
      <div className="mb-1 text-muted">Link flow</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{ background: linkFlowCssGradient() }}
      />
      <div className="mb-3 flex justify-between text-[10px] text-muted">
        <span>0</span>
        <LegendMaxControl
          value={flowMax}
          autoValue={autoFlowMax ?? flowMax}
          digits={2}
          overridden={overrides.flowMax != null}
          onCommit={(v) => setMax('flowMax', v)}
          onReset={() => setMax('flowMax', null)}
        />
      </div>
      <div className="mb-1 text-muted">Subcatchment runoff</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{ background: runoffCssGradient() }}
      />
      <div className="flex justify-between text-[10px] text-muted">
        <span>0</span>
        <LegendMaxControl
          value={runoffMax}
          autoValue={autoRunoffMax ?? runoffMax}
          digits={2}
          overridden={overrides.runoffMax != null}
          onCommit={(v) => setMax('runoffMax', v)}
          onReset={() => setMax('runoffMax', null)}
        />
      </div>
    </div>
  )
}
