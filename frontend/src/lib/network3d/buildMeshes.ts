/**
 * Three.js meshes for the 3D network: see-through pipe shells with water
 * inside, manhole shafts, and flood markers at ground level.
 *
 * Geometry is ground-relative: every manhole's rim sits on the map (z = 0) and
 * pipes hang at their real depth below it, times the vertical exaggeration.
 * That keeps the network under its 2D position at any camera angle and makes
 * flooding (water above the rim) rise above the map.
 */

import * as THREE from 'three'
import { planSpanMeters, type VerticalLink, type VerticalNetwork, type VerticalNode } from './buildVerticalNetwork'
import { createModelOrigin, toLocalMeters, type ModelOrigin } from './mercatorScene'
import type { JunctionWaterState, LinkWaterState } from './updateWaterLevels'

const LINK_COLORS: Record<string, number> = {
  conduit: 0xcbd5e1,
  pump: 0xec4899,
  orifice: 0x8b5cf6,
  weir: 0xf59e0b,
  outlet: 0xf97316,
}
export const WATER_COLOR = 0x0ea5e9
export const SURCHARGE_COLOR = 0xef4444
export const FLOOD_COLOR = 0xf97316
const SHAFT_COLORS: Record<string, number> = { junction: 0x64748b, storage: 0xd97706, outfall: 0x16a34a }

const TUBE_RADIAL = 10

export type Network3DMeshes = {
  group: THREE.Group
  origin: ModelOrigin
  verticalExaggeration: number
  pipeShells: Map<string, THREE.Mesh>
  pipeWaters: Map<string, THREE.Mesh>
  shafts: Map<string, THREE.Mesh>
  junctionWaters: Map<string, THREE.Mesh>
  floods: Map<string, THREE.Mesh>
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

/** Depth of a point below its manhole rim (negative = below ground), meters. */
function linkRelZ(link: VerticalLink, t: number, from: VerticalNode, to: VerticalNode) {
  const us = link.invertUs - from.rim
  const ds = link.invertDs - to.rim
  return us + (ds - us) * Math.min(1, Math.max(0, t))
}

function material(color: number, opacity: number) {
  return new THREE.MeshLambertMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.99,
  })
}

/**
 * @param metersPerPixel ground size of one screen pixel at the current zoom;
 *   pipes and shafts are kept a few pixels wide (real size when larger).
 */
export function buildNetwork3DMeshes(net: VerticalNetwork, verticalExaggeration: number, metersPerPixel?: number): Network3DMeshes {
  const group = new THREE.Group()
  group.name = 'network-3d'
  const ve = verticalExaggeration

  // Origin at the node centroid keeps float precision good across the network.
  let ox = 0
  let oy = 0
  for (const n of net.nodes) {
    ox += n.lng
    oy += n.lat
  }
  const origin =
    net.nodes.length > 0
      ? createModelOrigin(ox / net.nodes.length, oy / net.nodes.length, 0)
      : createModelOrigin(net.bounds ? (net.bounds.west + net.bounds.east) / 2 : 0, net.bounds ? (net.bounds.south + net.bounds.north) / 2 : 0, 0)

  // Real sizes vanish at town scale; keep pipes ~3 px and shafts ~5 px wide.
  const mpp = metersPerPixel ?? planSpanMeters(net) / 1200
  const minPipeR = Math.max(mpp * 2.2, 0.05)
  const pipeR = (d: number) => Math.max(d / 2, minPipeR)
  const shaftR = Math.max(mpp * 2.4, 0.4)

  const pipeShells = new Map<string, THREE.Mesh>()
  const pipeWaters = new Map<string, THREE.Mesh>()
  const shafts = new Map<string, THREE.Mesh>()
  const junctionWaters = new Map<string, THREE.Mesh>()
  const floods = new Map<string, THREE.Mesh>()

  for (const link of net.links) {
    const from = net.nodeById.get(link.fromNode)
    const to = net.nodeById.get(link.toNode)
    if (!from || !to) continue
    const pts = link.coordinates.map(([lng, lat], i) => {
      const t = link.lengthFractions[i] ?? i / Math.max(1, link.coordinates.length - 1)
      return toLocalMeters(lng, lat, linkRelZ(link, t, from, to) + link.diameter / 2, origin, ve)
    })
    if (pts.length < 2) continue
    const path = pts.length === 2 ? new THREE.LineCurve3(pts[0]!, pts[1]!) : new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    const segs = Math.max(2, Math.min(64, pts.length * 4))
    const conduit = link.linkKind === 'conduit'
    const r = conduit ? pipeR(link.diameter) : minPipeR * 1.4

    const shell = new THREE.Mesh(
      new THREE.TubeGeometry(path, segs, r, TUBE_RADIAL, false),
      material(LINK_COLORS[link.linkKind] ?? LINK_COLORS.conduit, conduit ? 0.6 : 0.95),
    )
    shell.name = `pipe-shell:${link.id}`
    shell.renderOrder = 2
    group.add(shell)
    pipeShells.set(link.id, shell)

    if (conduit) {
      const water = new THREE.Mesh(new THREE.TubeGeometry(path, segs, r * 0.78, TUBE_RADIAL, false), material(WATER_COLOR, 0.9))
      water.name = `pipe-water:${link.id}`
      water.visible = false
      water.renderOrder = 1
      group.add(water)
      pipeWaters.set(link.id, water)
    }
  }

  for (const node of net.nodes) {
    const depth = Math.max(node.rim - node.elevation, 0.3)
    const h = depth * ve
    const top = toLocalMeters(node.lng, node.lat, 0, origin, ve)
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftR, shaftR, h, 16, 1, true),
      material(SHAFT_COLORS[node.nodeKind] ?? SHAFT_COLORS.junction, 0.55),
    )
    shaft.position.set(top.x, top.y - h / 2, top.z)
    shaft.name = `shaft:${node.id}`
    shaft.renderOrder = 3
    group.add(shaft)
    shafts.set(node.id, shaft)

    // Water column: unit-height cylinder scaled to the water depth each period.
    const water = new THREE.Mesh(new THREE.CylinderGeometry(shaftR * 0.82, shaftR * 0.82, 1, 16), material(WATER_COLOR, 0.9))
    water.position.set(top.x, top.y - h, top.z)
    water.userData = { bottomY: top.y - h, ve, depth }
    water.visible = false
    water.renderOrder = 1
    group.add(water)
    junctionWaters.set(node.id, water)

    const flood = new THREE.Mesh(new THREE.CylinderGeometry(shaftR * 2.6, shaftR * 2.6, Math.max(shaftR * 0.25, 0.2), 24), material(FLOOD_COLOR, 0.85))
    flood.position.set(top.x, top.y + Math.max(shaftR * 0.15, 0.15), top.z)
    flood.visible = false
    group.add(flood)
    floods.set(node.id, flood)
  }

  group.traverse((o) => {
    o.frustumCulled = false
  })

  return {
    group,
    origin,
    verticalExaggeration: ve,
    pipeShells,
    pipeWaters,
    shafts,
    junctionWaters,
    floods,
    dispose: () => {
      disposeObject(group)
      pipeShells.clear()
      pipeWaters.clear()
      shafts.clear()
      junctionWaters.clear()
      floods.clear()
    },
  }
}

export function applyWaterStates(meshes: Network3DMeshes, junctionStates: JunctionWaterState[], linkStates: LinkWaterState[]): void {
  for (const st of junctionStates) {
    const water = meshes.junctionWaters.get(st.id)
    const flood = meshes.floods.get(st.id)
    if (!water) continue
    const { bottomY, ve } = water.userData as { bottomY: number; ve: number }
    if (st.height <= 0.001) {
      water.visible = false
    } else {
      const h = st.height * ve
      water.scale.set(1, h, 1)
      water.position.y = bottomY + h / 2
      ;(water.material as THREE.MeshLambertMaterial).color.setHex(st.flooded ? FLOOD_COLOR : WATER_COLOR)
      water.visible = true
    }
    if (flood) flood.visible = st.flooded
  }
  for (const st of linkStates) {
    const water = meshes.pipeWaters.get(st.id)
    if (!water) continue
    if (st.fill <= 0.02) {
      water.visible = false
      continue
    }
    const mat = water.material as THREE.MeshLambertMaterial
    mat.color.setHex(st.surcharged ? SURCHARGE_COLOR : WATER_COLOR)
    mat.opacity = 0.35 + 0.6 * st.fill
    water.visible = true
  }
}
