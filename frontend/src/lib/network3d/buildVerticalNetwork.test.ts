import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import {
  buildVerticalNetwork,
  computeLinkInverts,
  invertAtFraction,
  polylineLengthFractions,
  rimElevation,
  suggestVerticalExaggeration,
} from './buildVerticalNetwork'
import {
  clampWaterHeight,
  junctionWaterHeight,
  linkFillRatio,
  waterSurfaceElevation,
} from './updateWaterLevels'

describe('computeLinkInverts', () => {
  it('adds offsets to from/to node elevations', () => {
    expect(computeLinkInverts(100, 98, 0.5, 0.2)).toEqual({
      invertUs: 100.5,
      invertDs: 98.2,
    })
  })
})

describe('rimElevation', () => {
  it('uses elevation + max_depth when present', () => {
    expect(rimElevation(10, 3)).toBe(13)
  })
  it('falls back to a default shaft depth when max_depth is 0', () => {
    expect(rimElevation(10, 0)).toBe(11.5)
  })
})

describe('polylineLengthFractions', () => {
  it('returns 0 and 1 for a two-point segment', () => {
    const { fractions, total } = polylineLengthFractions([
      [0, 0],
      [3, 4],
    ])
    expect(total).toBe(5)
    expect(fractions).toEqual([0, 1])
  })

  it('accumulates mid vertices by plan length', () => {
    const { fractions } = polylineLengthFractions([
      [0, 0],
      [1, 0],
      [1, 1],
    ])
    expect(fractions[0]).toBe(0)
    expect(fractions[1]).toBeCloseTo(0.5)
    expect(fractions[2]).toBe(1)
  })
})

describe('buildVerticalNetwork', () => {
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          object_type: 'node',
          id: 'J1',
          node_kind: 'junction',
          elevation: 100,
          max_depth: 2,
        },
        geometry: { type: 'Point', coordinates: [10, 50] },
      },
      {
        type: 'Feature',
        properties: {
          object_type: 'node',
          id: 'J2',
          node_kind: 'junction',
          elevation: 99,
          max_depth: 2,
        },
        geometry: { type: 'Point', coordinates: [10.01, 50] },
      },
      {
        type: 'Feature',
        properties: {
          object_type: 'link',
          id: 'C1',
          link_kind: 'conduit',
          from_node: 'J1',
          to_node: 'J2',
          in_offset: 0.1,
          out_offset: 0.2,
          diameter: 0.6,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [10, 50],
            [10.005, 50.001],
            [10.01, 50],
          ],
        },
      },
      {
        type: 'Feature',
        properties: {
          object_type: 'link',
          id: 'P1',
          link_kind: 'pump',
          from_node: 'J1',
          to_node: 'J2',
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [10, 50],
            [10.01, 50],
          ],
        },
      },
    ],
  }

  it('builds nodes with rim and conduit inverts; skips pumps', () => {
    const net = buildVerticalNetwork(fc)
    expect(net.nodes).toHaveLength(2)
    expect(net.nodeById.get('J1')?.rim).toBe(102)
    expect(net.conduitCount).toBe(1)
    expect(net.links).toHaveLength(1)
    const L = net.links[0]!
    expect(L.id).toBe('C1')
    expect(L.invertUs).toBeCloseTo(100.1)
    expect(L.invertDs).toBeCloseTo(99.2)
    expect(L.diameter).toBe(0.6)
    expect(L.crownUs).toBeCloseTo(100.7)
    expect(L.coordinates).toHaveLength(3)
  })

  it('interpolates invert along the link', () => {
    const net = buildVerticalNetwork(fc)
    const L = net.links[0]!
    expect(invertAtFraction(L, 0)).toBeCloseTo(L.invertUs)
    expect(invertAtFraction(L, 1)).toBeCloseTo(L.invertDs)
    expect(invertAtFraction(L, 0.5)).toBeCloseTo((L.invertUs + L.invertDs) / 2)
  })

  it('suggests a finite vertical exaggeration', () => {
    const net = buildVerticalNetwork(fc)
    const ve = suggestVerticalExaggeration(net)
    expect(ve).toBeGreaterThanOrEqual(8)
    expect(ve).toBeLessThanOrEqual(40)
  })
})

describe('water height helpers', () => {
  it('clamps dry / partial / surcharged depths', () => {
    expect(clampWaterHeight(-1, 3)).toBe(0)
    expect(clampWaterHeight(1.5, 3)).toBe(1.5)
    expect(clampWaterHeight(5, 3)).toBe(3)
  })

  it('computes junction water from depth above invert', () => {
    expect(junctionWaterHeight(100, 102, 1.2)).toBeCloseTo(1.2)
    expect(junctionWaterHeight(100, 102, 5)).toBeCloseTo(2)
    expect(junctionWaterHeight(100, 102, 0)).toBe(0)
  })

  it('maps water surface and link fill ratio', () => {
    expect(waterSurfaceElevation(100, 1.5)).toBe(101.5)
    expect(linkFillRatio(0, 0.6)).toBe(0)
    expect(linkFillRatio(0.3, 0.6)).toBeCloseTo(0.5)
    expect(linkFillRatio(1.0, 0.6)).toBe(1)
  })
})
