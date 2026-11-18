/** Client-side exports: CSV tables and series, GeoJSON network with peak results. */

import type { FeatureCollection } from 'geojson'
import { api, type ProjectInfo, type TimeSeriesResponse } from '../api/client'
import { ensureCrs, reprojectGeoJson } from './projection'

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export'
}

export function seriesCsv(series: { name: string; s: TimeSeriesResponse }[]): string {
  const base = series[0]?.s
  if (!base) return ''
  const header = ['Time', 'Hours', ...series.map((x) => `${x.name} (${x.s.variable_label ?? x.s.variable}${x.s.unit ? `, ${x.s.unit}` : ''})`)]
  const rows = base.values.map((_, i) => [
    base.times?.[i] ?? '',
    (base.times_sec[i] / 3600).toFixed(4),
    ...series.map((x) => x.s.values[i] ?? ''),
  ])
  return toCsv(header, rows)
}

/** The network as WGS84 GeoJSON, with peak depth / flow / runoff when results exist. */
export async function exportNetworkGeoJson(project: ProjectInfo) {
  const net = await api.getNetwork()
  ensureCrs(net.crs || project.crs || 'EPSG:4326', project.crs_proj4)
  const fc: FeatureCollection = reprojectGeoJson(net.geojson, net.crs)
  try {
    const env = await api.getOutEnvelope()
    const node = new Map(env.node_ids.map((id, i) => [id, env.node_depths[i]]))
    const link = new Map(env.link_ids.map((id, i) => [id, env.link_flows[i]]))
    const sub = new Map((env.subcatchment_ids ?? []).map((id, i) => [id, env.subcatchment_runoffs?.[i]]))
    for (const f of fc.features) {
      const p = (f.properties ??= {})
      const id = String(p.id)
      if (p.object_type === 'node' && node.has(id)) p.peak_depth = node.get(id)
      if (p.object_type === 'link' && link.has(id)) p.peak_flow = link.get(id)
      if (p.object_type === 'subcatchment' && sub.has(id)) p.peak_runoff = sub.get(id)
    }
  } catch {
    /* no results yet: geometry and attributes only */
  }
  const name = safeName(project.inp_name.replace(/\.inp$/i, '') ?? 'network')
  downloadText(`${name}.geojson`, JSON.stringify(fc), 'application/geo+json')
}
