import type { Feature, FeatureCollection } from 'geojson'
import type { TwoDMeshResponse } from '../api/client'
import { projectToWgs84 } from './projection'

export type CoordTransform = (x: number, y: number) => [number, number]

export type CompactMeshWgs = {
  vertices: number[][]
  triangles: number[][]
}

/** Reproject compact mesh arrays to WGS84 without building GeoJSON features. */
export function meshResponseToCompactWgs(
  mesh: TwoDMeshResponse | null | undefined,
  crs: string,
): CompactMeshWgs | null {
  if (!mesh?.vertices?.length || !mesh?.triangles?.length) return null
  const verts = mesh.vertices
  const projected: number[][] = new Array(verts.length)
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]
    if (!v || v.length < 2) {
      projected[i] = [NaN, NaN]
      continue
    }
    const [lng, lat] = projectToWgs84(v[0], v[1], crs)
    projected[i] = [lng, lat]
  }
  return { vertices: projected, triangles: mesh.triangles }
}

/** Build triangle Polygon features from compact indexed mesh arrays. */
export function meshResponseToGeoJson(
  mesh: TwoDMeshResponse | null | undefined,
  /** Optional transform applied to unique vertices before triangle expansion. */
  transform?: CoordTransform,
): FeatureCollection | null {
  if (!mesh) return null

  const verts = mesh.vertices
  const tris = mesh.triangles
  if (verts?.length && tris?.length) {
    const n = verts.length
    const projected: [number, number][] = new Array(n)
    for (let i = 0; i < n; i++) {
      const v = verts[i]
      if (!v || v.length < 2) {
        projected[i] = [NaN, NaN]
        continue
      }
      projected[i] = transform ? transform(v[0], v[1]) : [v[0], v[1]]
    }

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
        !Number.isFinite(projected[i][0]) ||
        !Number.isFinite(projected[j][0]) ||
        !Number.isFinite(projected[k][0])
      ) {
        continue
      }
      const p1 = projected[i]
      const p2 = projected[j]
      const p3 = projected[k]
      features.push({
        type: 'Feature',
        // Numeric id required for MapLibre setFeatureState
        id: ti,
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

  const existing = mesh.geojson
  if (existing?.features?.length) {
    if (!transform) return existing
    // Small meshes may arrive as full GeoJSON — reproject vertex-by-vertex.
    return {
      type: 'FeatureCollection',
      features: existing.features.map((f, ti) => {
        const geom = f.geometry
        if (!geom || geom.type !== 'Polygon') return f
        const ring = geom.coordinates[0] ?? []
        const coords = ring.map((c) => {
          const [lng, lat] = transform(c[0], c[1])
          return [lng, lat]
        })
        return {
          ...f,
          id: typeof f.id === 'number' ? f.id : ti,
          geometry: { type: 'Polygon' as const, coordinates: [coords] },
          properties: {
            ...(f.properties ?? {}),
            object_type: 'triangle',
            triangle_index: Number(f.properties?.triangle_index ?? ti),
            id: String(f.properties?.id ?? ti),
          },
        }
      }),
    }
  }

  return existing ?? null
}

/** Build WGS84 mesh GeoJSON, reprojecting unique vertices once when compact arrays exist. */
export function meshResponseToWgsGeoJson(
  mesh: TwoDMeshResponse | null | undefined,
  crs: string,
): FeatureCollection | null {
  if (!mesh) return null
  return meshResponseToGeoJson(mesh, (x, y) => projectToWgs84(x, y, crs))
}
