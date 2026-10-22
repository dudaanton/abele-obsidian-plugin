import { EngineError } from '@abele/sync-sdk/core'
import { binaryResponse } from './binaryResponse'
import { rangedBinaryTransport } from './rangedBinaryTransport'
import { ExchangeTrace } from './exchangeTrace'
const nativeRequests = new ExchangeTrace()
nativeRequests.finishFirstSync()
export const nativeSyncTransportSnapshot = () => nativeRequests.snapshot()
export const MOBILE_BINARY_CHUNK_BYTES = 1024 * 1024
/** How long a native request waits to connect, and then to read. */
const NATIVE_TIMEOUT_MS = 30_000
let nativeTimeoutMs = NATIVE_TIMEOUT_MS
/**
 * For tests of a server that stopped answering, which would otherwise wait the full 30 s per
 * request; `null` puts the real value back. Nothing outside the test API calls it.
 */
export function setNativeSyncTimeoutForTests(ms: number | null): void {
  nativeTimeoutMs = ms ?? NATIVE_TIMEOUT_MS
}
export interface NativeHttpOptions {
  url: string
  method: string
  headers: Record<string, string>
  disableRedirects: true
  responseType: 'arraybuffer'
  connectTimeout?: number
  readTimeout?: number
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
export class NativeSyncFailure extends EngineError {
  readonly connectionLost: boolean
  constructor(
    readonly phase: string,
    error: unknown
  ) {
    const native = error as { code?: unknown; message?: unknown }
    const clean = (value: unknown) =>
      (typeof value === 'string' || typeof value === 'number' ? String(value) : 'unknown')
        .replace(/https?:\/\/[^\s]+/gi, '[address]')
        .replace(/Bearer\s+\S+/gi, '[credential]')
        .replace(/[A-Za-z0-9_+/-]{24,}/g, '[redacted]')
        .replace(/[\r\n]/g, ' ')
        .slice(0, 200)
    const nativeCode = clean(native?.code)
    const network =
      phase === 'sending' &&
      /^(?:-1003|-1004|-1009|ENOTFOUND|ECONNREFUSED|ENETUNREACH)$/.test(nativeCode)
    // Unknown bridge/encoding/body interruptions can change on retry. Only explicit
    // local incompatibilities and redirect refusals are deterministic stopping errors.
    const permanent =
      (phase === 'encoding' && error instanceof SyntaxError) ||
      /^(?:Unsupported (?:native sync request body|native sync response bytes|native sync response status|bytes)|sync transport refuses redirects before following|Native sync transport unexpectedly followed a redirect|Native binary response exceeds requested range)$/i.test(
        typeof native?.message === 'string' ? native.message : ''
      )
    const label =
      phase === 'encoding'
        ? "Couldn't send changes"
        : network
          ? 'Server unavailable'
          : 'Sync interrupted'
    super(
      permanent ? 'io' : 'offline',
      `${label}. Native ${phase} (${nativeCode}): ${clean(native?.message ?? error)}`
    )
    // Some iOS bridge versions expose the domain rather than the numeric NSError code.
    this.connectionLost =
      phase === 'sending' &&
      (native?.code === -1005 ||
        native?.code === '-1005' ||
        (native?.code === 'NSURLErrorDomain' &&
          native?.message === 'The network connection was lost.'))
  }
}
/** Find a sanitized native diagnosis, including failures nested by host callers. */
export function nativeSyncFailure(error: unknown): NativeSyncFailure | undefined {
  let current = error
  for (let depth = 0; depth < 8 && current; depth++) {
    if (current instanceof NativeSyncFailure) return current
    current = (current as { cause?: unknown }).cause
  }
}
const abortError = () => new DOMException('The native sync request was aborted', 'AbortError')
/** Native cancellation has no acknowledgement: retain the journal and reconcile its key. */
export class NativeSyncUnknownOutcome extends DOMException {
  readonly outcome = 'unknown' as const
  constructor() {
    super('The native sync request was aborted with an unknown outcome', 'AbortError')
  }
}
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
  if (capacitor?.getPlatform?.() !== 'ios' || typeof http?.request !== 'function')
    throw new Error(
      'Native sync transport is unsupported until its non-following runtime is verified'
    )
  return rangedBinaryTransport(
    fetchViaCapacitorHttp(exactNativeRequestBodies(http)),
    MOBILE_BINARY_CHUNK_BYTES
  )
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
  const send = capacitorFetch(native)
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const range = /^bytes=\d+-\d+$/.test(headers.get('range') ?? '') ? headers.get('range') : null
    const masked = url.pathname
      .replace(/\/v2\/files\/[^/]+\//, '/v2/files/:id/')
      .replace(/\/v2\/uploads\/[^/]+/, '/v2/uploads/:id')
    const path =
      /^\/v2\/(?:connection|commit|changes|manifest|files\/:id\/(?:content|external\/verify)|uploads\/:id)$/.test(
        masked
      )
        ? masked
        : '/other'
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const signal = init?.signal ?? (input instanceof Request ? input.signal : null)
    const safeRead = (method === 'GET' || method === 'HEAD') && init?.body == null
    // Commit receipts are bound to the key and exact body. Leave other mutations
    // and non-repeatable bodies to their protocol's recovery path.
    const keyedCommit =
      method === 'POST' &&
      url.pathname === '/v2/commit' &&
      !!headers.get('idempotency-key')?.trim() &&
      typeof init?.body === 'string'
    // A caller can mutate its init object while native work is pending. Capture the
    // endpoint, authority, key and repeatable body once for both attempts.
    const captured: RequestInit = { ...init, method, headers, signal }
    const operation = `${method} ${path}${range ? ' ' + range : ''}`
    for (let attempt = 0; ; attempt++) {
      try {
        return await nativeRequests.run(operation, () => send(url.href, captured))
      } catch (error) {
        if (
          attempt ||
          !(safeRead || keyedCommit) ||
          signal?.aborted ||
          !(error instanceof NativeSyncFailure) ||
          !error.connectionLost
        )
          throw error
        // Each settled send retains its existing deadline. Never retry an unresolved
        // native timeout, a decoding failure, or a protocol/HTTP refusal.
        nativeRequests.log('Retrying connection-lost request: ' + operation)
        console.debug('[Abele Sync native retry]', { operation, attempt: 1 })
      }
    }
  }
}
function capacitorFetch(native: NativeHttp): typeof fetch {
  return async (input, init) => {
    let phase = 'encoding'
    try {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null)
      if (signal?.aborted) throw abortError()
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      ).href
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase()
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
        connectTimeout: nativeTimeoutMs,
        readTimeout: nativeTimeoutMs,
      }
      const body = init?.body
      let requestBytes = 0
      if (body !== undefined && body !== null) {
        if (typeof body === 'string') {
          requestBytes = new TextEncoder().encode(body).byteLength
          headers['Content-Type'] ??= 'text/plain'
          options.data = contentType?.toLowerCase().includes('application/json')
            ? JSON.parse(body)
            : body
        } else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
          const bytes =
            body instanceof ArrayBuffer
              ? new Uint8Array(body)
              : new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
          requestBytes = bytes.byteLength
          options.data = base64(bytes)
          options.dataType = 'file'
          headers['Content-Type'] ??= 'application/octet-stream'
        } else throw new Error('Unsupported native sync request body')
      }
      phase = 'sending'
      const range = /^bytes=(\d+)-(\d+)$/.exec(incoming.get('range') ?? '')
      const expectedBytes = range ? Math.max(0, Number(range[2]) - Number(range[1]) + 1) : 0
      // The native bridge exposes no byte-progress callbacks. Native inactivity
      // timeouts remain 30s; this last-resort overall bound allows 32 KiB/s.
      const deadlineMs = 30000 + Math.ceil((requestBytes + expectedBytes) / (32 * 1024)) * 1000
      let timer: number | undefined
      let sent = false
      const cancellation = () =>
        sent && method !== 'GET' && method !== 'HEAD'
          ? new NativeSyncUnknownOutcome()
          : abortError()
      const aborted = () => rejectRequest?.(cancellation())
      let rejectRequest: ((error: unknown) => void) | undefined
      const answer = await new Promise<NativeHttpResponse>((resolve, reject) => {
        rejectRequest = reject
        timer = window.setTimeout(
          () =>
            reject(new Error(`Native request did not answer within ${deadlineMs / 1000} seconds`)),
          deadlineMs
        )
        signal?.addEventListener('abort', aborted, { once: true })
        Promise.resolve()
          .then(() => {
            if (signal?.aborted) throw abortError()
            sent = true
            return native.request(options)
          })
          .then((value) => (signal?.aborted ? reject(cancellation()) : resolve(value)), reject)
      }).finally(() => {
        window.clearTimeout(timer)
        signal?.removeEventListener('abort', aborted)
      })
      phase = 'response'
      if (answer.status >= 300 && answer.status < 400 && answer.status !== 304)
        throw new Error('sync transport refuses redirects before following')
      if (answer.url !== url)
        throw new Error('Native sync transport unexpectedly followed a redirect')
      if (answer.status < 200 || answer.status > 599)
        throw new Error('Unsupported native sync response status')
      const bodiless = method === 'HEAD' || [204, 205, 304].includes(answer.status)
      if (!bodiless && expectedBytes && answer.status >= 200 && answer.status < 300) {
        const data = answer.data
        const padding =
          typeof data === 'string' ? (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) : 0
        const decodedBytes = typeof data === 'string' ? (data.length / 4) * 3 - padding : 0
        if (decodedBytes > expectedBytes) {
          answer.data = null
          throw new Error('Native binary response exceeds requested range')
        }
      }
      const bytes = bodiless ? null : responseBytes(answer.data)
      answer.data = null
      const responseInit = { status: answer.status, headers: answer.headers }
      return bytes === null ? new Response(null, responseInit) : binaryResponse(bytes, responseInit)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw error instanceof NativeSyncFailure ? error : new NativeSyncFailure(phase, error)
    }
  }
}
