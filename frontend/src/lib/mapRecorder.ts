/** Record the map canvas (WebGL) to a WebM video with the browser's MediaRecorder. */

export type MapRecording = { stop: () => Promise<Blob | null> }

export function recordMap(root: ParentNode = document): MapRecording | null {
  const canvas = root.querySelector<HTMLCanvasElement>('.network-map-canvas canvas')
  if (!canvas || typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null
  const stream = canvas.captureStream(30)
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) return null
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(250)
  return {
    stop: () =>
      new Promise((resolve) => {
        if (rec.state === 'inactive') return resolve(chunks.length ? new Blob(chunks, { type }) : null)
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null)
        }
        rec.stop()
      }),
  }
}

/**
 * Record an SVG drawing (the long profile) to WebM: the SVG is redrawn onto a
 * canvas several times a second while it animates, and the canvas is recorded.
 */
export function recordSvg(svg: SVGSVGElement): MapRecording | null {
  if (typeof MediaRecorder === 'undefined') return null
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, svg.clientWidth * scale)
  canvas.height = Math.max(1, svg.clientHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx || !canvas.captureStream) return null
  ctx.scale(scale, scale)
  let stopped = false
  let busy = false
  const frame = () => {
    if (stopped || busy) return
    busy = true
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      busy = false
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      busy = false
    }
    img.src = url
  }
  frame()
  const timer = window.setInterval(frame, 66)
  const stream = canvas.captureStream(15)
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
  if (!type) return null
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.start(250)
  return {
    stop: () =>
      new Promise((resolve) => {
        stopped = true
        window.clearInterval(timer)
        if (rec.state === 'inactive') return resolve(chunks.length ? new Blob(chunks, { type }) : null)
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null)
        }
        rec.stop()
      }),
  }
}
