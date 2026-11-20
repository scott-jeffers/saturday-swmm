/**
 * How each kind of element looks on the map: size, opacity and colour.
 * Kept per project in this browser. Size and opacity are multipliers on the
 * built-in look (1 = default), so "reset" is just deleting the entry.
 */
import { useCallback, useMemo } from 'react'
import { ELEMENT_COLOR } from './elementColors'
import { getPref, setPref, usePref } from './prefs'

export const STYLE_KEYS = [
  'junction',
  'outfall',
  'storage',
  'conduit',
  'pump',
  'orifice',
  'weir',
  'outlet',
  'subcatchment',
] as const
export type StyleKey = (typeof STYLE_KEYS)[number]

export type ElementStyle = { size?: number; opacity?: number; color?: string }
export type MapStyle = Partial<Record<StyleKey, ElementStyle>>

/** A short palette keeps the choice quick and the map legible. */
export const STYLE_SWATCHES = [
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#ef4444',
  '#db2777',
  '#7c3aed',
  '#475569',
  '#0f172a',
]

export function styleColor(style: MapStyle, key: StyleKey): string {
  return style[key]?.color ?? ELEMENT_COLOR[key]
}
export const styleSize = (style: MapStyle, key: StyleKey) => style[key]?.size ?? 1
export const styleOpacity = (style: MapStyle, key: StyleKey) => style[key]?.opacity ?? 1

export function isStyled(s: ElementStyle | undefined): boolean {
  return !!s && (s.size != null || s.opacity != null || s.color != null)
}

function parse(raw: string): MapStyle {
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' ? (v as MapStyle) : {}
  } catch {
    return {}
  }
}

const prefKey = (project: string | null | undefined) => `map-style:${project || '_'}`

export function useMapStyle(project: string | null | undefined) {
  const raw = usePref(prefKey(project), '{}')
  const style = useMemo(() => parse(raw), [raw])
  const update = useCallback(
    (key: StyleKey, patch: ElementStyle | null) => {
      const cur = parse(getPref(prefKey(project), '{}'))
      if (patch === null) delete cur[key]
      else {
        const next = { ...cur[key], ...patch }
        for (const k of Object.keys(next) as (keyof ElementStyle)[]) if (next[k] == null) delete next[k]
        if (isStyled(next)) cur[key] = next
        else delete cur[key]
      }
      setPref(prefKey(project), JSON.stringify(cur))
    },
    [project],
  )
  return { style, update }
}
