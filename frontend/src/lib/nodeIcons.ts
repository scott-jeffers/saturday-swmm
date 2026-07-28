/** Map node icons: Circle / Triangle / Hexagon with baked fill + black perimeter */

export type NodeIconKind = 'junction' | 'outfall' | 'storage'

const ICON_SIZE = 64

export const NODE_FILL: Record<NodeIconKind, string> = {
  junction: '#2563eb',
  outfall: '#ef4444',
  storage: '#10b981',
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
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
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

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Fill
  ctx.fillStyle = fill
  shapePath(ctx, kind, cx, cy, r)
  ctx.fill()

  // Perimeter border on the shape (not a square backdrop)
  ctx.strokeStyle = '#000000'
  ctx.lineWidth = 5
  shapePath(ctx, kind, cx, cy, r)
  ctx.stroke()

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE)
}

/** Bumped ids so sessions drop old SDF assets that rendered as black squares */
export const NODE_ICON_IDS: Record<NodeIconKind, string> = {
  junction: 'swmm-node-junction-v3',
  outfall: 'swmm-node-outfall-v3',
  storage: 'swmm-node-storage-v3',
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
