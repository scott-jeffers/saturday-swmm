/**
 * 1D network layer helpers (nodes / links / subcatchments).
 * Paint/setup remains in NetworkMap.ensureLayers; this module owns z-order helpers
 * shared with the 2D custom mesh path.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { MESH2D_CUSTOM_LAYER_ID } from './Mesh2DCustomLayer'

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
