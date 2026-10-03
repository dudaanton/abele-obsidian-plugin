import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian'
import { desktopTransport, getDesktopNet, type RequestTransport } from './netTransport'

export interface NetworkRequest extends RequestUrlParam {
  /** Values substituted into arbitrary headers, URL or body. Never included in errors. */
  secretValues?: string[]
  maxRedirects?: number
  timeoutMs?: number
  maxBytes?: number
}

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024

/** A deadline even for platform operations that cannot be cancelled. Never includes URL keys. */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: number
  const expiry = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`Request timed out after ${Math.round(ms / 1000)}s`))
      onTimeout?.()
    }, ms)
  })
  return Promise.race([work, expiry]).finally(() => window.clearTimeout(timer))
}

function checkSize(answer: RequestUrlResponse, max: number): void {
  const declared = Number(headerValue(answer.headers, 'content-length'))
  const actual =
    answer.arrayBuffer?.byteLength ?? new TextEncoder().encode(answer.text ?? '').length
  if (declared > max || actual > max) throw new Error(`Response too large (limit ${max} bytes)`)
}

/** Read browser-fetch bodies incrementally rather than buffering an unbounded error page. */
export async function readTextLimited(response: Response, max: number): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (new TextEncoder().encode(text).length > max) throw new Error('Response too large')
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > max) throw new Error('Response too large')
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

let requestGuard: ((request: RequestUrlParam) => string[]) | undefined
export function setRequestGuard(guard: typeof requestGuard): void {
  requestGuard = guard
}
export function checkRequest(request: RequestUrlParam): string[] {
  return requestGuard?.(request) ?? []
}

let transportOverride: RequestTransport | undefined
export function setRequestTransport(transport: RequestTransport | undefined): void {
  transportOverride = transport
}
const redirects = new Set([301, 302, 303, 307, 308])
const credentialHeader =
  /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-subscription-token)$/i
export function headerValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  return Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
}

export interface TextResponse {
  status: number
  headers: Record<string, string>
  text: string
}

/** Domain adapters interpret status themselves; transport/guard failures still propagate. */
export async function requestText(
  options: NetworkRequest,
  lowercaseHeaders = false
): Promise<TextResponse> {
  const response = await request({ ...options, throw: false })
  const headers = response.headers ?? {}
  let text = ''
  try {
    text = response.text
  } catch {
    // A non-text body does not erase the HTTP status.
  }
  return {
    status: response.status,
    headers: lowercaseHeaders
      ? Object.fromEntries(
          Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
        )
      : headers,
    text,
  }
}

/**
 * Desktop: follow redirects explicitly, dropping keys on a change of origin.
 * Mobile: Obsidian's native transport does not expose redirect control; see user docs.
 */
export async function request(options: NetworkRequest): Promise<RequestUrlResponse> {
  const carried = checkRequest(options)
  const controller = new AbortController()
  const ms =
    Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0
      ? options.timeoutMs!
      : DEFAULT_TIMEOUT_MS
  const values = [...(options.secretValues ?? []), ...carried]
  for (const [name, value] of Object.entries(options.headers ?? {}))
    if (credentialHeader.test(name)) values.push(value, value.replace(/^(Bearer|Basic)\s+/i, ''))
  try {
    return await withDeadline(
      sendRequest({ ...options, secretValues: values }, controller.signal),
      ms,
      () => controller.abort()
    )
  } catch (error) {
    if (!values.some(Boolean)) throw error
    const redact = (text: string) => {
      for (const value of [...values].sort((a, b) => b.length - a.length))
        if (value) text = text.split(value).join('[saved key]')
      return text
    }
    const safe = new Error(
      redact(error instanceof Error ? error.message : 'Network request failed')
    )
    if (error instanceof Error) safe.name = redact(error.name)
    throw safe
  }
}

async function sendRequest(
  options: NetworkRequest,
  signal: AbortSignal
): Promise<RequestUrlResponse> {
  const {
    secretValues = [],
    maxRedirects = 5,
    timeoutMs: _timeout,
    maxBytes = DEFAULT_MAX_BYTES,
    ...params
  } = options
  const net = getDesktopNet()
  const send = transportOverride ?? (net ? desktopTransport(net, maxBytes, signal) : null)
  if (!send) {
    const answer = await requestUrl(params)
    checkSize(answer, maxBytes)
    return answer
  }
  const values = [...secretValues]
  for (const [name, value] of Object.entries(params.headers ?? {})) {
    if (credentialHeader.test(name)) values.push(value, value.replace(/^(Bearer|Basic)\s+/i, ''))
  }
  const containsKey = (text: string) => {
    let decoded = text
    try {
      decoded = decodeURIComponent(text)
    } catch {
      /* Malformed escapes are not decoded. */
    }
    return values.some((value) => value && (text.includes(value) || decoded.includes(value)))
  }
  let current = { ...params, headers: { ...params.headers }, throw: false }
  for (let hop = 0; ; hop++) {
    signal.throwIfAborted()
    const answer = await send(current)
    signal.throwIfAborted()
    checkSize(answer, maxBytes)
    const location = headerValue(answer.headers, 'location')
    if (!redirects.has(answer.status) || !location) {
      if (params.throw !== false && answer.status >= 400)
        throw new Error(`Request failed: HTTP ${answer.status}`)
      return answer
    }
    if (hop >= maxRedirects) throw new Error('Too many network redirects')
    const next = new URL(location, current.url)
    if (!['https:', 'http:'].includes(next.protocol) || next.username || next.password)
      throw new Error('Invalid network redirect')
    const changed = next.origin !== new URL(current.url).origin
    const method = (current.method ?? 'GET').toUpperCase()
    const toGet =
      (answer.status === 303 && method !== 'HEAD') ||
      ([301, 302].includes(answer.status) && method === 'POST')
    const body = toGet ? undefined : current.body
    const headers = { ...current.headers }
    if (toGet)
      for (const name of Object.keys(headers))
        if (/^content-(type|length)$/i.test(name)) delete headers[name]
    if (changed) {
      for (const [name, value] of Object.entries(headers))
        if (credentialHeader.test(name) || containsKey(value)) delete headers[name]
      if (containsKey(next.href)) throw new Error('A redirect cannot carry a key in its address')
      const bodyText = typeof body === 'string' ? body : body ? new TextDecoder().decode(body) : ''
      if (containsKey(bodyText)) throw new Error('A redirect cannot carry a key in its body')
    }
    current = {
      ...current,
      url: next.href,
      method: toGet ? 'GET' : current.method,
      headers,
      body,
      contentType: toGet ? undefined : current.contentType,
    }
  }
}
