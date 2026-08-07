import type maplibregl from 'maplibre-gl'

/** Shared result color ramps — keep MapLegend and NetworkMap in sync. */

export const MESH_DEPTH_COLORS = {
  zero: 'rgba(14,165,233,0)',
  low: '#0ea5e9',
  mid: '#22c55e',
  high: '#eab308',
  max: '#ef4444',
} as const

export const NODE_DEPTH_COLORS = {
  zero: '#38bdf8',
  q25: '#22c55e',
  q60: '#eab308',
  max: '#ef4444',
} as const

export const LINK_FLOW_COLORS = {
  /** Bright sky so zero/low flow stays visible on OSM and satellite */
  zero: '#7dd3fc',
  low: '#2563eb',
  q25: '#06b6d4',
  q50: '#22c55e',
  q75: '#eab308',
  max: '#dc2626',
} as const

export const RUNOFF_COLORS = {
  zero: '#14532d',
  q25: '#22c55e',
  q60: '#eab308',
  max: '#ef4444',
} as const

export function meshDepthCssGradient(): string {
  return `linear-gradient(90deg,${MESH_DEPTH_COLORS.low},${MESH_DEPTH_COLORS.mid},${MESH_DEPTH_COLORS.high},${MESH_DEPTH_COLORS.max})`
}

export function nodeDepthCssGradient(): string {
  return `linear-gradient(90deg,${NODE_DEPTH_COLORS.zero},${NODE_DEPTH_COLORS.q25},${NODE_DEPTH_COLORS.q60},${NODE_DEPTH_COLORS.max})`
}

export function linkFlowCssGradient(): string {
  return `linear-gradient(90deg,${LINK_FLOW_COLORS.zero},${LINK_FLOW_COLORS.low},${LINK_FLOW_COLORS.q25},${LINK_FLOW_COLORS.q50},${LINK_FLOW_COLORS.q75},${LINK_FLOW_COLORS.max})`
}

export function runoffCssGradient(): string {
  return `linear-gradient(90deg,${RUNOFF_COLORS.zero},${RUNOFF_COLORS.q25},${RUNOFF_COLORS.q60},${RUNOFF_COLORS.max})`
}

export function meshDepthColorExpr(depthMax: number): maplibregl.ExpressionSpecification {
  const max = Math.max(depthMax, 0.001)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'depth'], 0],
    0,
    MESH_DEPTH_COLORS.zero,
    max * 0.05,
    MESH_DEPTH_COLORS.low,
    max * 0.35,
    MESH_DEPTH_COLORS.mid,
    max * 0.65,
    MESH_DEPTH_COLORS.high,
    max,
    MESH_DEPTH_COLORS.max,
  ]
}

export function junctionDepthColorExpr(depthMax: number): maplibregl.ExpressionSpecification {
  const max = Math.max(depthMax, 0.001)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'depth'], 0],
    0,
    NODE_DEPTH_COLORS.zero,
    max * 0.25,
    NODE_DEPTH_COLORS.q25,
    max * 0.6,
    NODE_DEPTH_COLORS.q60,
    max,
    NODE_DEPTH_COLORS.max,
  ]
}

export function linkFlowColorExpr(flowMax: number): maplibregl.ExpressionSpecification {
  const max = Math.max(flowMax, 0.001)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'flow'], 0],
    0,
    LINK_FLOW_COLORS.zero,
    max * 0.08,
    LINK_FLOW_COLORS.low,
    max * 0.28,
    LINK_FLOW_COLORS.q25,
    max * 0.52,
    LINK_FLOW_COLORS.q50,
    max * 0.76,
    LINK_FLOW_COLORS.q75,
    max,
    LINK_FLOW_COLORS.max,
  ]
}

export function linkFlowWidthExpr(flowMax: number): maplibregl.ExpressionSpecification {
  const max = Math.max(flowMax, 0.001)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'flow'], 0],
    0,
    2.5,
    max * 0.15,
    3.5,
    max * 0.4,
    5.5,
    max * 0.7,
    8,
    max,
    12,
  ]
}

export function runoffColorExpr(runoffMax: number): maplibregl.ExpressionSpecification {
  const max = Math.max(runoffMax, 0.001)
  return [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'runoff'], 0],
    0,
    RUNOFF_COLORS.zero,
    max * 0.25,
    RUNOFF_COLORS.q25,
    max * 0.6,
    RUNOFF_COLORS.q60,
    max,
    RUNOFF_COLORS.max,
  ]
}
