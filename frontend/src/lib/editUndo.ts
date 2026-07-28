import type {
  ModelObjectResponse,
  NodeCreateRequest,
  LinkCreateRequest,
  SubcatchmentCreateRequest,
} from '../api/client'

export type UndoAction =
  | { kind: 'delete-created'; object_type: 'node' | 'link' | 'subcatchment'; id: string }
  | { kind: 'restore-move'; id: string; x: number; y: number }
  | {
      kind: 'recreate'
      object_type: 'node' | 'link' | 'subcatchment'
      node?: NodeCreateRequest
      link?: LinkCreateRequest
      sub?: SubcatchmentCreateRequest
    }

const MAX = 40

export function pushUndo(stack: UndoAction[], action: UndoAction): UndoAction[] {
  return [...stack, action].slice(-MAX)
}

export function snapshotForRecreate(obj: ModelObjectResponse): UndoAction | null {
  const attrs = obj.attributes
  if (obj.object_type === 'node') {
    const geom = obj.geometry
    if (!geom || geom.type !== 'Point') return null
    const [x, y] = geom.coordinates as number[]
    const kind = String(attrs.node_kind ?? 'junction')
    if (kind !== 'junction' && kind !== 'outfall' && kind !== 'storage') return null
    return {
      kind: 'recreate',
      object_type: 'node',
      node: {
        id: obj.id,
        node_kind: kind,
        x,
        y,
        elevation: Number(attrs.elevation ?? 0),
        max_depth: Number(attrs.max_depth ?? 0),
      },
    }
  }
  if (obj.object_type === 'link') {
    return {
      kind: 'recreate',
      object_type: 'link',
      link: {
        id: obj.id,
        link_kind:
          attrs.link_kind === 'pump' ||
          attrs.link_kind === 'orifice' ||
          attrs.link_kind === 'weir' ||
          attrs.link_kind === 'outlet' ||
          attrs.link_kind === 'conduit'
            ? attrs.link_kind
            : 'conduit',
        from_node: String(attrs.from_node ?? ''),
        to_node: String(attrs.to_node ?? ''),
        length: attrs.length != null ? Number(attrs.length) : undefined,
        roughness: attrs.roughness != null ? Number(attrs.roughness) : undefined,
        diameter: attrs.diameter != null ? Number(attrs.diameter) : undefined,
      },
    }
  }
  if (obj.object_type === 'subcatchment') {
    const geom = obj.geometry
    if (!geom || geom.type !== 'Polygon') return null
    const ring = (geom.coordinates[0] as number[][]).map(([x, y]) => [x, y])
    // Drop closing duplicate if present
    if (
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
    ) {
      ring.pop()
    }
    return {
      kind: 'recreate',
      object_type: 'subcatchment',
      sub: {
        id: obj.id,
        outlet: String(attrs.outlet ?? ''),
        raingage: attrs.raingage != null ? String(attrs.raingage) : undefined,
        area: attrs.area != null ? Number(attrs.area) : undefined,
        pct_imperv: attrs.pct_imperv != null ? Number(attrs.pct_imperv) : undefined,
        width: attrs.width != null ? Number(attrs.width) : undefined,
        slope: attrs.slope != null ? Number(attrs.slope) : undefined,
        polygon: ring,
      },
    }
  }
  return null
}
