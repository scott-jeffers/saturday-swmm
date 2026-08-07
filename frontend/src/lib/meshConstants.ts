/** Above this triangle count, use compact arrays + custom WebGL (not GeoJSON fill). */
export const MESH_LARGE_THRESHOLD = 20_000

/** Max cached binary 2D snapshots in the client LRU (~12 MB at 155k cells). */
export const MESH_SNAPSHOT_CACHE_SIZE = 20

/** Below this map zoom, large-mesh wireframe is skipped (domain fill only). */
export const MESH_WIREFRAME_MIN_ZOOM = 14
