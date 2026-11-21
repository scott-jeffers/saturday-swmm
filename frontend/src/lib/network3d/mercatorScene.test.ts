import { MercatorCoordinate } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { buildModelTransformMatrix, createModelOrigin, toLocalMeters } from './mercatorScene'

describe('3D network placement', () => {
  it('puts every point where the map draws it (no mirroring)', () => {
    const origin = createModelOrigin(-75.17, 39.95)
    const m = buildModelTransformMatrix(origin)
    for (const [lng, lat] of [
      [-75.171, 39.951], // north-west of the origin
      [-75.168, 39.948], // south-east
      [-75.17, 39.953], // due north
    ]) {
      const local = toLocalMeters(lng, lat, 0, origin)
      const merc = local.clone().applyMatrix4(m)
      const want = MercatorCoordinate.fromLngLat({ lng, lat }, 0)
      expect(merc.x).toBeCloseTo(want.x, 12)
      expect(merc.y).toBeCloseTo(want.y, 12)
      expect(merc.z).toBeCloseTo(0, 12)
    }
  })

  it('raises positive elevations above the map', () => {
    const origin = createModelOrigin(-75.17, 39.95)
    const merc = toLocalMeters(-75.17, 39.95, 10, origin).applyMatrix4(buildModelTransformMatrix(origin))
    expect(merc.z).toBeCloseTo(10 * origin.meterScale, 12)
  })
})
