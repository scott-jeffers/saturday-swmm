/**
 * Convert WGS84 + elevation (meters) into a Three.js local meter scene
 * anchored at a model origin for MapLibre custom-layer rendering.
 */

import { MercatorCoordinate } from 'maplibre-gl'
import * as THREE from 'three'

export type ModelOrigin = {
  lng: number
  lat: number
  /** Mercator units per meter at the origin. */
  meterScale: number
  mercatorX: number
  mercatorY: number
  mercatorZ: number
}

export function createModelOrigin(lng: number, lat: number, altitude = 0): ModelOrigin {
  const mc = MercatorCoordinate.fromLngLat({ lng, lat }, altitude)
  return {
    lng,
    lat,
    meterScale: mc.meterInMercatorCoordinateUnits(),
    mercatorX: mc.x,
    mercatorY: mc.y,
    mercatorZ: mc.z ?? 0,
  }
}

/**
 * Local Three.js coords (Y-up, meters) relative to origin.
 * Used with MapLibre transform: translate + scale(s,-s,s) + rotateX(π/2).
 */
export function toLocalMeters(
  lng: number,
  lat: number,
  elevMeters: number,
  origin: ModelOrigin,
  verticalExaggeration = 1,
): THREE.Vector3 {
  const p = MercatorCoordinate.fromLngLat({ lng, lat }, 0)
  const s = origin.meterScale
  const x = (p.x - origin.mercatorX) / s
  const z = -(p.y - origin.mercatorY) / s
  const y = elevMeters * verticalExaggeration
  return new THREE.Vector3(x, y, z)
}

/** Build the model→mercator matrix applied each frame with MapLibre's projection. */
export function buildModelTransformMatrix(origin: ModelOrigin): THREE.Matrix4 {
  const rotateX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  const scale = new THREE.Matrix4().makeScale(origin.meterScale, -origin.meterScale, origin.meterScale)
  const translate = new THREE.Matrix4().makeTranslation(
    origin.mercatorX,
    origin.mercatorY,
    origin.mercatorZ,
  )
  return translate.multiply(scale).multiply(rotateX)
}
