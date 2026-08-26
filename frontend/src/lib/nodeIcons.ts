/** Map node icons: Circle / Triangle / Square with baked fill + black perimeter */

export type NodeIconKind = 'junction' | 'outfall' | 'storage'

const ICON_SIZE = 64
/** Visible circle radius inside the 64px icon bitmap (see shapePath). */
export const NODE_ICON_SHAPE_RADIUS = ICON_SIZE * 0.32
/** Black perimeter stroke width in the icon bitmap. */
export const NODE_ICON_STROKE_PX = 5

export const NODE_FILL: Record<NodeIconKind, string> = {
  junction: '#2563eb',
  outfall: '#ef4444',
  /** Amber stands out against blue junctions and green landcover */
  storage: '#d97706',
}

function shapePath(
  ctx: CanvasRenderingContext2D,
  kind: NodeIconKind,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.beginPath()
  if (kind === 'junction') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  } else if (kind === 'outfall') {
    ctx.moveTo(cx, cy - r)
    ctx.lineTo(cx + r * 0.95, cy + r * 0.72)
    ctx.lineTo(cx - r * 0.95, cy + r * 0.72)
    ctx.closePath()
  } else {
    // Axis-aligned square — clearly distinct from circular junctions
    const half = r * 0.92
    ctx.rect(cx - half, cy - half, half * 2, half * 2)
  }
}

export function buildNodeIconImageData(
  kind: NodeIconKind,
  fill = NODE_FILL[kind],
): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
  const cx = ICON_SIZE / 2
  const cy = ICON_SIZE / 2
  const r = ICON_SIZE * 0.32

  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  ctx.miterLimit = 2

  // Fill
  ctx.fillStyle = fill
  shapePath(ctx, kind, cx, cy, r)
  ctx.fill()

  // Perimeter — thicker on storage so squares read at overview zoom
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = kind === 'storage' ? 7 : 5
  shapePath(ctx, kind, cx, cy, r)
  ctx.stroke()

  // Light inner highlight on storage for extra definition
  if (kind === 'storage') {
    const half = r * 0.92 - 4
    if (half > 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.rect(cx - half, cy - half, half * 2, half * 2)
      ctx.stroke()
    }
  }

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE)
}

/** Bumped ids so sessions drop old hexagon / SDF assets */
export const NODE_ICON_IDS: Record<NodeIconKind, string> = {
  junction: 'swmm-node-junction-v4',
  outfall: 'swmm-node-outfall-v4',
  storage: 'swmm-node-storage-v4',
}

export function ensureNodeIcons(map: {
  hasImage: (id: string) => boolean
  addImage: (
    id: string,
    image: { width: number; height: number; data: Uint8Array },
    options?: { sdf?: boolean },
  ) => void
  removeImage?: (id: string) => void
}) {
  ;(Object.keys(NODE_ICON_IDS) as NodeIconKind[]).forEach((kind) => {
    const id = NODE_ICON_IDS[kind]
    if (map.hasImage(id)) return
    const imageData = buildNodeIconImageData(kind)
    map.addImage(
      id,
      {
        width: imageData.width,
        height: imageData.height,
        data: new Uint8Array(imageData.data.buffer),
      },
      // Not SDF — colors + black perimeter are baked into the bitmap
      { sdf: false },
    )
  })
}
