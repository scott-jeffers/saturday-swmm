/**
 * Derive full-network vertical geometry (inverts, crowns, rims) from GeoJSON
 * using the same rules as backend profile_service.build_profile.
 */

import type { Feature, FeatureCollection, LineString, Point } from 'geojson'

export type VerticalNode = {
  id: string
  nodeKind: 'junction' | 'outfall' | 'storage' | string
  lng: number
  lat: number
  elevation: number
  maxDepth: number
  /** Ground / rim elevation (elevation + max_depth, with fallback). */
  rim: number
}

export type VerticalLink = {
  id: string
  linkKind: string
  fromNode: string
  toNode: string
  /** WGS84 LineString coords including bend vertices. */
  coordinates: [number, number][]
  invertUs: number
  invertDs: number
  diameter: number
  crownUs: number
  crownDs: number
  /** Cumulative plan length fractions [0..1] at each coordinate (for Z interp). */
  lengthFractions: number[]
  planLength: number
}

export type VerticalNetwork = {
  nodes: VerticalNode[]
  links: VerticalLink[]
  nodeById: Map<string, VerticalNode>
  /** Bounding box in WGS84. */
  bounds: { west: number; south: number; east: number; north: number } | null
  elevMin: number
  elevMax: number
  conduitCount: number
}

const DEFAULT_DIAMETER = 0.3
/** When max_depth is missing/zero, invent a short shaft so columns are visible. */
const DEFAULT_SHAFT_DEPTH = 1.5

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function planDist(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.hypot(dx, dy)
}

/** Cumulative length fractions along a polyline (last = 1). */
export function polylineLengthFractions(coords: [number, number][]): {
  fractions: number[]
  total: number
} {
  if (coords.length === 0) return { fractions: [], total: 0 }
  if (coords.length === 1) return { fractions: [0], total: 0 }
  const seg: number[] = [0]
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += planDist(coords[i - 1]!, coords[i]!)
    seg.push(total)
  }
  if (total <= 0) {
    return { fractions: coords.map((_, i) => (i === 0 ? 0 : 1)), total: 0 }
  }
  return { fractions: seg.map((d) => d / total), total }
}

/**
 * Invert elevations for a conduit using SWMM from/to orientation
 * (in_offset at from_node, out_offset at to_node).
 */
export function computeLinkInverts(
  fromElev: number,
  toElev: number,
  inOffset: number,
  outOffset: number,
): { invertUs: number; invertDs: number } {
  return {
    invertUs: fromElev + inOffset,
    invertDs: toElev + outOffset,
  }
}

export function rimElevation(elevation: number, maxDepth: number): number {
  if (maxDepth > 0) return elevation + maxDepth
  return elevation + DEFAULT_SHAFT_DEPTH
}

/**
 * Build vertical network from WGS84 GeoJSON (already reprojected).
 * Only conduits get full pipe geometry; other link kinds are skipped for tubes.
 */
export function buildVerticalNetwork(fc: FeatureCollection): VerticalNetwork {
  const nodeById = new Map<string, VerticalNode>()
  const nodes: VerticalNode[] = []
  const links: VerticalLink[] = []

  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  let elevMin = Infinity
  let elevMax = -Infinity

  const expand = (lng: number, lat: number, elev: number) => {
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (elev < elevMin) elevMin = elev
    if (elev > elevMax) elevMax = elev
  }

  for (const f of fc.features) {
    if (f.geometry?.type !== 'Point' || f.properties?.object_type !== 'node') continue
    const props = f.properties ?? {}
    const id = String(props.id ?? '')
    if (!id) continue
    const pt = f.geometry as Point
    const lng = pt.coordinates[0] ?? 0
    const lat = pt.coordinates[1] ?? 0
    const elevation = num(props.elevation)
    const maxDepth = num(props.max_depth)
    const rim = rimElevation(elevation, maxDepth)
    const node: VerticalNode = {
      id,
      nodeKind: String(props.node_kind ?? 'junction'),
      lng,
      lat,
      elevation,
      maxDepth,
      rim,
    }
    nodeById.set(id, node)
    nodes.push(node)
    expand(lng, lat, elevation)
    expand(lng, lat, rim)
  }

  let conduitCount = 0
  for (const f of fc.features) {
    if (f.geometry?.type !== 'LineString' || f.properties?.object_type !== 'link') continue
    const props = f.properties ?? {}
    const id = String(props.id ?? '')
    if (!id) continue
    const linkKind = String(props.link_kind ?? 'conduit')
    if (linkKind !== 'conduit') continue

    const fromId = String(props.from_node ?? '')
    const toId = String(props.to_node ?? '')
    const from = nodeById.get(fromId)
    const to = nodeById.get(toId)
    if (!from || !to) continue

    const line = f as Feature<LineString>
    const raw = (line.geometry?.coordinates ?? []) as number[][]
    const coordinates: [number, number][] = raw
      .filter((c) => c && c.length >= 2)
      .map((c) => [c[0]!, c[1]!])
    if (coordinates.length < 2) {
      coordinates.length = 0
      coordinates.push([from.lng, from.lat], [to.lng, to.lat])
    }

    const inOffset = num(props.in_offset)
    const outOffset = num(props.out_offset)
    const { invertUs, invertDs } = computeLinkInverts(
      from.elevation,
      to.elevation,
      inOffset,
      outOffset,
    )
    let diameter = num(props.diameter, 0)
    if (diameter <= 0) diameter = num(props.geom1, 0)
    if (diameter <= 0) diameter = DEFAULT_DIAMETER

    const { fractions, total } = polylineLengthFractions(coordinates)
    const crownUs = invertUs + diameter
    const crownDs = invertDs + diameter

    links.push({
      id,
      linkKind,
      fromNode: fromId,
      toNode: toId,
      coordinates,
      invertUs,
      invertDs,
      diameter,
      crownUs,
      crownDs,
      lengthFractions: fractions,
      planLength: total,
    })
    conduitCount++
    for (const [lng, lat] of coordinates) expand(lng, lat, invertUs)
    expand(coordinates[coordinates.length - 1]![0], coordinates[coordinates.length - 1]![1], invertDs)
    elevMin = Math.min(elevMin, invertUs, invertDs)
    elevMax = Math.max(elevMax, crownUs, crownDs)
  }

  const bounds =
    Number.isFinite(west) && Number.isFinite(east)
      ? { west, south, east, north }
      : null

  return {
    nodes,
    links,
    nodeById,
    bounds,
    elevMin: Number.isFinite(elevMin) ? elevMin : 0,
    elevMax: Number.isFinite(elevMax) ? elevMax : 1,
    conduitCount,
  }
}

/** Interpolate invert elevation along a link by plan-length fraction t ∈ [0,1]. */
export function invertAtFraction(link: VerticalLink, t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return link.invertUs + (link.invertDs - link.invertUs) * u
}

/**
 * Suggest vertical exaggeration so shaft heights read clearly on plan-scale maps.
 */
export function suggestVerticalExaggeration(net: VerticalNetwork): number {
  if (!net.bounds) return 15
  const dLng = net.bounds.east - net.bounds.west
  const dLat = net.bounds.north - net.bounds.south
  // Rough meters at mid-lat (1° lat ≈ 111km; lng scaled by cos).
  const midLat = (net.bounds.north + net.bounds.south) / 2
  const mPerDegLat = 111_320
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180)
  const planM = Math.hypot(dLng * mPerDegLng, dLat * mPerDegLat)
  const elevRange = Math.max(net.elevMax - net.elevMin, 1)
  // Stronger exaggeration so manhole columns read clearly at city overview.
  const raw = planM / (6 * elevRange)
  return Math.min(40, Math.max(8, raw))
}
