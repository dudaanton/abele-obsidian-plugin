import { binaryResponse } from './binaryResponse'

const CHUNK = 1024 * 1024
const binaryPath =
  /\/v1\/(?:blobs\/[a-f0-9]{64}|(?:scoped\/)?vaults\/[^/]+\/(?:grants\/[^/]+\/)?files\/[^/]+\/versions\/[^/]+)$/

/** Keep native base64 response strings bounded for immutable blob/version reads.
 * The caller still checks final size and SHA against its server-verified intent. */
export function rangedBinaryTransport(send: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    if (method.toUpperCase() !== 'GET' || !binaryPath.test(url.pathname) || headers.has('range'))
      return send(input, init)
    let output: Uint8Array | undefined
    let at = 0
    let responseHeaders: Headers | undefined
    for (;;) {
      headers.set('range', `bytes=${at}-${at + CHUNK - 1}`)
      const response = await send(input, { ...init, headers })
      // Older servers may ignore Range. Preserve their one-shot behavior; never
      // concatenate a whole response onto a partially received file.
      if (at === 0 && response.status !== 206) return response
      if (response.status !== 206) throw new Error('Binary range transfer interrupted')
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      if (!range) throw new Error('Missing binary content range')
      const start = Number(range[1]),
        end = Number(range[2]),
        total = Number(range[3])
      if (
        !Number.isSafeInteger(total) ||
        total <= 0 ||
        start !== at ||
        end !== Math.min(at + CHUNK, total) - 1 ||
        (output && output.length !== total)
      )
        throw new Error('Invalid binary content range')
      responseHeaders ??= new Headers(response.headers)
      const chunk = new Uint8Array(await response.arrayBuffer())
      if (chunk.length !== end - start + 1) throw new Error('Truncated binary range')
      if (at === 0 && chunk.length === total) {
        responseHeaders.delete('content-range')
        return binaryResponse(chunk, { status: 200, headers: responseHeaders })
      }
      output ??= new Uint8Array(total)
      output.set(chunk, at)
      at = end + 1
      if (at === total) {
        responseHeaders.delete('content-range')
        responseHeaders.set('content-length', String(total))
        return binaryResponse(output, { status: 200, headers: responseHeaders })
      }
    }
  }
}
