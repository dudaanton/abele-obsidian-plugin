import { binaryResponse } from './binaryResponse'
import { apiVersion } from 'obsidian'
export interface NativeHttpOptions {
  url: string
  method: string
  headers: Record<string, string>
  disableRedirects: true
  responseType: 'arraybuffer'
  data?: unknown
  dataType?: 'file'
}
export interface NativeHttpResponse {
  status: number
  headers: Record<string, string>
  data: unknown
  url: string
}
export interface NativeHttp {
  request(options: NativeHttpOptions): Promise<NativeHttpResponse>
}
const abortError = () => new DOMException('The native sync request was aborted', 'AbortError')
function base64(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 32768)
    text += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(text)
}
function responseBytes(data: unknown): Uint8Array {
  if (data == null) return new Uint8Array()
  if (typeof data === 'object') return new TextEncoder().encode(JSON.stringify(data))
  if (typeof data !== 'string') throw new Error('Unsupported native sync response bytes')
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((data.length / 4) * 3 - padding)
  // Decode aligned base64 chunks, avoiding a full binary string alongside the buffer.
  for (let at = 0, offset = 0; at < data.length; at += 32768) {
    const decoded = atob(data.slice(at, at + 32768))
    for (let i = 0; i < decoded.length; i++) bytes[offset++] = decoded.charCodeAt(i)
  }
  return bytes
}
/** Known runtime only; no fallback to requestUrl, whose native redirect/cache behavior is unsafe. */
export function mobileTransport(): typeof fetch {
  const capacitor = (
    window as unknown as {
      Capacitor?: { getPlatform?: () => string; Plugins?: { CapacitorHttp?: NativeHttp } }
    }
  ).Capacitor
  const http = capacitor?.Plugins?.CapacitorHttp
  if (
    apiVersion !== '1.13.7' ||
    capacitor?.getPlatform?.() !== 'ios' ||
    typeof http?.request !== 'function'
  )
    throw new Error(
      'Native sync transport is unsupported until its non-following runtime is verified'
    )
  return fetchViaCapacitorHttp(exactNativeRequestBodies(http))
}
/** NSJSONSerialization can reorder dictionaries. Commit replay must send the same bytes. */
export function exactNativeRequestBodies(native: NativeHttp): NativeHttp {
  return {
    request(options) {
      if (options.data !== undefined && options.dataType !== 'file') {
        const text = typeof options.data === 'string' ? options.data : JSON.stringify(options.data)
        return native.request({
          ...options,
          data: base64(new TextEncoder().encode(text)),
          dataType: 'file',
        })
      }
      return native.request(options)
    },
  }
}
/** Exact native bytes and explicit pre-follow refusal, measured through the real iOS bridge. */
export function fetchViaCapacitorHttp(native: NativeHttp): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null)
    if (signal?.aborted) throw abortError()
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    ).href
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const incoming = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const headers: Record<string, string> = {}
    incoming.forEach((value, key) => {
      headers[key] = value
    })
    // Native response caching otherwise reused an authenticated GET for another principal.
    delete headers['cache-control']
    headers['Cache-Control'] = 'no-cache, no-store'
    const contentType = headers['content-type']
    delete headers['content-type']
    if (contentType) headers['Content-Type'] = contentType
    const options: NativeHttpOptions = {
      url,
      method,
      headers,
      disableRedirects: true,
      responseType: 'arraybuffer',
    }
    const body = init?.body
    if (body !== undefined && body !== null) {
      if (typeof body === 'string') {
        headers['Content-Type'] ??= 'text/plain'
        options.data = contentType?.toLowerCase().includes('application/json')
          ? JSON.parse(body)
          : body
      } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const bytes =
          body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
        options.data = base64(bytes)
        options.dataType = 'file'
        headers['Content-Type'] ??= 'application/octet-stream'
      } else throw new Error('Unsupported native sync request body')
    }
    const answer = await new Promise<NativeHttpResponse>((resolve, reject) => {
      const aborted = () => reject(abortError())
      signal?.addEventListener('abort', aborted, { once: true })
      Promise.resolve()
        .then(() => {
          if (signal?.aborted) throw abortError()
          return native.request(options)
        })
        .then((value) => (signal?.aborted ? reject(abortError()) : resolve(value)), reject)
        .finally(() => signal?.removeEventListener('abort', aborted))
    })
    if (answer.status >= 300 && answer.status < 400 && answer.status !== 304)
      throw new Error('sync transport refuses redirects before following')
    if (answer.url !== url)
      throw new Error('Native sync transport unexpectedly followed a redirect')
    if (answer.status < 200 || answer.status > 599)
      throw new Error('Unsupported native sync response status')
    const bodiless = method === 'HEAD' || [204, 205, 304].includes(answer.status)
    const bytes = bodiless ? null : responseBytes(answer.data)
    answer.data = null
    const responseInit = { status: answer.status, headers: answer.headers }
    return bytes === null ? new Response(null, responseInit) : binaryResponse(bytes, responseInit)
  }
}
