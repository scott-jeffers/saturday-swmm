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
