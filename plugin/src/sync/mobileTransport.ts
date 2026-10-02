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
  const decoded = atob(data),
    bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
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
  return fetchViaCapacitorHttp(http)
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
    return new Response(bytes === null ? null : new Uint8Array(bytes).buffer, {
      status: answer.status,
      headers: answer.headers,
    })
  }
}
