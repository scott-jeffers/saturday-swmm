/**
 * MapLibre custom layer: 3D pipe network + junction water via Three.js
 * sharing MapLibre's WebGL context (renderingMode: '3d').
 */

import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import * as THREE from 'three'
import {
  buildVerticalNetwork,
  suggestVerticalExaggeration,
  type VerticalNetwork,
} from '../../../lib/network3d/buildVerticalNetwork'
import {
  applyWaterStates,
  buildNetwork3DMeshes,
  type Network3DMeshes,
} from '../../../lib/network3d/buildMeshes'
import { buildModelTransformMatrix } from '../../../lib/network3d/mercatorScene'
import {
  computeJunctionWaterStates,
  computeLinkWaterStates,
  depthsFromSnapshot,
} from '../../../lib/network3d/updateWaterLevels'

export const NETWORK3D_CUSTOM_LAYER_ID = 'network-3d-custom'

export type Network3DSnapshot = {
  node_ids: string[]
  node_depths: number[]
} | null

export class Network3DCustomLayer {
  id = NETWORK3D_CUSTOM_LAYER_ID
  type = 'custom' as const
  renderingMode: '3d' = '3d'

  private map: MapLibreMap | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.Camera | null = null
  private meshes: Network3DMeshes | null = null
  private vertical: VerticalNetwork | null = null
  private modelMatrix: THREE.Matrix4 | null = null
  private visible = true
  private geometryKey = ''
  private pendingGeojson: FeatureCollection | null = null
  private lastBuiltFc: FeatureCollection | null = null
  private pendingSnapshot: Network3DSnapshot = null
  private restoreHandler: (() => void) | null = null
  private renderCount = 0
  private unitScale = 1
  private veOverride: number | null = null
  private lights: THREE.Object3D[] = []
  private zoomBucket = NaN
  private zoomHandler: (() => void) | null = null

  /** Ground meters per screen pixel at the map centre. */
  private metersPerPixel(): number | null {
    if (!this.map) return null
    const lat = this.map.getCenter().lat
    return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** this.map.getZoom())
  }

  private currentBucket() {
    return this.map ? Math.round(this.map.getZoom() * 2) / 2 : NaN
  }

  /** Model length unit → meters (0.3048 for US-unit models). Rebuilds when changed. */
  setUnitScale(scale: number) {
    if (scale === this.unitScale) return
    this.unitScale = scale
    this.rebuildIfReady()
  }

  /** Vertical exaggeration; null = automatic for the network size. */
  setVerticalExaggeration(ve: number | null) {
    if (ve === this.veOverride) return
    this.veOverride = ve
    this.rebuildIfReady()
  }

  get verticalExaggeration() {
    return this.meshes?.verticalExaggeration ?? null
  }

  private rebuildIfReady() {
    const fc = this.lastBuiltFc ?? this.pendingGeojson
    if (fc && this.scene && this.renderer) {
      this.rebuildMeshes(fc)
      this.lastBuiltFc = fc
    }
    this.map?.triggerRepaint()
  }
  private lastRenderError: string | null = null

  setVisible(v: boolean) {
    this.visible = v
    this.map?.triggerRepaint()
  }

  setNetworkGeoJson(fc: FeatureCollection | null) {
    this.pendingGeojson = fc
    if (!fc) {
      this.clearMeshes()
      this.geometryKey = ''
      this.lastBuiltFc = null
      this.map?.triggerRepaint()
      return
    }
    if (fc === this.lastBuiltFc && this.meshes) {
      return
    }
    this.geometryKey = `${fc.features.length}`
    if (this.scene && this.renderer) {
      this.rebuildMeshes(fc)
      this.lastBuiltFc = fc
    }
    this.map?.triggerRepaint()
  }

  setSnapshot(snapshot: Network3DSnapshot) {
    this.pendingSnapshot = snapshot
    this.applySnapshot()
    this.map?.triggerRepaint()
  }

  private clearMeshes() {
    if (this.meshes && this.scene) {
      this.scene.remove(this.meshes.group)
      this.meshes.dispose()
      this.meshes = null
    }
    this.vertical = null
    this.modelMatrix = null
  }

  private rebuildMeshes(fc: FeatureCollection) {
    this.clearMeshes()
    if (!this.scene) return
    const vertical = buildVerticalNetwork(fc, this.unitScale)
    this.vertical = vertical
    if (vertical.nodes.length === 0 && vertical.links.length === 0) return
    const mpp = this.metersPerPixel()
    this.zoomBucket = this.currentBucket()
    const ve = this.veOverride ?? suggestVerticalExaggeration(vertical, mpp ?? undefined)
    const meshes = buildNetwork3DMeshes(vertical, ve, mpp ?? undefined)
    this.meshes = meshes
    this.modelMatrix = buildModelTransformMatrix(meshes.origin)
    this.scene.add(meshes.group)
    this.applySnapshot()
  }

  private applySnapshot() {
    if (!this.meshes || !this.vertical) return
    const snap = this.pendingSnapshot
    const depths =
      snap && snap.node_ids.length
        ? depthsFromSnapshot(snap.node_ids, snap.node_depths, this.unitScale)
        : new Map<string, number>()
    const jStates = computeJunctionWaterStates(this.vertical.nodes, depths)
    const lStates = computeLinkWaterStates(
      this.vertical.links,
      this.vertical.nodeById,
      depths,
    )
    applyWaterStates(this.meshes, jStates, lStates)
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.camera = new THREE.Camera()
    this.scene = new THREE.Scene()

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    })
    this.renderer.autoClear = false
    // Lit materials so tubes and shafts read as solid shapes.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.6)
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(0.4, 1, 0.6)
    this.lights = [hemi, sun]
    for (const l of this.lights) this.scene.add(l)

    this.restoreHandler = () => {
      this.renderer = null
      this.clearMeshes()
      this.geometryKey = ''
      this.lastBuiltFc = null
    }
    map.getCanvas().addEventListener('webglcontextrestored', this.restoreHandler)
    // Keep pipes a few pixels wide (and auto depth readable) as the zoom changes.
    this.zoomHandler = () => {
      if (this.currentBucket() !== this.zoomBucket) this.rebuildIfReady()
    }
    map.on('zoomend', this.zoomHandler)

    if (this.pendingGeojson) {
      this.rebuildMeshes(this.pendingGeojson)
      this.lastBuiltFc = this.pendingGeojson
    }

    if (import.meta.env.DEV) {
      ;(window as unknown as { __ssNetwork3D?: Network3DCustomLayer }).__ssNetwork3D = this
    }
  }

  onRemove(_map: MapLibreMap, _gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (this.zoomHandler) {
      _map.off('zoomend', this.zoomHandler)
      this.zoomHandler = null
    }
    if (this.restoreHandler) {
      _map.getCanvas().removeEventListener('webglcontextrestored', this.restoreHandler)
      this.restoreHandler = null
    }
    this.clearMeshes()
    this.renderer?.dispose()
    this.renderer = null
    this.scene = null
    this.camera = null
    this.map = null
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: Parameters<CustomLayerInterface['render']>[1]) {
    if (
      !this.visible ||
      !this.renderer ||
      !this.scene ||
      !this.camera ||
      !this.meshes ||
      !this.modelMatrix
    ) {
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }

    try {
      const m =
        matrix instanceof Float32Array
          ? matrix
          : new Float32Array(matrix as unknown as ArrayLike<number>)

      const projection = new THREE.Matrix4().fromArray(Array.from(m))
      this.camera.projectionMatrix = projection.multiply(this.modelMatrix.clone())

      this.renderer.resetState()
      this.renderer.render(this.scene, this.camera)
      this.renderCount++
    } catch (err) {
      this.lastRenderError = String(err)
    }
  }

  debugState() {
    const firstPipe = this.meshes?.pipeShells.values().next().value as THREE.Mesh | undefined
    const firstShaft = this.meshes?.shafts.values().next().value as THREE.Mesh | undefined
    if (firstPipe?.geometry && !firstPipe.geometry.boundingSphere) {
      firstPipe.geometry.computeBoundingSphere()
    }
    return {
      visible: this.visible,
      hasMeshes: Boolean(this.meshes),
      conduitCount: this.vertical?.conduitCount ?? 0,
      nodeCount: this.vertical?.nodes.length ?? 0,
      geometryKey: this.geometryKey,
      ve: this.meshes?.verticalExaggeration ?? null,
      origin: this.meshes
        ? { lng: this.meshes.origin.lng, lat: this.meshes.origin.lat }
        : null,
      firstPipePos: firstPipe?.position
        ? { x: firstPipe.position.x, y: firstPipe.position.y, z: firstPipe.position.z }
        : null,
      firstPipeRadius: firstPipe?.geometry?.boundingSphere?.radius ?? null,
      firstShaftPos: firstShaft?.position
        ? { x: firstShaft.position.x, y: firstShaft.position.y, z: firstShaft.position.z }
        : null,
      renderCount: this.renderCount,
      lastRenderError: this.lastRenderError,
      childCount: this.meshes?.group.children.length ?? 0,
    }
  }
}
