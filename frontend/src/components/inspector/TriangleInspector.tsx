import { Button, Panel } from '../ui'

export function TriangleInspector({
  triangleIndex,
  manningsN,
  zMin,
  zMax,
  zMean,
  area,
  coupledNode,
  cd,
  couplingArea,
  currentDepth,
  depthUnit,
  loading,
  onClear,
}: {
  triangleIndex: number
  manningsN?: number | null
  zMin?: number | null
  zMax?: number | null
  zMean?: number | null
  area?: number | null
  coupledNode?: string | null
  cd?: number | null
  couplingArea?: number | null
  currentDepth?: number | null
  depthUnit?: string
  loading?: boolean
  onClear: () => void
}) {
  const fmt = (v: number | null | undefined, digits = 3) =>
    v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)

  return (
    <Panel title={`2D cell · ${triangleIndex}`}>
      <div className="space-y-3 text-sm">
        {loading ? (
          <p className="text-xs text-muted">Loading cell properties…</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted">Triangle</dt>
            <dd className="font-mono text-fg">{triangleIndex}</dd>
            <dt className="text-muted">Depth</dt>
            <dd className="font-mono text-fg">
              {fmt(currentDepth, 4)}
              {depthUnit ? ` ${depthUnit}` : ''}
            </dd>
            <dt className="text-muted">Manning&apos;s n</dt>
            <dd className="font-mono text-fg">{fmt(manningsN, 4)}</dd>
            <dt className="text-muted">Z min / max</dt>
            <dd className="font-mono text-fg">
              {fmt(zMin)} / {fmt(zMax)} m
            </dd>
            <dt className="text-muted">Z mean</dt>
            <dd className="font-mono text-fg">{fmt(zMean)} m</dd>
            <dt className="text-muted">Area</dt>
            <dd className="font-mono text-fg">
              {area != null && Number.isFinite(area) ? `${area.toFixed(2)} m²` : '—'}
            </dd>
            <dt className="text-muted">Coupled node</dt>
            <dd className="font-mono text-fg">{coupledNode || '—'}</dd>
            {coupledNode ? (
              <>
                <dt className="text-muted">Cd / area</dt>
                <dd className="font-mono text-fg">
                  {fmt(cd, 2)} / {fmt(couplingArea, 2)}
                </dd>
              </>
            ) : null}
          </dl>
        )}
        <Button size="sm" variant="outline" className="w-full" onClick={onClear}>
          Clear
        </Button>
      </div>
    </Panel>
  )
}
