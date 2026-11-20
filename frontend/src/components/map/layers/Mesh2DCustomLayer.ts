/**
 * MapLibre custom layer: render 2D mesh as flat-shaded triangles colored by depth.
 * Geometry uploads once; colors update per period from a Float32Array.
 *
 * MapLibre 4+ prefers WebGL2 — shaders must use GLSL ES 3.00 when the context is WebGL2.
 */

import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl'
import { MercatorCoordinate } from 'maplibre-gl'
import { MESH_WIREFRAME_MIN_ZOOM } from '../../../lib/meshConstants'
import { fillTriangleColorsRgba8 } from '../../../lib/meshDepthColors'
import { buildMeshEdgeLinePositions } from '../../../lib/meshWireframe'

export const MESH2D_CUSTOM_LAYER_ID = 'mesh-2d-custom'

const VS_WEBGL1 = `
precision mediump float;
attribute vec2 a_pos;
attribute vec4 a_color;
uniform mat4 u_matrix;
varying vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  v_color = a_color;
}
`

const FS_WEBGL1 = `
precision mediump float;
varying vec4 v_color;
uniform float u_opacity;
void main() {
  if (v_color.a < 0.01) discard;
  gl_FragColor = vec4(v_color.rgb, v_color.a * u_opacity);
}
`

const VS_WEBGL2 = `#version 300 es
precision mediump float;
in vec2 a_pos;
in vec4 a_color;
uniform mat4 u_matrix;
out vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  v_color = a_color;
}
`

const FS_WEBGL2 = `#version 300 es
precision mediump float;
in vec4 v_color;
uniform float u_opacity;
out highp vec4 fragColor;
void main() {
  if (v_color.a < 0.01) discard;
  fragColor = vec4(v_color.rgb, v_color.a * u_opacity);
}
`

function isWebGL2(gl: WebGLRenderingContext | WebGL2RenderingContext): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
}

function compile(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return sh
}

export type Mesh2DGeometry = {
  /** WGS84 [lng, lat] per unique vertex. */
  vertices: number[][]
  /** Triangle index triples [i, j, k]. */
  triangles: number[][]
}

/** Default mesh-only fill (no depth): slate, semi-transparent. */
const MESH_ONLY_RGBA: [number, number, number, number] = [100, 116, 139, 70]

/** Wireframe stroke (matches small-mesh GeoJSON outline). */
const WIREFRAME_RGBA_LIGHT: [number, number, number, number] = [100, 116, 139, 140]
const WIREFRAME_RGBA_DARK: [number, number, number, number] = [148, 163, 184, 140]

export class Mesh2DCustomLayer {
  id = MESH2D_CUSTOM_LAYER_ID
  type = 'custom' as const
  renderingMode: '2d' = '2d'

  private map: MapLibreMap | null = null
  private program: WebGLProgram | null = null
  private posBuffer: WebGLBuffer | null = null
  private colorBuffer: WebGLBuffer | null = null
  private edgePosBuffer: WebGLBuffer | null = null
  private edgeColorBuffer: WebGLBuffer | null = null
  private edgeVertexCount = 0
  private pendingEdgePos: Float32Array | null = null
  private wireframeEnabled = false
  private wireframeRgba: [number, number, number, number] = WIREFRAME_RGBA_LIGHT
  private aPos = -1
  private aColor = -1
  private uMatrix: WebGLUniformLocation | null = null
  private uOpacity: WebGLUniformLocation | null = null
  private opacity = 1
  private vertexCount = 0
  private colorBytes: Uint8Array | null = null
  private pendingPos: Float32Array | null = null
  private depthMax = 0.01
  private visible = true
  private geometryKey = ''
  private pendingDepths: Float32Array | null = null
  private meshOnly = false
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null
  private restoreHandler: (() => void) | null = null
  private renderCount = 0
  private lastError: string | null = null
  private posSample: number[] | null = null

  /** Multiplies the layer's alpha (Layers panel). */
  setOpacity(o: number) {
    this.opacity = Math.max(0, Math.min(1, o))
    this.map?.triggerRepaint()
  }

  setVisible(v: boolean) {
    this.visible = v
    this.map?.triggerRepaint()
  }

  setDepthMax(max: number) {
    this.depthMax = Math.max(max, 0.001)
    if (this.pendingDepths && !this.meshOnly) this.setDepths(this.pendingDepths)
  }

  /** Triangle/cell outlines — drawn only when zoom ≥ MESH_WIREFRAME_MIN_ZOOM. */
  setWireframe(enabled: boolean, lightBasemap = true) {
    this.wireframeEnabled = enabled
    this.wireframeRgba = lightBasemap ? WIREFRAME_RGBA_LIGHT : WIREFRAME_RGBA_DARK
    this.uploadEdgeColors()
    this.map?.triggerRepaint()
  }

  setGeometry(geom: Mesh2DGeometry | null) {
    if (!geom?.vertices?.length || !geom?.triangles?.length) {
      this.vertexCount = 0
      this.geometryKey = ''
      this.colorBytes = null
      this.pendingPos = null
      this.edgeVertexCount = 0
      this.pendingEdgePos = null
      this.map?.triggerRepaint()
      return
    }
    const key = `${geom.vertices.length}:${geom.triangles.length}`
    if (key === this.geometryKey && (this.posBuffer || this.pendingPos)) {
      return
    }
    this.geometryKey = key

    const tris = geom.triangles
    const verts = geom.vertices
    const n = tris.length
    const positions = new Float32Array(n * 6)
    for (let t = 0; t < n; t++) {
      const trip = tris[t]
      if (!trip || trip.length < 3) continue
      for (let k = 0; k < 3; k++) {
        const vi = trip[k]
        const v = verts[vi]
        const lng = v?.[0] ?? 0
        const lat = v?.[1] ?? 0
        const mc = MercatorCoordinate.fromLngLat({ lng, lat }, 0)
        const o = t * 6 + k * 2
        positions[o] = mc.x
        positions[o + 1] = mc.y
      }
    }
    this.vertexCount = n * 3
    this.colorBytes = new Uint8Array(this.vertexCount * 4)
    this.pendingPos = positions
    this.posSample = Array.from(positions.slice(0, 6))

    const edgePos = buildMeshEdgeLinePositions(geom)
    this.edgeVertexCount = edgePos.length / 2
    this.pendingEdgePos = edgePos

    const gl = this.gl
    if (gl && this.posBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
      if (this.colorBuffer && this.colorBytes) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, this.colorBytes, gl.DYNAMIC_DRAW)
      }
      this.pendingPos = null
      this.uploadEdgePositions(gl)
    }

    if (this.meshOnly) {
      this.setSolidColor(MESH_ONLY_RGBA)
    } else if (this.pendingDepths) {
      this.setDepths(this.pendingDepths)
    }
    this.map?.triggerRepaint()
  }

  /** Flat fill for mesh-on / depth-off (large meshes have no GeoJSON outline). */
  setSolidColor(rgba: [number, number, number, number] = MESH_ONLY_RGBA) {
    this.meshOnly = true
    this.pendingDepths = null
    if (!this.colorBytes || this.vertexCount < 3) {
      this.map?.triggerRepaint()
      return
    }
    const [r, g, b, a] = rgba
    for (let i = 0; i < this.colorBytes.length; i += 4) {
      this.colorBytes[i] = r
      this.colorBytes[i + 1] = g
      this.colorBytes[i + 2] = b
      this.colorBytes[i + 3] = a
    }
    this.uploadColors()
    this.map?.triggerRepaint()
  }

  setDepths(values: Float32Array | null) {
    this.meshOnly = false
    this.pendingDepths = values
    if (!values || !this.colorBytes || values.length * 3 !== this.vertexCount) {
      this.map?.triggerRepaint()
      return
    }
    fillTriangleColorsRgba8(values, this.depthMax, this.colorBytes)
    this.uploadColors()
    this.map?.triggerRepaint()
  }

  private uploadColors() {
    const gl = this.gl
    if (!gl || !this.colorBuffer || !this.colorBytes) return
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colorBytes)
  }

  private uploadEdgePositions(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (!this.edgePosBuffer || !this.pendingEdgePos) return
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgePosBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.pendingEdgePos, gl.STATIC_DRAW)
    this.pendingEdgePos = null
    this.uploadEdgeColors()
  }

  private uploadEdgeColors() {
    if (this.edgeVertexCount < 2) return
    const bytes = new Uint8Array(this.edgeVertexCount * 4)
    const [r, g, b, a] = this.wireframeRgba
    for (let i = 0; i < bytes.length; i += 4) {
      bytes[i] = r
      bytes[i + 1] = g
      bytes[i + 2] = b
      bytes[i + 3] = a
    }
    const gl = this.gl
    if (gl && this.edgeColorBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeColorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW)
    }
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.gl = gl
    const webgl2 = isWebGL2(gl)
    let prog: WebGLProgram
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, webgl2 ? VS_WEBGL2 : VS_WEBGL1)
      const fs = compile(gl, gl.FRAGMENT_SHADER, webgl2 ? FS_WEBGL2 : FS_WEBGL1)
      prog = gl.createProgram()!
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(prog)}`)
      }
    } catch (err) {
      this.lastError = `${webgl2 ? 'webgl2' : 'webgl1'}: ${String(err)}`
      throw err
    }
    this.program = prog
    this.aPos = gl.getAttribLocation(prog, 'a_pos')
    this.aColor = gl.getAttribLocation(prog, 'a_color')
    this.uMatrix = gl.getUniformLocation(prog, 'u_matrix')
    this.uOpacity = gl.getUniformLocation(prog, 'u_opacity')
    this.posBuffer = gl.createBuffer()
    this.colorBuffer = gl.createBuffer()
    this.edgePosBuffer = gl.createBuffer()
    this.edgeColorBuffer = gl.createBuffer()

    if (this.pendingPos && this.posBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.pendingPos, gl.STATIC_DRAW)
      this.pendingPos = null
    }
    if (this.colorBytes && this.colorBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.colorBytes, gl.DYNAMIC_DRAW)
    }
    if (this.pendingEdgePos && this.edgePosBuffer) {
      this.uploadEdgePositions(gl)
    }
    if (this.meshOnly) {
      this.setSolidColor(MESH_ONLY_RGBA)
    } else if (this.pendingDepths) {
      this.setDepths(this.pendingDepths)
    }

    this.restoreHandler = () => {
      // Buffers are invalid after context restore; force a full geometry re-upload next sync.
      this.geometryKey = ''
      this.gl = null
      this.program = null
      this.posBuffer = null
      this.colorBuffer = null
      this.edgePosBuffer = null
      this.edgeColorBuffer = null
    }
    map.getCanvas().addEventListener('webglcontextrestored', this.restoreHandler)
  }

  onRemove(_map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    if (this.restoreHandler) {
      _map.getCanvas().removeEventListener('webglcontextrestored', this.restoreHandler)
      this.restoreHandler = null
    }
    if (this.posBuffer) gl.deleteBuffer(this.posBuffer)
    if (this.colorBuffer) gl.deleteBuffer(this.colorBuffer)
    if (this.edgePosBuffer) gl.deleteBuffer(this.edgePosBuffer)
    if (this.edgeColorBuffer) gl.deleteBuffer(this.edgeColorBuffer)
    if (this.program) gl.deleteProgram(this.program)
    this.posBuffer = null
    this.colorBuffer = null
    this.edgePosBuffer = null
    this.edgeColorBuffer = null
    this.program = null
    this.gl = null
    this.map = null
  }

  /** Diagnostics for dev tooling (window.__ssMap). */
  debugState() {
    return {
      hasProgram: Boolean(this.program),
      hasGl: Boolean(this.gl),
      vertexCount: this.vertexCount,
      visible: this.visible,
      meshOnly: this.meshOnly,
      depthMax: this.depthMax,
      geometryKey: this.geometryKey,
      aPos: this.aPos,
      aColor: this.aColor,
      renderCount: this.renderCount,
      lastError: this.lastError,
      wireframeEnabled: this.wireframeEnabled,
      edgeVertexCount: this.edgeVertexCount,
      wireframeMinZoom: MESH_WIREFRAME_MIN_ZOOM,
      colorSample: this.colorBytes ? Array.from(this.colorBytes.slice(0, 8)) : null,
      posSample: this.posSample,
    }
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: Parameters<CustomLayerInterface['render']>[1]) {
    if (!this.visible || !this.program || this.vertexCount < 3) return
    this.renderCount++
    gl.useProgram(this.program)
    // MapLibre may hand back a Float64Array mat4; WebGL only accepts Float32Array/number[].
    const m =
      matrix instanceof Float32Array
        ? matrix
        : new Float32Array(matrix as unknown as ArrayLike<number>)
    gl.uniformMatrix4fv(this.uMatrix, false, m)
    gl.uniform1f(this.uOpacity, this.opacity)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer)
    gl.enableVertexAttribArray(this.aPos)
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
    gl.enableVertexAttribArray(this.aColor)
    gl.vertexAttribPointer(this.aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0)

    // MapLibre default expects premultiplied; use separate blend for straight alpha.
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)

    const zoom = this.map?.getZoom() ?? 0
    if (
      this.wireframeEnabled &&
      zoom >= MESH_WIREFRAME_MIN_ZOOM &&
      this.edgeVertexCount >= 2 &&
      this.edgePosBuffer &&
      this.edgeColorBuffer
    ) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgePosBuffer)
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeColorBuffer)
      gl.vertexAttribPointer(this.aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0)
      gl.drawArrays(gl.LINES, 0, this.edgeVertexCount)
    }
  }
}
