/**
 * 1D network layer helpers (nodes / links / subcatchments).
 * Paint/setup remains in NetworkMap.ensureLayers; this module owns z-order helpers
 * shared with the 2D custom mesh path.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { MESH2D_CUSTOM_LAYER_ID } from './Mesh2DCustomLayer'
import { NETWORK3D_CUSTOM_LAYER_ID } from './Network3DCustomLayer'

/** Keep 2D flood fill above subcatchments so depth colors stay visible. */
export function pinMeshLayersAboveSubs(map: MapLibreMap): void {
  const anchor = map.getLayer('links')
    ? 'links'
    : map.getLayer('subs-fill')
      ? 'subs-fill'
      : undefined
  if (!anchor) return
  for (const id of [MESH2D_CUSTOM_LAYER_ID, 'mesh-2d-fill', 'mesh-2d-outline']) {
    if (map.getLayer(id)) map.moveLayer(id, anchor)
  }
}

/** Keep 3D network under selection / profile overlays, above base links when present. */
export function pinNetwork3DLayer(map: MapLibreMap): void {
  if (!map.getLayer(NETWORK3D_CUSTOM_LAYER_ID)) return
  // Under the ground: the pipes hang below the map, so the (see-through)
  // subcatchment fills are drawn over them, not the other way round.
  const before = map.getLayer('subs-fill')
    ? 'subs-fill'
    : map.getLayer('links-selected')
      ? 'links-selected'
      : map.getLayer('nodes-selected')
        ? 'nodes-selected'
        : undefined
  if (before) map.moveLayer(NETWORK3D_CUSTOM_LAYER_ID, before)
}
