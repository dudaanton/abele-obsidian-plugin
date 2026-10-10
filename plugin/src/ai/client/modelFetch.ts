import { getDesktopNet } from '@/helpers/netTransport'
import type { SessionNet } from '@/sync/desktopNet'
import { getModelNet } from './modelNet'

/** Browser fetch ignores User-Agent. Opt in to native streaming only for a named client. */
export function modelFetch(url: string, init: RequestInit, clientName?: string): Promise<Response> {
  const net = clientName?.trim() ? getDesktopNet() : null
  if (!net) return window.fetch(url, init)
  return nativeModelFetch(getModelNet(net), url, init)
}

/** Bridge bounded chunks, not a buffered completion, from Electron's session fetch. */
export async function nativeModelFetch(
  native: SessionNet,
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = native.controller()
  const signal = init.signal
  signal?.throwIfAborted()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const finish = () => signal?.removeEventListener('abort', abort)
  let streaming = false
  try {
    const response = await native.session.fetch(url, {
      ...init,
      credentials: 'omit',
      signal: controller.signal,
    })
    signal?.throwIfAborted()
    const headers: Record<string, string> = {}
    // Remote callback iteration is asynchronous; a synchronous iterator preserves the headers.
    const keys = (response.headers as Headers & { keys(): Iterator<string> }).keys()
    for (;;) {
      const next = keys.next()
      if (next.done) break
      headers[next.value] = response.headers.get(next.value) ?? ''
    }
    const responseInit = { status: response.status, headers }
    if (!response.body || [204, 205, 304].includes(response.status)) {
      await response.body?.cancel()
      return new Response(null, responseInit)
    }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(stream) {
          try {
            signal?.throwIfAborted()
            const next = await reader.read()
            if (next.done) {
              finish()
              stream.close()
            } else {
              const bytes = native.bytes(next.value.buffer)
              stream.enqueue(
                bytes.subarray(next.value.byteOffset, next.value.byteOffset + next.value.byteLength)
              )
            }
          } catch (error) {
            finish()
            controller.abort()
            stream.error(error)
          }
        },
        async cancel() {
          finish()
          controller.abort()
          await reader.cancel()
        },
      },
      { highWaterMark: 0 }
    )
    streaming = true
    return new Response(body, responseInit)
  } catch (error) {
    controller.abort()
    signal?.throwIfAborted()
    throw error
  } finally {
    if (!streaming) finish()
  }
}
