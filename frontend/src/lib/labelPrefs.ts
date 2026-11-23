import { getPref, usePref } from './prefs'
import { LABEL_OPTIONS, labelPrefKey, type LabelKind } from './labelText'

const NODE_KINDS: LabelKind[] = ['junction', 'outfall', 'storage']

/** The saved choice before labels were per kind ("Nodes show" / "Links show"), if it fits this kind. */
function legacy(kind: LabelKind): string {
  if (kind === 'subcatchment') return 'id'
  const old = getPref(NODE_KINDS.includes(kind) ? 'map-label-node' : 'map-label-link', 'id')
  return LABEL_OPTIONS[kind].some(([k]) => k === old) ? old : 'id'
}

/** What each element kind's map labels say (Layers → On the map). */
export function useLabelChoices(): Record<LabelKind, string> {
  return {
    junction: usePref(labelPrefKey('junction'), legacy('junction')),
    outfall: usePref(labelPrefKey('outfall'), legacy('outfall')),
    storage: usePref(labelPrefKey('storage'), legacy('storage')),
    conduit: usePref(labelPrefKey('conduit'), legacy('conduit')),
    pump: usePref(labelPrefKey('pump'), legacy('pump')),
    orifice: usePref(labelPrefKey('orifice'), legacy('orifice')),
    weir: usePref(labelPrefKey('weir'), legacy('weir')),
    outlet: usePref(labelPrefKey('outlet'), legacy('outlet')),
    subcatchment: usePref(labelPrefKey('subcatchment'), 'id'),
  }
}
