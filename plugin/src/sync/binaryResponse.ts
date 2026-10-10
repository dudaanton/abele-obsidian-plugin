/** A native body already in memory: transfer it instead of Response's two full-size copies.
 * The stream owns the bytes; consuming it preserves standard bodyUsed/one-shot behavior. */
export function binaryResponse(bytes: Uint8Array, init: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      bytes = new Uint8Array(0)
      controller.close()
    },
  })
  const response = new Response(stream, init)
  let consumed = false
  // eslint-disable-next-line @typescript-eslint/unbound-method -- getter is invoked with this response below
  const bodyUsed = Object.getOwnPropertyDescriptor(Response.prototype, 'bodyUsed')?.get
  Object.defineProperty(response, 'bodyUsed', { get: () => consumed || !!bodyUsed?.call(response) })
  response.arrayBuffer = async () => {
    // clone() tees the body and replaces this response's stream. The original stream
    // is then locked by the tee, while this response's branch remains unread.
    const body = response.body
    if (response.bodyUsed || body.locked) throw new TypeError('Response body already consumed')
    const reader = body.getReader()
    consumed = true
    try {
      const { value } = await reader.read()
      if (!value) return new ArrayBuffer(0)
      const { buffer, byteOffset, byteLength } = value
      return byteOffset === 0 && byteLength === buffer.byteLength && buffer instanceof ArrayBuffer
        ? buffer
        : value.slice().buffer
    } finally {
      reader.releaseLock()
    }
  }
  response.text = async () => new TextDecoder().decode(await response.arrayBuffer())
  response.json = async () => JSON.parse(await response.text())
  return response
}
