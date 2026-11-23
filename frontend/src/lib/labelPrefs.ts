import { usePref } from './prefs'
import { labelPrefKey, type LabelKind } from './labelText'

/** What each element kind's map labels say (Layers → On the map). Every kind starts on its ID. */
export function useLabelChoices(): Record<LabelKind, string> {
  return {
    junction: usePref(labelPrefKey('junction'), 'id'),
    outfall: usePref(labelPrefKey('outfall'), 'id'),
    storage: usePref(labelPrefKey('storage'), 'id'),
    conduit: usePref(labelPrefKey('conduit'), 'id'),
    pump: usePref(labelPrefKey('pump'), 'id'),
    orifice: usePref(labelPrefKey('orifice'), 'id'),
    weir: usePref(labelPrefKey('weir'), 'id'),
    outlet: usePref(labelPrefKey('outlet'), 'id'),
    subcatchment: usePref(labelPrefKey('subcatchment'), 'id'),
  }
}
