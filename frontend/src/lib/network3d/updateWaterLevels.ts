/**
 * Fast per-period water height updates from OUT snapshot node depths.
 */

import type { VerticalLink, VerticalNode } from './buildVerticalNetwork'

export function clampWaterHeight(height: number, maxHeight: number): number {
  if (maxHeight <= 0) return 0
  if (height <= 0) return 0
  if (height >= maxHeight) return maxHeight
  return height
}

export function waterSurfaceElevation(invert: number, depth: number): number {
  return invert + Math.max(0, depth)
}

/** Water column height inside a junction shaft (clamped to rim). */
export function junctionWaterHeight(
  invert: number,
  rim: number,
  depth: number,
): number {
  const maxH = rim - invert
  return clampWaterHeight(depth, maxH)
}

/** Approximate pipe fill fraction from water depth relative to diameter. */
export function linkFillRatio(depthAboveInvert: number, diameter: number): number {
  if (diameter <= 0) return 0
  return Math.min(1, Math.max(0, depthAboveInvert / diameter))
}

export type DepthLookup = Map<string, number>

export function depthsFromSnapshot(
  nodeIds: string[],
  nodeDepths: number[],
  unitScale = 1,
): DepthLookup {
  const m = new Map<string, number>()
  const n = Math.min(nodeIds.length, nodeDepths.length)
  for (let i = 0; i < n; i++) {
    m.set(nodeIds[i]!, (nodeDepths[i] ?? 0) * unitScale)
  }
  return m
}

export type JunctionWaterState = {
  id: string
  /** Height above invert, meters (un-exaggerated). */
  height: number
  /** Max shaft height (rim - invert). */
  maxHeight: number
  /** Water reached the rim: the node is flooding. */
  flooded: boolean
}

export type LinkWaterState = {
  id: string
  /** Mean fill fraction 0..1 from endpoint water surfaces. */
  fill: number
  /** Water above the crown at either end. */
  surcharged: boolean
}

export function computeJunctionWaterStates(
  nodes: VerticalNode[],
  depths: DepthLookup,
): JunctionWaterState[] {
  return nodes.map((n) => {
    const depth = depths.get(n.id) ?? 0
    const maxHeight = Math.max(n.rim - n.elevation, 0.01)
    return {
      id: n.id,
      height: junctionWaterHeight(n.elevation, n.rim, depth),
      maxHeight,
      flooded: n.maxDepth > 0 && depth >= maxHeight - 0.005,
    }
  })
}

export function computeLinkWaterStates(
  links: VerticalLink[],
  nodeById: Map<string, VerticalNode>,
  depths: DepthLookup,
): LinkWaterState[] {
  return links.map((L) => {
    const from = nodeById.get(L.fromNode)
    const to = nodeById.get(L.toNode)
    const dFrom = depths.get(L.fromNode) ?? 0
    const dTo = depths.get(L.toNode) ?? 0
    const wsFrom = from ? waterSurfaceElevation(from.elevation, dFrom) : L.invertUs
    const wsTo = to ? waterSurfaceElevation(to.elevation, dTo) : L.invertDs
    // Depth of water above local invert at each end (can be > diameter when surcharged).
    const depthUs = Math.max(0, wsFrom - L.invertUs)
    const depthDs = Math.max(0, wsTo - L.invertDs)
    const fill =
      (linkFillRatio(depthUs, L.diameter) + linkFillRatio(depthDs, L.diameter)) / 2
    return { id: L.id, fill, surcharged: depthUs > L.diameter + 1e-3 || depthDs > L.diameter + 1e-3 }
  })
}
