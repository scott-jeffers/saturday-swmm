/** A small OpenStreetMap map with a pin; click to move it. */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export function LocationPicker({
  lat,
  lon,
  onChange,
}: {
  lat: number
  lon: number
  onChange: (lat: number, lon: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap',
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#dbe4ee' } },
          { id: 'osm', type: 'raster', source: 'osm' },
        ],
      },
      center: [lon, lat],
      zoom: 5,
      attributionControl: {},
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const marker = new maplibregl.Marker({ color: '#0ea5e9' })
      .setLngLat([lon, lat])
      .addTo(map)
    markerRef.current = marker
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat)
      onChangeRef.current(e.lngLat.lat, e.lngLat.lng)
    })
    mapRef.current = map
    return () => {
      marker.remove()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    markerRef.current?.setLngLat([lon, lat])
  }, [lat, lon])

  return (
    <div
      ref={containerRef}
      className="h-56 w-full overflow-hidden rounded-xl border border-border"
    />
  )
}
