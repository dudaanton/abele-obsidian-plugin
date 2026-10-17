import { Gunzip } from 'fflate'

/** Bound retained output and each inflate step before assembling an archive. */
export async function gunzipLimited(
  bytes: Uint8Array,
  limit: number,
  check: () => void
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const accept = (chunk: Uint8Array) => {
    check()
    total += chunk.byteLength
    if (total > limit) throw new Error('The unpacked repository exceeds the search size limit.')
    if (chunk.byteLength) chunks.push(chunk)
  }
  if (typeof DecompressionStream === 'function') {
    const reader = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
      .getReader()
    let finished = false
    try {
      while (true) {
        check()
        const next = await reader.read()
        if (next.done) {
          finished = true
          break
        }
        accept(next.value)
      }
    } finally {
      if (!finished) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } else {
    const inflate = new Gunzip(accept)
    // A small compressed input chunk bounds expansion between output callbacks.
    // Passing the entire compressed archive here would still permit a huge allocation.
    for (let offset = 0; offset < bytes.length; offset += 32) {
      check()
      inflate.push(bytes.subarray(offset, offset + 32), offset + 32 >= bytes.length)
      if (offset && offset % 2048 === 0)
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    }
    if (!bytes.length) inflate.push(bytes, true)
  }
  check()
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
