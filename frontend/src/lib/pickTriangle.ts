import type { CompactMeshWgs } from './meshGeoJson'

/** Barycentric point-in-triangle test (inclusive edges). */
export function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const v0x = cx - ax
  const v0y = cy - ay
  const v1x = bx - ax
  const v1y = by - ay
  const v2x = px - ax
  const v2y = py - ay
  const dot00 = v0x * v0x + v0y * v0y
  const dot01 = v0x * v1x + v0y * v1y
  const dot02 = v0x * v2x + v0y * v2y
  const dot11 = v1x * v1x + v1y * v1y
  const dot12 = v1x * v2x + v1y * v2y
  const denom = dot00 * dot11 - dot01 * dot01
  if (Math.abs(denom) < 1e-18) return false
  const inv = 1 / denom
  const u = (dot11 * dot02 - dot01 * dot12) * inv
  const v = (dot00 * dot12 - dot01 * dot02) * inv
  return u >= 0 && v >= 0 && u + v <= 1
}

/**
 * Find the triangle index containing (lng, lat) in a compact WGS84 mesh.
 * Brute-force with bbox reject — fine for click picking (~10⁵ faces).
 */
export function findTriangleAt(
  lng: number,
  lat: number,
  mesh: CompactMeshWgs,
): number | null {
  const { vertices, triangles } = mesh
  const n = vertices.length
  for (let ti = 0; ti < triangles.length; ti++) {
    const trip = triangles[ti]
    if (!trip || trip.length < 3) continue
    const [i, j, k] = trip
    if (i < 0 || j < 0 || k < 0 || i >= n || j >= n || k >= n) continue
    const a = vertices[i]
    const b = vertices[j]
    const c = vertices[k]
    if (!a || !b || !c || a.length < 2 || b.length < 2 || c.length < 2) continue
    const minX = Math.min(a[0], b[0], c[0])
    const maxX = Math.max(a[0], b[0], c[0])
    const minY = Math.min(a[1], b[1], c[1])
    const maxY = Math.max(a[1], b[1], c[1])
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue
    if (pointInTriangle(lng, lat, a[0], a[1], b[0], b[1], c[0], c[1])) {
      return ti
    }
  }
  return null
}

/** Closed WGS84 ring for one triangle (for selection highlight). */
export function triangleRingWgs(
  mesh: CompactMeshWgs,
  triangleIndex: number,
): number[][] | null {
  const trip = mesh.triangles[triangleIndex]
  if (!trip || trip.length < 3) return null
  const [i, j, k] = trip
  const a = mesh.vertices[i]
  const b = mesh.vertices[j]
  const c = mesh.vertices[k]
  if (!a || !b || !c || a.length < 2 || b.length < 2 || c.length < 2) return null
  return [
    [a[0], a[1]],
    [b[0], b[1]],
    [c[0], c[1]],
    [a[0], a[1]],
  ]
}
