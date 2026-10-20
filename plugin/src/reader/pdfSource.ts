import type { ChunkSource } from '@abele/sync-sdk/core'
import { sourceFile } from './sourceFile'

/** Serialize library requests so overlapping requests cannot multiply bridge buffers. */
export function pdfSource(source: ChunkSource, lib: any) {
  const range = new lib.PDFDataRangeTransport(source.size, new Uint8Array(), false)
  let pending = Promise.resolve(),
    closed = false
  range.abort = () => {
    closed = true
    void source.close()
  }
  range.requestDataRange = (begin: number, end: number) => {
    pending = pending
      .then(async () => {
        if (
          !Number.isSafeInteger(begin) ||
          !Number.isSafeInteger(end) ||
          begin < 0 ||
          end > source.size ||
          end <= begin
        )
          throw new Error('Invalid PDF source range')
        if (closed) return
        // PDF.js consumes a complete requested range per callback. Disk/bridge reads inside
        // it remain bounded; the library owns the requested page/xref range buffer.
        const bytes = new Uint8Array(await sourceFile(source).slice(begin, end).arrayBuffer())
        if (!closed) range.onDataRange(begin, bytes)
      })
      .catch((error) => {
        console.debug('[abele-reader] PDF range failed', error)
        range.failed?.(error)
        range.abort()
      })
    return pending
  }
  return { range, length: source.size }
}
