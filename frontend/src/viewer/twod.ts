/**
 * 2D results for the browser viewer, from a compact "SS2D" package:
 * mesh, per-period depths and the peak-depth envelope, as built by
 * scripts/build_viewer_2d_example.py (usually gzipped as .ss2d.gz).
 *
 * Layout (little-endian):
 *   "SS2D" | u32 version | u32 headerBytes | header JSON | pad to 8
 *   f64[2·V] vertices (x,y in the header's CRS)
 *   u32[3·T] triangles
 *   f32[T]   envelope (peak depth, m)
 *   u16[T] × P  depth per period, in header.depth_scale units (0.001 = mm)
 */

export type TwoDHeader = {
  crs: string
  vertex_count: number
  triangle_count: number
  period_count: number
  times: string[]
  times_sec: number[]
  report_step_sec: number
  dry_depth: number
  depth_scale: number
  unit: string
  period_max: number[]
  peak_depth_max: number
  source?: string
}

export class TwoDPackageError extends Error {}

export class TwoDPackage {
  readonly header: TwoDHeader
  readonly vertices: Float64Array
  readonly triangles: Uint32Array
  readonly envelope: Float32Array
  private readonly depths: Uint16Array
  private bounds: { minx: number; miny: number; maxx: number; maxy: number } | null = null

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf)
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3))
    if (magic !== 'SS2D') throw new TwoDPackageError('Not a Saturday-SWMM 2D results package')
    const version = dv.getUint32(4, true)
    if (version !== 1) throw new TwoDPackageError(`Unsupported 2D package version ${version}`)
    const hlen = dv.getUint32(8, true)
    this.header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen))) as TwoDHeader
    let off = 12 + hlen
    off = Math.ceil(off / 8) * 8
    const h = this.header
    this.vertices = new Float64Array(buf, off, h.vertex_count * 2)
    off += h.vertex_count * 16
    this.triangles = new Uint32Array(buf, off, h.triangle_count * 3)
    off += h.triangle_count * 12
    this.envelope = new Float32Array(buf, off, h.triangle_count)
    off += h.triangle_count * 4
    this.depths = new Uint16Array(buf, off, h.triangle_count * h.period_count)
  }

  /** Depth of every triangle in one period, in metres. */
  period(p: number): Float32Array {
    const h = this.header
    const i = Math.max(0, Math.min(h.period_count - 1, Math.trunc(p)))
    const src = this.depths.subarray(i * h.triangle_count, (i + 1) * h.triangle_count)
    const out = new Float32Array(h.triangle_count)
    for (let k = 0; k < src.length; k++) out[k] = src[k]! * h.depth_scale
    return out
  }

  faceSeries(t: number): number[] {
    const h = this.header
    const out: number[] = new Array(h.period_count)
    for (let p = 0; p < h.period_count; p++) out[p] = this.depths[p * h.triangle_count + t]! * h.depth_scale
    return out
  }

  meshBounds() {
    if (this.bounds) return this.bounds
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    const v = this.vertices
    for (let i = 0; i < v.length; i += 2) {
      const x = v[i]!, y = v[i + 1]!
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    }
    this.bounds = { minx, miny, maxx, maxy }
    return this.bounds
  }

  // ------------------------------------------------------------ API shapes
  info(name: string) {
    const h = this.header
    return {
      has_mesh: true,
      vertex_count: h.vertex_count,
      triangle_count: h.triangle_count,
      output_file: name,
      report_2d: true,
      dry_depth: h.dry_depth,
      twod_path: name,
      has_results: true,
      mesh_file: name,
      boundary_edge_count: 0,
    }
  }

  mesh() {
    const h = this.header
    const vertices: number[][] = new Array(h.vertex_count)
    for (let i = 0; i < h.vertex_count; i++) vertices[i] = [this.vertices[2 * i]!, this.vertices[2 * i + 1]!]
    const triangles: number[][] = new Array(h.triangle_count)
    for (let i = 0; i < h.triangle_count; i++) triangles[i] = [this.triangles[3 * i]!, this.triangles[3 * i + 1]!, this.triangles[3 * i + 2]!]
    return {
      crs: h.crs,
      bounds: this.meshBounds(),
      geojson: { type: 'FeatureCollection', features: [] },
      vertices,
      triangles,
      counts: { vertices: h.vertex_count, triangles: h.triangle_count },
      options: {},
      mesh_file: h.source ?? null,
    }
  }

  periods() {
    const h = this.header
    return { period_count: h.period_count, times: h.times, times_sec: h.times_sec, peak_depth_max: h.peak_depth_max }
  }

  metadata(name: string) {
    const h = this.header
    return {
      path: name,
      period_count: h.period_count,
      triangle_count: h.triangle_count,
      variables: [{ id: 'depth', label: 'Depth', unit: h.unit }],
      report_step_sec: h.report_step_sec,
      out_period_count: null,
      periods_match_out: null,
    }
  }

  faceInfo(t: number) {
    const tri = [this.triangles[3 * t]!, this.triangles[3 * t + 1]!, this.triangles[3 * t + 2]!]
    return {
      triangle_index: t,
      mannings_n: NaN,
      z_min: NaN,
      z_max: NaN,
      z_mean: NaN,
      area: null,
      coupled_node: null,
      cd: null,
      coupling_area: null,
      vertices: tri.map((i) => [this.vertices[2 * i]!, this.vertices[2 * i + 1]!]),
    }
  }

  faceSeriesResponse(t: number) {
    const h = this.header
    return {
      object_id: String(t),
      variable: 'depth',
      variable_label: 'Depth',
      unit: h.unit,
      report_step_sec: h.report_step_sec,
      values: this.faceSeries(t),
      times_sec: h.times_sec,
      times: h.times,
    }
  }
}

/** Read a .ss2d or gzipped .ss2d.gz file. */
export async function readTwoDPackage(buf: ArrayBuffer): Promise<{ pkg: TwoDPackage; raw: ArrayBuffer }> {
  const u8 = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  let raw = buf
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
    raw = await new Response(ds).arrayBuffer()
  }
  return { pkg: new TwoDPackage(raw), raw }
}
