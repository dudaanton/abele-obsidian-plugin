import { Platform } from 'obsidian'
import type { RequestUrlFn } from './transport'
import { fetchViaRequestUrl } from './transport'

/**
 * Node's native HTTP client never follows redirects, caches responses, or supplies cookies.
 * The Obsidian API exposes no pre-follow redirect control. Inspecting its final response is
 * too late to protect a device token or a sign-in body. Load Node only on desktop: this module
 * is safe to bundle on mobile, but its factory must not be called there.
 */
export function desktopTransport(): typeof fetch {
  return fetchViaRequestUrl(desktopRequest)
}

function abortError(signal?: AbortSignal | null): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The request was aborted', 'AbortError')
}

const desktopRequest: RequestUrlFn = async (input, signal) => {
  if (!Platform.isDesktop) throw new Error('native desktop sync transport is unavailable')
  if (signal?.aborted) throw abortError(signal)
  const url = new URL(input.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('sync transport requires HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new TypeError('sync transport refuses credentials in a URL')
  }
  // No browser fetch/CORS, redirect library, cookie jar, or native response cache.
  // HTTPS keeps the native client's certificate and hostname validation enabled.
  // Native dynamic import() stays a browser import in Obsidian's CJS plugin loader.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- guarded desktop-only native module, verified in the live probe
  const http = require(
    url.protocol === 'https:' ? 'node:https' : 'node:http'
  ) as typeof import('node:http')
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: input.method ?? 'GET',
      headers: { ...input.headers, 'cache-control': 'no-store' },
    })
    const abort = () => request.destroy(abortError(signal))
    signal?.addEventListener('abort', abort, { once: true })
    request.once('close', () => signal?.removeEventListener('abort', abort))
    request.once('error', reject)
    request.once('response', (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && status !== 304) {
        // Stop at headers, before reading a redirect body or ever creating a second request.
        reject(new Error('sync transport refuses redirects'))
        response.destroy()
        request.destroy()
        return
      }
      const chunks: Uint8Array[] = []
      let size = 0
      response.on('data', (chunk: Uint8Array) => {
        chunks.push(chunk)
        size += chunk.byteLength
      })
      response.once('error', reject)
      response.once('aborted', () => reject(new Error('sync response was interrupted')))
      response.once('end', () => {
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
          bytes.set(chunk, offset)
          offset += chunk.byteLength
        }
        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value
        }
        resolve({ status, headers, arrayBuffer: bytes.buffer, json: null, text: '' })
      })
    })
    if (input.body !== undefined)
      request.write(typeof input.body === 'string' ? input.body : new Uint8Array(input.body))
    request.end()
  })
}
