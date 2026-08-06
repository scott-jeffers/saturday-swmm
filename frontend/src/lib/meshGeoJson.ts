import type { Feature, FeatureCollection } from 'geojson'
import type { TwoDMeshResponse } from '../api/client'

/** Build triangle Polygon features from compact indexed mesh arrays. */
export function meshResponseToGeoJson(
  mesh: TwoDMeshResponse | null | undefined,
): FeatureCollection | null {
  if (!mesh) return null
  const existing = mesh.geojson
  if (existing?.features?.length) return existing

  const verts = mesh.vertices
  const tris = mesh.triangles
  if (!verts?.length || !tris?.length) {
    return existing ?? null
  }

  const n = verts.length
  const features: Feature[] = []
  for (let ti = 0; ti < tris.length; ti++) {
    const trip = tris[ti]
    if (!trip || trip.length < 3) continue
    const [i, j, k] = trip
    if (
      i < 0 ||
      j < 0 ||
      k < 0 ||
      i >= n ||
      j >= n ||
      k >= n ||
      !verts[i] ||
      !verts[j] ||
      !verts[k]
    ) {
      continue
    }
    const p1 = verts[i]
    const p2 = verts[j]
    const p3 = verts[k]
    features.push({
      type: 'Feature',
      id: `triangle:${ti}`,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [p1[0], p1[1]],
            [p2[0], p2[1]],
            [p3[0], p3[1]],
            [p1[0], p1[1]],
          ],
        ],
      },
      properties: {
        object_type: 'triangle',
        triangle_index: ti,
        id: String(ti),
      },
    })
  }

  return { type: 'FeatureCollection', features }
}
