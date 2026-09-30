// Bundled as source text, never evaluated during plugin startup. Terminating this worker
// after conversion also releases the decoder's own worker and its large heap.
import { heicTo } from 'heic-to/next'

self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const png = await heicTo({ blob: event.data, type: 'image/png' })
    self.postMessage({ png })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
