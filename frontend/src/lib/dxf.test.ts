import { describe, expect, it } from 'vitest'
import { parseDxf } from './dxf'

const dxf = (body: string) => ['0', 'SECTION', '2', 'ENTITIES', ...body.trim().split('\n').map((l) => l.trim()), '0', 'ENDSEC', '0', 'EOF'].join('\n')

describe('parseDxf', () => {
  it('reads lines, closed polylines, text and old-style polylines, by layer', () => {
    const { fc, skipped } = parseDxf(
      dxf(`
0
LINE
8
CURB
10
100
20
200
11
150
21
200
0
LWPOLYLINE
8
BLDG
90
3
70
1
10
0
20
0
10
10
20
0
10
10
20
10
0
TEXT
8
ANNO
10
5
20
5
1
MH-12
0
POLYLINE
8
ROW
70
0
0
VERTEX
10
1
20
2
0
VERTEX
10
3
20
4
0
SEQEND
0
INSERT
8
SYMB`),
    )
    expect(fc.features.map((f) => f.properties?.layer)).toEqual(['CURB', 'BLDG', 'ANNO', 'ROW'])
    expect(fc.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[100, 200], [150, 200]] })
    const ring = (fc.features[1]!.geometry as { coordinates: number[][] }).coordinates
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(fc.features[2]!.properties?.text).toBe('MH-12')
    expect((fc.features[3]!.geometry as { coordinates: number[][] }).coordinates).toEqual([[1, 2], [3, 4]])
    expect(skipped).toEqual({ INSERT: 1 })
  })
  it('explains files it cannot read', () => {
    expect(() => parseDxf('AutoCAD Binary DXF\r\n')).toThrow(/ASCII DXF/)
    expect(() => parseDxf('hello')).toThrow(/DXF/)
  })
})
