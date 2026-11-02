import { binaryResponse } from './binaryResponse'
import { retryTransientOperation } from './transientOperation'

const CHUNK = 8 * 1024 * 1024
const binaryPath = /\/v2\/files\/[^/]+\/content$/

export interface BinaryRangeChunk {
  offset: number
  total: number
  bytes: Uint8Array
}

/** Strict streaming port: one request at a time; the consumer must await its
 * staging append before next(). Unlike the legacy fetch port it never assembles
 * an attachment-sized buffer and never accepts an ignored range. */
export async function* binaryRangeChunks(
  send: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
  chunkBytes = 1024 * 1024
): AsyncGenerator<BinaryRangeChunk> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1024 * 1024)
    throw new Error('Invalid binary chunk size')
  yield* readBinaryChunks(send, input, init, chunkBytes)
}

async function* readBinaryChunks(
  send: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  chunkBytes: number,
  first?: Response
): AsyncGenerator<BinaryRangeChunk> {
  const headers = new Headers(
    init.headers ?? (input instanceof Request ? input.headers : undefined)
  )
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined)
  let offset = 0,
    size: number | undefined
  for (;;) {
    signal?.throwIfAborted()
    headers.set('range', `bytes=${offset}-${offset + chunkBytes - 1}`)
    const response =
      first ??
      (await retryTransientOperation(
        () => send(input, { ...init, method: 'GET', headers, signal }),
        () => signal?.throwIfAborted()
      ))
    first = undefined
    signal?.throwIfAborted()
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Server ignored the binary range')
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
    if (!range) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Missing binary content range')
    }
    const start = Number(range[1]),
      end = Number(range[2]),
      total = Number(range[3])
    if (
      !Number.isSafeInteger(total) ||
      total <= 0 ||
      start !== offset ||
      end !== Math.min(offset + chunkBytes, total) - 1 ||
      (size !== undefined && size !== total)
    ) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Invalid binary content range')
    }
    size = total
    const bytes = new Uint8Array(end - start + 1),
      reader = response.body?.getReader()
    if (!reader) throw new Error('Missing binary range body')
    const cancel = () => {
      void reader.cancel().catch(() => {})
    }
    signal?.addEventListener('abort', cancel, { once: true })
    let received = 0
    try {
      for (;;) {
        signal?.throwIfAborted()
        const part = await reader.read()
        signal?.throwIfAborted()
        if (part.done) break
        if (received + part.value.byteLength > bytes.length)
          throw new Error('Oversized binary range')
        bytes.set(part.value, received)
        received += part.value.byteLength
      }
      if (received !== bytes.length) throw new Error('Truncated binary range')
    } finally {
      signal?.removeEventListener('abort', cancel)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    yield { offset, total, bytes }
    offset = end + 1
    if (offset === total) return
  }
}

/** Keep native base64 response strings bounded for immutable blob/version reads.
 * The caller still checks final size and SHA against its server-verified intent. */
export function rangedBinaryTransport(send: typeof fetch, chunkBytes = CHUNK): typeof fetch {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > CHUNK)
    throw new Error('Invalid binary chunk size')
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    if (method.toUpperCase() !== 'GET' || !binaryPath.test(url.pathname)) return send(input, init)
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (headers.has('range')) {
      const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get('range') ?? '')
      if (!range) return send(input, init)
      const start = Number(range[1]),
        end = Number(range[2])
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start)
        throw new Error('Invalid binary content range')
      if (end - start + 1 <= chunkBytes) return send(input, init)
      return boundedSuffixResponse(
        send,
        input,
        { ...init, headers, signal },
        start,
        end,
        chunkBytes
      )
    }
    headers.set('range', `bytes=0-${chunkBytes - 1}`)
    const first = await retryTransientOperation(
      () => send(input, { ...init, headers }),
      () => signal?.throwIfAborted()
    )
    signal?.throwIfAborted()
    // The legacy byte-array API preserves its existing non-range/error behaviour.
    // New streaming callers use binaryRangeChunks, which refuses ignored ranges.
    if (first.status !== 206) return first
    const responseHeaders = new Headers(first.headers)
    let output: Uint8Array | undefined
    for await (const { offset, total, bytes } of readBinaryChunks(
      send,
      input,
      { ...init, headers, signal },
      chunkBytes,
      first
    )) {
      if (offset === 0 && bytes.length === total) {
        output = bytes
        break
      }
      output ??= new Uint8Array(total) // Required by the current core Http.bytes contract.
      output.set(bytes, offset)
    }
    responseHeaders.delete('content-range')
    responseHeaders.set('content-length', String(output.length))
    return binaryResponse(output, { status: 200, headers: responseHeaders })
  }
}

/** A buffering native bridge cannot receive a whole suffix at once. Present a
 * continuous response to the SDK while issuing only consumer-demanded ranges. */
async function boundedSuffixResponse(
  send: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  start: number,
  end: number,
  chunkBytes: number
): Promise<Response> {
  const signal = init.signal
  let offset = start,
    cancelled = false
  const request = async () => {
    signal?.throwIfAborted()
    const headers = new Headers(init.headers)
    headers.set('range', `bytes=${offset}-${Math.min(end, offset + chunkBytes - 1)}`)
    return send(input, { ...init, headers })
  }
  let pending: Response | undefined = await request()
  if (pending.status !== 206) return pending
  const firstRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(pending.headers.get('content-range') ?? '')
  const total = firstRange ? Number(firstRange[3]) : NaN
  const validate = async (response: Response) => {
    if (
      !Number.isSafeInteger(total) ||
      total <= end ||
      response.status !== 206 ||
      response.headers.get('content-range') !==
        `bytes ${offset}-${Math.min(end, offset + chunkBytes - 1)}/${total}`
    ) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Invalid binary content range')
    }
  }
  await validate(pending)
  const responseHeaders = new Headers(pending.headers)
  responseHeaders.set('content-range', `bytes ${start}-${end}/${total}`)
  responseHeaders.set('content-length', String(end - start + 1))
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          signal?.throwIfAborted()
          const response = pending ?? (await request())
          pending = response
          await validate(response)
          // send is the bounded bridge port; never request an attachment-sized body.
          const bytes = new Uint8Array(await response.arrayBuffer())
          pending = undefined
          signal?.throwIfAborted()
          if (bytes.length !== Math.min(chunkBytes, end - offset + 1))
            throw new Error('Invalid binary range body length')
          if (cancelled) return
          offset += bytes.length
          controller.enqueue(bytes)
          if (offset > end) controller.close()
        } catch (error) {
          if (!cancelled) controller.error(error)
        }
      },
      async cancel() {
        cancelled = true
        await pending?.body?.cancel().catch(() => {})
        pending = undefined
      },
    },
    { highWaterMark: 0 }
  )
  return new Response(body, { status: 206, headers: responseHeaders })
}
