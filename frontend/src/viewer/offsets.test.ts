import { describe, expect, it } from 'vitest'
import { networkPayload, parseInp } from './inp'

const inp = (mode: string, a: string, b: string) => `[OPTIONS]
FLOW_UNITS CFS
LINK_OFFSETS ${mode}

[JUNCTIONS]
J1  100  10  0 0 0
J2  95   10  0 0 0

[CONDUITS]
C1  J1  J2  100  0.013  ${a}  ${b}  0  0

[XSECTIONS]
C1  CIRCULAR  1  0 0 0 1

[COORDINATES]
J1  0  0
J2  100  0
`

describe('link offsets', () => {
  it('turns elevation offsets into heights above the inverts', () => {
    const m = parseInp(inp('ELEVATION', '102', '96'))
    expect(m.offsetsAreElevations()).toBe(true)
    expect(m.offsetDepths(m.allLinks().get('C1')!)).toEqual({ in_offset_depth: 2, out_offset_depth: 1 })
    const net = networkPayload(m, 'EPSG:2272') as { geojson: { features: { properties: Record<string, unknown> }[] } }
    const c1 = net.geojson.features.find((f) => f.properties.id === 'C1')!
    expect(c1.properties.in_offset_depth).toBe(2)
  })
  it('keeps depth offsets as they are', () => {
    const m = parseInp(inp('DEPTH', '2', '1'))
    expect(m.offsetDepths(m.allLinks().get('C1')!)).toEqual({ in_offset_depth: 2, out_offset_depth: 1 })
  })
})
