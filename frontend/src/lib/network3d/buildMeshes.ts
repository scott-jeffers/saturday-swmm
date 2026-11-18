/**
 * Build Three.js meshes for 3D pipe shells, junction shafts, and water fills.
 */

import * as THREE from 'three'
import {
  invertAtFraction,
  type VerticalLink,
  type VerticalNetwork,
  type VerticalNode,
} from './buildVerticalNetwork'
import { createModelOrigin, toLocalMeters, type ModelOrigin } from './mercatorScene'
import type { JunctionWaterState, LinkWaterState } from './updateWaterLevels'

export const PIPE_SHELL_COLOR = 0x1e40af
export const PIPE_WATER_COLOR = 0x38bdf8
export const SHAFT_JUNCTION_COLOR = 0x1d4ed8
export const SHAFT_STORAGE_COLOR = 0xd97706
export const SHAFT_OUTFALL_COLOR = 0x64748b
export const WATER_COLOR = 0x0ea5e9

const TUBE_RADIAL = 8
const MIN_RADIUS_M = 0.08
/**
 * Floor pipe/shaft size as a fraction of network plan size so city-scale
 * overviews still read as thick tubes (reference-style), not hairlines.
 */
function networkScaleRadii(planSpanM: number): { pipeMin: number; shaft: number } {
  const span = Math.max(planSpanM, 200)
  return {
    pipeMin: Math.min(12, Math.max(1.5, span / 600)),
    shaft: Math.min(20, Math.max(3.5, span / 280)),
  }
}

function displayRadius(diameter: number, pipeMin: number): number {
  return Math.max(diameter / 2, pipeMin, MIN_RADIUS_M)
}

export type Network3DMeshes = {
  group: THREE.Group
  origin: ModelOrigin
  verticalExaggeration: number
  /** Pipe shell meshes by link id. */
  pipeShells: Map<string, THREE.Mesh>
  /** Pipe water meshes by link id (opacity driven by fill). */
  pipeWaters: Map<string, THREE.Mesh>
  /** Shaft shell meshes by node id. */
  shafts: Map<string, THREE.Mesh>
  /** Water fill meshes by node id (scaled on Y). */
  junctionWaters: Map<string, THREE.Mesh>
  /** Unit-height water mesh base scale (Y = height * ve). */
  junctionWaterBaseHeight: Map<string, number>
  dispose: () => void
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}

const WATER_RADIUS_FACTOR = 0.72

function shaftColor(kind: string): number {
  if (kind === 'storage') return SHAFT_STORAGE_COLOR
  if (kind === 'outfall') return SHAFT_OUTFALL_COLOR
  return SHAFT_JUNCTION_COLOR
}

function buildPipeCurve(
  link: VerticalLink,
  origin: ModelOrigin,
  ve: number,
): THREE.CatmullRomCurve3 | null {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < link.coordinates.length; i++) {
    const [lng, lat] = link.coordinates[i]!
    const t = link.lengthFractions[i] ?? i / Math.max(1, link.coordinates.length - 1)
    const elev = invertAtFraction(link, t) + link.diameter / 2
    pts.push(toLocalMeters(lng, lat, elev, origin, ve))
  }
  if (pts.length < 2) return null
  // CatmullRom needs careful tension on nearly-collinear points; use chordal.
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1)
}

function makePipeMesh(
  curve: THREE.CatmullRomCurve3,
  radius: number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const tubular = Math.max(4, Math.min(64, curve.points.length * 4))
  const geom = new THREE.TubeGeometry(curve, tubular, radius, TUBE_RADIAL, false)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.99,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.frustumCulled = false
  return mesh
}

function makeShaftMesh(
  node: VerticalNode,
  origin: ModelOrigin,
  ve: number,
  shaftRadius: number,
): { shaft: THREE.Mesh; water: THREE.Mesh; waterBaseHeight: number } {
  const height = Math.max(node.rim - node.elevation, 0.5)
  const heightScene = height * ve
  const radius = shaftRadius
  const midElev = node.elevation + height / 2
  const center = toLocalMeters(node.lng, node.lat, midElev, origin, ve)

  const shaftGeom = new THREE.CylinderGeometry(radius, radius, heightScene, 12)
  const shaftMat = new THREE.MeshBasicMaterial({
    color: shaftColor(node.nodeKind),
    transparent: true,
    opacity: 0.92,
  })
  const shaft = new THREE.Mesh(shaftGeom, shaftMat)
  shaft.position.copy(center)
  shaft.frustumCulled = false

  // Unit-height cylinder; scale.y set from water height each period.
  const waterBaseHeight = 1 * ve
  const waterGeom = new THREE.CylinderGeometry(
    radius * WATER_RADIUS_FACTOR,
    radius * WATER_RADIUS_FACTOR,
    waterBaseHeight,
    12,
  )
  const waterMat = new THREE.MeshBasicMaterial({
    color: WATER_COLOR,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  const water = new THREE.Mesh(waterGeom, waterMat)
  // Position at invert + half water height; updated in applyWaterStates.
  const invertPos = toLocalMeters(node.lng, node.lat, node.elevation, origin, ve)
  water.position.set(invertPos.x, invertPos.y, invertPos.z)
  water.scale.set(1, 0.001, 1)
  water.visible = false
  water.frustumCulled = false
  water.userData.invertY = invertPos.y
  water.userData.ve = ve

  return { shaft, water, waterBaseHeight }
}

export function buildNetwork3DMeshes(
  net: VerticalNetwork,
  verticalExaggeration: number,
): Network3DMeshes {
  const group = new THREE.Group()
  group.name = 'network-3d'

  const bounds = net.bounds
  // Prefer node centroid over bbox center so the scene origin sits in the
  // dense network (bbox center can sit in empty space when outliers expand bounds).
  let originLng = net.nodes[0]?.lng ?? 0
  let originLat = net.nodes[0]?.lat ?? 0
  if (net.nodes.length > 0) {
    let sx = 0
    let sy = 0
    for (const n of net.nodes) {
      sx += n.lng
      sy += n.lat
    }
    originLng = sx / net.nodes.length
    originLat = sy / net.nodes.length
  } else if (bounds) {
    originLng = (bounds.west + bounds.east) / 2
    originLat = (bounds.south + bounds.north) / 2
  }
  const origin = createModelOrigin(originLng, originLat, 0)
  const ve = verticalExaggeration

  // Estimate plan span (meters) from WGS84 bounds for visual sizing.
  let planSpanM = 1000
  if (bounds) {
    const midLat = (bounds.north + bounds.south) / 2
    const mPerDegLat = 111_320
    const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180)
    planSpanM = Math.hypot(
      (bounds.east - bounds.west) * mPerDegLng,
      (bounds.north - bounds.south) * mPerDegLat,
    )
  }
  const { pipeMin, shaft: shaftRadius } = networkScaleRadii(planSpanM)

  const pipeShells = new Map<string, THREE.Mesh>()
  const pipeWaters = new Map<string, THREE.Mesh>()
  const shafts = new Map<string, THREE.Mesh>()
  const junctionWaters = new Map<string, THREE.Mesh>()
  const junctionWaterBaseHeight = new Map<string, number>()

  const pipeGroup = new THREE.Group()
  pipeGroup.name = 'pipes'
  const nodeGroup = new THREE.Group()
  nodeGroup.name = 'nodes'
  group.add(pipeGroup)
  group.add(nodeGroup)

  for (const link of net.links) {
    const curve = buildPipeCurve(link, origin, ve)
    if (!curve) continue
    const r = displayRadius(link.diameter, pipeMin)
    const shell = makePipeMesh(curve, r, PIPE_SHELL_COLOR, 0.95)
    shell.name = `pipe-shell:${link.id}`
    pipeGroup.add(shell)
    pipeShells.set(link.id, shell)

    const water = makePipeMesh(curve, r * WATER_RADIUS_FACTOR, PIPE_WATER_COLOR, 0)
    water.name = `pipe-water:${link.id}`
    water.visible = false
    pipeGroup.add(water)
    pipeWaters.set(link.id, water)
  }

  for (const node of net.nodes) {
    // Short stub for outfalls; full shaft for junctions/storage.
    const { shaft, water, waterBaseHeight } = makeShaftMesh(node, origin, ve, shaftRadius)
    if (node.nodeKind === 'outfall') {
      // Shrink outfall shaft visually.
      shaft.scale.set(0.7, 0.35, 0.7)
    }
    shaft.name = `shaft:${node.id}`
    water.name = `water:${node.id}`
    nodeGroup.add(shaft)
    nodeGroup.add(water)
    shafts.set(node.id, shaft)
    junctionWaters.set(node.id, water)
    junctionWaterBaseHeight.set(node.id, waterBaseHeight)
  }

  // Soft ambient kept for future lit materials; BasicMaterial ignores lights.
  const amb = new THREE.AmbientLight(0xffffff, 1)
  group.add(amb)
  group.traverse((obj) => {
    obj.frustumCulled = false
  })

  return {
    group,
    origin,
    verticalExaggeration: ve,
    pipeShells,
    pipeWaters,
    shafts,
    junctionWaters,
    junctionWaterBaseHeight,
    dispose: () => {
      disposeObject(group)
      pipeShells.clear()
      pipeWaters.clear()
      shafts.clear()
      junctionWaters.clear()
      junctionWaterBaseHeight.clear()
    },
  }
}

export function applyWaterStates(
  meshes: Network3DMeshes,
  junctionStates: JunctionWaterState[],
  linkStates: LinkWaterState[],
): void {
  for (const st of junctionStates) {
    const water = meshes.junctionWaters.get(st.id)
    if (!water) continue
    const ve = (water.userData.ve as number) || meshes.verticalExaggeration
    const invertY = water.userData.invertY as number
    if (st.height <= 0.001) {
      water.visible = false
      water.scale.set(1, 0.001, 1)
      continue
    }
    const sceneH = st.height * ve
    // Unit cylinder height is `ve` (1m * ve); scale.y = sceneH / ve = height (meters).
    const base = meshes.junctionWaterBaseHeight.get(st.id) ?? ve
    const scaleY = sceneH / base
    water.scale.set(1, Math.max(scaleY, 0.001), 1)
    // Cylinder is centered; lift so bottom sits on invert.
    water.position.y = invertY + sceneH / 2
    water.visible = true
  }

  for (const st of linkStates) {
    const water = meshes.pipeWaters.get(st.id)
    if (!water) continue
    const mat = water.material as THREE.MeshBasicMaterial
    if (st.fill <= 0.02) {
      water.visible = false
      mat.opacity = 0
      continue
    }
    water.visible = true
    mat.transparent = true
    mat.opacity = 0.25 + 0.55 * st.fill
    mat.depthWrite = mat.opacity > 0.7
  }
}
