import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian'
import { desktopTransport, getDesktopNet, type RequestTransport } from './netTransport'

export interface NetworkRequest extends RequestUrlParam {
  /** Values substituted into arbitrary headers, URL or body. Never included in errors. */
  secretValues?: string[]
  maxRedirects?: number
}

let transportOverride: RequestTransport | undefined
export function setRequestTransport(transport: RequestTransport | undefined): void {
  transportOverride = transport
}
const redirects = new Set([301, 302, 303, 307, 308])
const credentialHeader =
  /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token)$/i
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
}

/**
 * Desktop: follow redirects explicitly, dropping keys on a change of origin.
 * Mobile: Obsidian's native transport does not expose redirect control; see user docs.
 */
export async function request(options: NetworkRequest): Promise<RequestUrlResponse> {
  const { secretValues = [], maxRedirects = 5, ...params } = options
  const net = getDesktopNet()
  const send = transportOverride ?? (net ? desktopTransport(net) : null)
  if (!send) return requestUrl(params)
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
    const answer = await send(current)
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
    let body = toGet ? undefined : current.body
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
