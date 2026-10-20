import { Platform } from 'obsidian'
import { EngineError } from '@abele/sync-sdk/core'
import type { RequestUrlFn } from './transport'
import { fetchViaRequestUrl } from './transport'
import { sessionAwareNet, type SessionFetch, type SessionNet } from './desktopNet'

/** Session-aware native networking without browser CORS or automatic redirects.
 * An explicit native host is a trusted dependency for desktop layout emulation, whose plugin
 * module loader hides Electron. Production supplies none and keeps its desktop-only guard.
 */
export function desktopTransport(session?: SessionFetch, host?: SessionNet): typeof fetch {
  // Resolving remote handles is a run of synchronous IPC calls; do it once per transport.
  let native = host
  const resolve = () => (native ??= sessionAwareNet(session))
  return fetchViaRequestUrl((input, signal) => desktopRequest(input, signal, resolve, !!host))
}

/** Responses up to this size are bridged in one read rather than chunk by chunk. */
const SINGLE_READ_BYTES = 64 * 1024

/** Headers as one record, duplicates joined the way `Headers.get` joins them. */
function headerRecord(native: SessionNet, headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  if (native.headerEntries) {
    for (const [name, value] of native.headerEntries(headers))
      record[name] = name in record ? `${record[name]}, ${value}` : value
    return record
  }
  // Iterate synchronously through the bridge: a remote forEach callback would run later,
  // after constructing the response, and could drop its headers.
  const iterator = (headers as Headers & { keys(): Iterator<string> }).keys()
  for (;;) {
    const next = iterator.next()
    if (next.done) break
    record[next.value] = headers.get(next.value) ?? ''
  }
  return record
}

function abortError(signal?: AbortSignal | null): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The request was aborted', 'AbortError')
}

const desktopRequest = async (
  input: Parameters<RequestUrlFn>[0],
  signal: AbortSignal | null | undefined,
  nativeHost: () => SessionNet,
  explicitHost: boolean
): ReturnType<RequestUrlFn> => {
  if (!explicitHost && !Platform.isDesktop)
    throw new Error('native desktop sync transport is unavailable')
  if (signal?.aborted) throw abortError(signal)
  const url = new URL(input.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('sync transport requires HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new TypeError('sync transport refuses credentials in a URL')
  }
  const native = nativeHost()
  const controller = native.controller()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  // The native Electron port has no upload progress callback. Allow slow large uploads
  // before headers; once a response is streaming, bound each wait between chunks instead.
  const requestBytes =
    typeof input.body === 'string'
      ? new TextEncoder().encode(input.body).length
      : (input.body?.byteLength ?? 0)
  // Injected Node hosts use Node timers; production uses this vault window.
  const clock =
    typeof window === 'undefined' || typeof window.setTimeout !== 'function'
      ? { setTimeout, clearTimeout }
      : window
  const waitNative = async <T>(work: Promise<T>, deadlineMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = clock.setTimeout(() => {
            reject(new EngineError('offline', 'The server stopped answering. Try syncing again.'))
            controller.abort()
          }, deadlineMs)
        }),
      ])
    } finally {
      clock.clearTimeout(timer)
    }
  }
  let streaming = false
  try {
    // Electron's main-process implementation owns the full native request lifecycle. Manual
    // redirect policy is set BEFORE starting it, not inferred from a final followed response.
    const response = await waitNative(
      native.session.fetch(url.href, {
        method: input.method ?? 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        headers: { ...input.headers, 'cache-control': 'no-store, no-cache', pragma: 'no-cache' },
        signal: controller.signal,
        ...(input.body === undefined
          ? {}
          : { body: typeof input.body === 'string' ? input.body : native.body(input.body) }),
      }),
      30000 + Math.ceil(requestBytes / (32 * 1024)) * 1000
    ).catch((error: unknown) => {
      // Electron's native manual policy rejects at the redirect before exposing a Response.
      if ((error as { message?: unknown } | null)?.message === 'Redirect was cancelled') {
        throw new Error('sync transport refuses redirects')
      }
      throw error
    })
    if (signal?.aborted) throw abortError(signal)
    // Each property read on a native response is a synchronous bridge call: read each once.
    const status = response.status
    if (response.type === 'opaqueredirect' || (status >= 300 && status < 400 && status !== 304)) {
      // The main-process net implementation paused at this response; no second request exists.
      await response.body?.cancel()
      throw new Error('sync transport refuses redirects')
    }
    const headers = headerRecord(native, response.headers)
    const init = { status, headers }
    if ((input.method ?? 'GET') === 'HEAD' || [204, 205, 304].includes(status)) {
      await response.body?.cancel()
      return new Response(null, init)
    }
    const declared = Number(headers['content-length'] ?? NaN)
    if (Number.isSafeInteger(declared) && declared >= 0 && declared <= SINGLE_READ_BYTES) {
      // A small body is bridged in one read: one call instead of one per chunk and its fields.
      const whole = await waitNative(response.arrayBuffer(), 30000)
      if (signal?.aborted) throw abortError(signal)
      return new Response(native.bytes(whole) as Uint8Array<ArrayBuffer>, init)
    }
    if (!response.body) return new Response(null, init)
    const reader = response.body.getReader()
    const finish = () => signal?.removeEventListener('abort', abort)
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(stream) {
          try {
            if (signal?.aborted) throw abortError(signal)
            const next = await waitNative(reader.read(), 30000)
            // `value` is read once: on a native result every read is a bridge call and a copy.
            const value = next.done ? undefined : next.value
            if (!value) {
              finish()
              stream.close()
            } else {
              // Electron serializes only this bounded chunk, never the complete attachment.
              const chunk = native.bytes(value.buffer)
              stream.enqueue(chunk.subarray(value.byteOffset, value.byteOffset + value.byteLength))
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
    return new Response(body, init)
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    throw error
  } finally {
    if (!streaming) signal?.removeEventListener('abort', abort)
  }
}
