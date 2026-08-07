import {
  linkFlowCssGradient,
  meshDepthCssGradient,
  nodeDepthCssGradient,
  runoffCssGradient,
} from '../../lib/resultsSymbology'

export function MapLegend({
  depthMax,
  flowMax,
  runoffMax,
  hasSnapshot,
  resultsSymbology,
  twodDepthMax,
  show2dDepth,
}: {
  depthMax: number
  flowMax: number
  runoffMax: number
  hasSnapshot: boolean
  resultsSymbology: boolean
  twodDepthMax?: number
  show2dDepth?: boolean
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

  return (
    <div className="absolute bottom-3 right-3 z-10 w-44 rounded-xl border border-border bg-elevated/95 p-3 text-xs shadow-[var(--shadow-panel)] backdrop-blur">
      <div className="mb-2 font-medium text-fg-soft">Results legend</div>
      {show2dDepth && twodDepthMax != null && (
        <>
          <div className="mb-1 text-muted">2D depth</div>
          <div
            className="mb-2 h-2 rounded-full"
            style={{ background: meshDepthCssGradient() }}
          />
          <div className="mb-3 flex justify-between text-[10px] text-muted">
            <span>0</span>
            <span>{twodDepthMax.toFixed(3)}</span>
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
        <span>{depthMax.toFixed(2)}</span>
      </div>
      <div className="mb-1 text-muted">Link flow</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{ background: linkFlowCssGradient() }}
      />
      <div className="mb-3 flex justify-between text-[10px] text-muted">
        <span>0</span>
        <span>{flowMax.toFixed(2)}</span>
      </div>
      <div className="mb-1 text-muted">Subcatchment runoff</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{ background: runoffCssGradient() }}
      />
      <div className="flex justify-between text-[10px] text-muted">
        <span>0</span>
        <span>{runoffMax.toFixed(2)}</span>
      </div>
    </div>
  )
}
