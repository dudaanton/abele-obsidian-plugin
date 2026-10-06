import { Platform } from 'obsidian'
import type { RequestUrlFn } from './transport'
import { fetchViaRequestUrl } from './transport'
import { sessionAwareNet, type SessionFetch, type SessionNet } from './desktopNet'

/** Session-aware native networking without browser CORS or automatic redirects.
 * An explicit native host is a trusted dependency for desktop layout emulation, whose plugin
 * module loader hides Electron. Production supplies none and keeps its desktop-only guard.
 */
export function desktopTransport(session?: SessionFetch, host?: SessionNet): typeof fetch {
  return fetchViaRequestUrl((input, signal) => desktopRequest(input, signal, session, host))
}

function abortError(signal?: AbortSignal | null): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The request was aborted', 'AbortError')
}

const desktopRequest = async (
  input: Parameters<RequestUrlFn>[0],
  signal?: AbortSignal | null,
  session?: SessionFetch,
  host?: SessionNet
): ReturnType<RequestUrlFn> => {
  if (!host && !Platform.isDesktop) throw new Error('native desktop sync transport is unavailable')
  if (signal?.aborted) throw abortError(signal)
  const url = new URL(input.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('sync transport requires HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new TypeError('sync transport refuses credentials in a URL')
  }
  const native = host ?? sessionAwareNet(session)
  const controller = native.controller()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    // Electron's main-process implementation owns the full native request lifecycle. Manual
    // redirect policy is set BEFORE starting it, not inferred from a final followed response.
    const response = await native.session
      .fetch(url.href, {
        method: input.method ?? 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        headers: { ...input.headers, 'cache-control': 'no-store, no-cache', pragma: 'no-cache' },
        signal: controller.signal,
        ...(input.body === undefined
          ? {}
          : { body: typeof input.body === 'string' ? input.body : native.body(input.body) }),
      })
      .catch((error: unknown) => {
        // Electron's native manual policy rejects at the redirect before exposing a Response.
        if ((error as { message?: unknown } | null)?.message === 'Redirect was cancelled') {
          throw new Error('sync transport refuses redirects')
        }
        throw error
      })
    if (signal?.aborted) throw abortError(signal)
    if (
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400 && response.status !== 304)
    ) {
      // The main-process net implementation paused at this response; no second request exists.
      await response.body?.cancel()
      throw new Error('sync transport refuses redirects')
    }
    const headers: Record<string, string> = {}
    // Iterate synchronously through the bridge: a remote forEach callback would run later,
    // after constructing the response, and could drop its headers.
    const iterator = (response.headers as Headers & { keys(): Iterator<string> }).keys()
    for (;;) {
      const next = iterator.next()
      if (next.done) break
      headers[next.value] = response.headers.get(next.value) ?? ''
    }
    const bytes = native.bytes(await response.arrayBuffer())
    if (signal?.aborted) throw abortError(signal)
    return {
      status: response.status,
      headers,
      arrayBuffer: bytes.buffer as ArrayBuffer,
      json: null,
      text: '',
    }
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
