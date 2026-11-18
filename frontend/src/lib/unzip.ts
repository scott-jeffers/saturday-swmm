/** Minimal .zip reader (stored and deflate entries) using the browser's DecompressionStream. */

export async function unzip(data: ArrayBuffer): Promise<{ name: string; data: Uint8Array }[]> {
  const v = new DataView(data)
  const u8 = new Uint8Array(data)
  // End of central directory: last 22..65557 bytes.
  let eocd = -1
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: { name: string; data: Uint8Array }[] = []
  const dec = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip directory')
    const method = v.getUint16(p + 10, true)
    const csize = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const lNameLen = v.getUint16(local + 26, true)
    const lExtraLen = v.getUint16(local + 28, true)
    const start = local + 30 + lNameLen + lExtraLen
    const raw = u8.subarray(start, start + csize)
    if (method === 0) out.push({ name, data: raw.slice() })
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      out.push({ name, data: new Uint8Array(await new Response(stream).arrayBuffer()) })
    } else throw new Error(`Unsupported compression in ${name}`)
  }
  return out
}
