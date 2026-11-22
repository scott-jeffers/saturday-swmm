/**
 * The legend for comparing two runs on the map. Picking what to compare with
 * is in the header ("vs …", layout/ContextBar.tsx); what the map shows while
 * comparing is on the map's Results row.
 */

/** Legend for the map's "Change" view. */
export function ChangeLegend({
  currentLabel,
  otherLabel,
  depthMax,
  flowMax,
  units,
  peaks = false,
}: {
  peaks?: boolean
  currentLabel: string
  otherLabel: string
  depthMax: number
  flowMax: number
  units: { len: string; flow: string }
}) {
  const bar = 'linear-gradient(90deg, #1d4ed8, #7fb0f5 35%, #c3c8d0 50%, #f4a07f 65%, #c2261a)'
  const f = (v: number) => (v >= 10 ? v.toFixed(1) : v.toPrecision(2))
  const row = (title: string, max: number) => (
    <div>
      <p className="m-0 mb-1 text-fg-soft">{title}</p>
      <div className="h-2 rounded-full" style={{ background: bar }} />
      <div className="mt-0.5 flex justify-between tabular-nums text-[10.5px] text-muted">
        <span>−{f(max)}</span>
        <span>0</span>
        <span>+{f(max)}</span>
      </div>
    </div>
  )
  return (
    <div className="map-overlay absolute bottom-3 right-3 z-10 w-60 space-y-2.5 p-3 text-xs">
      <p className="m-0 font-medium text-fg">
        {peaks ? 'Change in peaks' : 'Change'}: {currentLabel} − {otherLabel}
      </p>
      {row(`Node depth (${units.len})`, depthMax)}
      {row(`Link flow (${units.flow})`, flowMax)}
      <p className="m-0 flex justify-between text-[11px] text-muted">
        <span>lower</span>
        <span>same</span>
        <span>higher</span>
      </p>
    </div>
  )
}
