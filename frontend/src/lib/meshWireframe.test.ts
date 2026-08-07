import { describe, expect, it } from 'vitest'
import { buildMeshEdgeLinePositions, meshEdgeKey } from './meshWireframe'

describe('meshWireframe', () => {
  it('deduplicates shared triangle edges', () => {
    const positions = buildMeshEdgeLinePositions({
      vertices: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      triangles: [
        [0, 1, 2],
        [1, 3, 2],
      ],
    })
    // Two triangles sharing edge 1–2 → 5 unique edges → 5 segments × 2 verts × 2 floats
    expect(positions.length).toBe(5 * 2 * 2)
  })

  it('meshEdgeKey is injective for lo < hi', () => {
    const n = 100
    const keys = new Set<number>()
    for (let lo = 0; lo < n; lo++) {
      for (let hi = lo + 1; hi < n; hi++) {
        const k = meshEdgeKey(lo, hi, n)
        expect(keys.has(k)).toBe(false)
        keys.add(k)
      }
    }
  })
})
