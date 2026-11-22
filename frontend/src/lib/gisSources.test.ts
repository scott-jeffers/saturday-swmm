import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { fieldNames, guessWebKind, isArcgisFeatureLayer, layerNameFromUrl, lonLatBounds, tileTemplate, toLonLat } from './gisSources'

describe('gisSources', () => {
  it('builds tile templates for each kind of web layer', () => {
    expect(tileTemplate({ kind: 'xyz', url: 'https://t.example.com/{z}/{x}/{y}.png' })).toBe('https://t.example.com/{z}/{x}/{y}.png')
    const wms = tileTemplate({ kind: 'wms', url: 'https://maps.example.com/wms?map=a&LAYERS=old', wms_layers: 'roads,parcels' })
    expect(wms).toContain('LAYERS=roads%2Cparcels')
    expect(wms).toContain('map=a')
    expect(wms).toContain('BBOX={bbox-epsg-3857}')
    expect(wms).not.toContain('LAYERS=old')
    expect(tileTemplate({ kind: 'arcgis', url: 'https://x.com/arcgis/rest/services/A/MapServer/' })).toMatch(/MapServer\/export\?bbox=\{bbox-epsg-3857\}/)
    expect(tileTemplate({ kind: 'arcgis', url: 'https://x.com/arcgis/rest/services/A/ImageServer' })).toContain('/exportImage?')
  })

  it('recognises addresses', () => {
    expect(guessWebKind('https://a/{z}/{x}/{y}.png')).toBe('xyz')
    expect(guessWebKind('https://a/geoserver/wms?service=WMS')).toBe('wms')
    expect(guessWebKind('https://a/arcgis/rest/services/B/MapServer')).toBe('arcgis')
    expect(isArcgisFeatureLayer('https://a/rest/services/B/FeatureServer/0')).toBe(true)
    expect(isArcgisFeatureLayer('https://a/rest/services/B/MapServer')).toBe(false)
    expect(layerNameFromUrl('https://a/arcgis/rest/services/PWD_PARCELS/FeatureServer/0')).toBe('PWD PARCELS')
  })

  it('reprojects GeoJSON that names a projected CRS, and falls back to the model CRS', async () => {
    const named = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2272' } },
      features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [2690000, 236000] } }],
    } as FeatureCollection
    const resolve = async () => '+proj=lcc +lat_0=39.3333333333333 +lon_0=-77.75 +lat_1=40.9666666666667 +lat_2=39.9333333333333 +x_0=600000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs'
    const out = (await toLonLat(named, null, resolve)).fc
    const [lon, lat] = (out.features[0]!.geometry as { coordinates: number[] }).coordinates
    expect(lon).toBeGreaterThan(-75.3)
    expect(lon).toBeLessThan(-75.0)
    expect(lat).toBeGreaterThan(39.8)
    expect(lat).toBeLessThan(40.1)

    const bare = { ...named, crs: undefined } as unknown as FeatureCollection
    await expect(toLonLat(bare)).rejects.toThrow(/longitude/)
    expect((await toLonLat(bare, 'EPSG:2272', resolve)).note).toMatch(/EPSG:2272/)

    const wgs = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { b: 2 }, geometry: { type: 'Point', coordinates: [-75.19, 39.95] } }] } as FeatureCollection
    expect((await toLonLat(wgs)).fc).toBe(wgs)
    expect(fieldNames({ ...wgs, features: [...wgs.features, ...out.features] })).toEqual(['b', 'a'])
    expect(lonLatBounds(wgs)).toEqual({ west: -75.19, south: 39.95, east: -75.19, north: 39.95 })
  })
})
