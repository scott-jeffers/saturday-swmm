export function MapLegend({
  depthMax,
  flowMax,
  runoffMax,
  hasSnapshot,
  resultsSymbology,
}: {
  depthMax: number
  flowMax: number
  runoffMax: number
  hasSnapshot: boolean
  resultsSymbology: boolean
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
      <div className="mb-1 text-muted">Node depth</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{
          background: 'linear-gradient(90deg,#0ea5e9,#fbbf24,#ef4444)',
        }}
      />
      <div className="mb-3 flex justify-between text-[10px] text-muted">
        <span>0</span>
        <span>{depthMax.toFixed(2)}</span>
      </div>
      <div className="mb-1 text-muted">Link flow</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{
          background: 'linear-gradient(90deg,#1d4ed8,#38bdf8,#a855f7)',
        }}
      />
      <div className="mb-3 flex justify-between text-[10px] text-muted">
        <span>0</span>
        <span>{flowMax.toFixed(2)}</span>
      </div>
      <div className="mb-1 text-muted">Subcatchment runoff</div>
      <div
        className="mb-2 h-2 rounded-full"
        style={{
          background: 'linear-gradient(90deg,#14532d,#22c55e,#eab308,#ef4444)',
        }}
      />
      <div className="flex justify-between text-[10px] text-muted">
        <span>0</span>
        <span>{runoffMax.toFixed(2)}</span>
      </div>
    </div>
  )
}
