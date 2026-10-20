import { MAX_CHUNK_BYTES, type ChunkSource } from '@abele/sync-sdk/core'

/** The Blob slice surface used by the format engines, backed by bounded disk reads. */
export function sourceFile(source: ChunkSource) {
  const part = (start = 0, end = source.size) => {
    const from = Math.max(0, start < 0 ? source.size + start : Math.min(start, source.size))
    const to = Math.max(from, end < 0 ? source.size + end : Math.min(end, source.size))
    return {
      size: to - from,
      async arrayBuffer() {
        const data = new Uint8Array(to - from)
        for (let at = from; at < to; at += MAX_CHUNK_BYTES)
          data.set(await source.read(at, Math.min(MAX_CHUNK_BYTES, to - at)), at - from)
        await source.assertUnchanged()
        return data.buffer
      },
    }
  }
  return {
    size: source.size,
    slice: part,
    async readText(encoding = 'utf-8') {
      const decoder = new TextDecoder(encoding),
        parts: string[] = []
      for (let at = 0; at < source.size; at += MAX_CHUNK_BYTES)
        parts.push(
          decoder.decode(await source.read(at, Math.min(MAX_CHUNK_BYTES, source.size - at)), {
            stream: true,
          })
        )
      parts.push(decoder.decode())
      await source.assertUnchanged()
      return parts.join('')
    },
  }
}
