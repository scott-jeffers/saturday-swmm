/**
 * The colour each kind of element has on the map. One list, used by the map
 * toolbar, the Elements tabs and the Graphs tree, so they always agree.
 */
export const ELEMENT_COLOR = {
  junction: '#2563eb',
  outfall: '#ef4444',
  storage: '#d97706',
  divider: '#0891b2',
  conduit: '#1d4ed8',
  pump: '#db2777',
  orifice: '#7c3aed',
  weir: '#ca8a04',
  outlet: '#ea580c',
  subcatchment: '#16a34a',
  mesh: '#0e8fb5',
  timeseries: '#64748b',
} as const

export type ElementColorKey = keyof typeof ELEMENT_COLOR
