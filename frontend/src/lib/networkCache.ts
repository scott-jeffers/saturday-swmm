import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { ModelNetwork, ModelObjectResponse } from '../api/client'

function countKey(objectType: ModelObjectResponse['object_type']): string {
  if (objectType === 'node') return 'nodes'
  if (objectType === 'link') return 'links'
  return 'subcatchments'
}

export function featureFromObject(obj: ModelObjectResponse): Feature | null {
  if (!obj.geometry) return null
  return {
    type: 'Feature',
    id: `${obj.object_type}:${obj.id}`,
    geometry: obj.geometry as Geometry,
    properties: {
      object_type: obj.object_type,
      id: obj.id,
      ...obj.attributes,
    },
  }
}

export function upsertNetworkObject(
  network: ModelNetwork,
  obj: ModelObjectResponse,
): ModelNetwork {
  const feature = featureFromObject(obj)
  if (!feature) return network

  const existingIdx = network.geojson.features.findIndex(
    (f) =>
      f.properties?.object_type === obj.object_type &&
      String(f.properties?.id) === obj.id,
  )
  const features = [...network.geojson.features]
  const isNew = existingIdx < 0
  if (isNew) features.push(feature)
  else features[existingIdx] = feature

  const key = countKey(obj.object_type)
  const counts = { ...network.counts }
  if (isNew) counts[key] = (counts[key] ?? 0) + 1

  return {
    ...network,
    geojson: { type: 'FeatureCollection', features },
    counts,
  }
}

export function removeNetworkObject(
  network: ModelNetwork,
  objectType: ModelObjectResponse['object_type'],
  id: string,
  cascadedLinkIds: string[] = [],
): ModelNetwork {
  const drop = new Set<string>([`${objectType}:${id}`])
  for (const lid of cascadedLinkIds) drop.add(`link:${lid}`)

  const features = network.geojson.features.filter((f) => {
    const t = String(f.properties?.object_type ?? '')
    const fid = String(f.properties?.id ?? '')
    return !drop.has(`${t}:${fid}`)
  })

  const counts = { ...network.counts }
  const before = network.geojson.features.length
  const removed = before - features.length
  if (removed > 0) {
    if (objectType === 'node') {
      counts.nodes = Math.max(0, (counts.nodes ?? 0) - 1)
      counts.links = Math.max(0, (counts.links ?? 0) - cascadedLinkIds.length)
    } else if (objectType === 'link') {
      counts.links = Math.max(0, (counts.links ?? 0) - 1)
    } else {
      counts.subcatchments = Math.max(0, (counts.subcatchments ?? 0) - 1)
    }
  }

  return {
    ...network,
    geojson: { type: 'FeatureCollection', features },
    counts,
  }
}

export function updateNodeCoordsInNetwork(
  network: ModelNetwork,
  id: string,
  x: number,
  y: number,
): ModelNetwork {
  const features = network.geojson.features.map((f) => {
    if (f.properties?.object_type !== 'node' || String(f.properties?.id) !== id) {
      return f
    }
    return {
      ...f,
      geometry: { type: 'Point' as const, coordinates: [x, y] },
      properties: { ...f.properties, x, y },
    }
  })
  return { ...network, geojson: { type: 'FeatureCollection', features } }
}

export function featuresByType(fc: FeatureCollection) {
  const nodes: Feature[] = []
  const links: Feature[] = []
  const subs: Feature[] = []
  for (const f of fc.features) {
    const t = f.properties?.object_type
    if (t === 'node') nodes.push(f)
    else if (t === 'link') links.push(f)
    else if (t === 'subcatchment') subs.push(f)
  }
  return { nodes, links, subs }
}
