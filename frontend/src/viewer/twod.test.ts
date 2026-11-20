import { describe, expect, it } from 'vitest'
import { TwoDPackage, TwoDPackageError } from './twod'

function build(): ArrayBuffer {
  const header = {
    crs: 'EPSG:25832', vertex_count: 4, triangle_count: 2, period_count: 3,
    times: ['00:00:00', '00:15:00', '00:30:00'], times_sec: [0, 900, 1800], report_step_sec: 900,
    dry_depth: 0.0001, depth_scale: 0.001, unit: 'm', period_max: [0, 0.25, 0.1], peak_depth_max: 0.25,
  }
  const hb = new TextEncoder().encode(JSON.stringify(header))
  let off = 12 + hb.length
  off = Math.ceil(off / 8) * 8
  const size = off + 4 * 16 + 2 * 12 + 2 * 4 + 3 * 2 * 2
  const buf = new ArrayBuffer(size)
  const dv = new DataView(buf)
  ;[...'SS2D'].forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)))
  dv.setUint32(4, 1, true)
  dv.setUint32(8, hb.length, true)
  new Uint8Array(buf, 12, hb.length).set(hb)
  new Float64Array(buf, off, 8).set([0, 0, 10, 0, 10, 10, 0, 10])
  new Uint32Array(buf, off + 64, 6).set([0, 1, 2, 0, 2, 3])
  new Float32Array(buf, off + 88, 2).set([0.25, 0.05])
  new Uint16Array(buf, off + 96, 6).set([0, 0, 250, 50, 100, 0])
  return buf
}

describe('2D package', () => {
  const pkg = new TwoDPackage(build())
  it('reads the mesh', () => {
    const m = pkg.mesh()
    expect(m.counts).toEqual({ vertices: 4, triangles: 2 })
    expect(m.triangles[1]).toEqual([0, 2, 3])
    expect(m.bounds).toEqual({ minx: 0, miny: 0, maxx: 10, maxy: 10 })
  })
  it('decodes depths per period and per cell', () => {
    expect(Array.from(pkg.period(1)).map((v) => +v.toFixed(3))).toEqual([0.25, 0.05])
    expect(pkg.faceSeries(0).map((v) => +v.toFixed(3))).toEqual([0, 0.25, 0.1])
    expect(Array.from(pkg.envelope)).toEqual([0.25, Math.fround(0.05)])
  })
  it('rejects other files', () => {
    expect(() => new TwoDPackage(new ArrayBuffer(16))).toThrow(TwoDPackageError)
  })
})
