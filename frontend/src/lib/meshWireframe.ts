/**
 * Build deduplicated triangle-edge line segments for large-mesh wireframe rendering.
 * Positions are MapLibre mercator (x, y) pairs, suitable for gl.LINES.
 */

import { MercatorCoordinate } from 'maplibre-gl'

export type CompactMeshWireframeInput = {
  vertices: number[][]
  triangles: number[][]
}

/** Pack undirected edge (lo, hi) into a numeric set key. */
export function meshEdgeKey(lo: number, hi: number, vertexCount: number): number {
  return lo * vertexCount + hi
}

export function buildMeshEdgeLinePositions(mesh: CompactMeshWireframeInput): Float32Array {
  const { vertices, triangles } = mesh
  const nVerts = vertices.length
  if (nVerts === 0 || triangles.length === 0) return new Float32Array(0)

  const seen = new Set<number>()
  const out: number[] = []

  const appendEdge = (a: number, b: number) => {
    if (a === b) return
    const lo = a < b ? a : b
    const hi = a < b ? b : a
    const key = meshEdgeKey(lo, hi, nVerts)
    if (seen.has(key)) return
    seen.add(key)

    const va = vertices[lo]
    const vb = vertices[hi]
    if (!va || !vb) return
    const mca = MercatorCoordinate.fromLngLat({ lng: va[0] ?? 0, lat: va[1] ?? 0 }, 0)
    const mcb = MercatorCoordinate.fromLngLat({ lng: vb[0] ?? 0, lat: vb[1] ?? 0 }, 0)
    out.push(mca.x, mca.y, mcb.x, mcb.y)
  }

  for (const trip of triangles) {
    if (!trip || trip.length < 3) continue
    appendEdge(trip[0], trip[1])
    appendEdge(trip[1], trip[2])
    appendEdge(trip[2], trip[0])
  }

  return new Float32Array(out)
}
