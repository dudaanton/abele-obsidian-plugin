import type { ErrorBody } from '@abele/sync-protocol'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

/**
 * Translate native HTTP answers to the engine's `fetch` contract, without browser CORS.
 * Desktop uses the non-following adapter in desktopTransport.ts. Obsidian's requestUrl
 * remains the mobile native path until its separate pre-follow feasibility gate is solved.
 * This translator cannot prevent redirects followed by an underlying native implementation.
 */

/** What this plugin calls itself to a sync server. */
export const USER_AGENT = 'abele-obsidian-plugin'

/**
 * `requestUrl` as this module needs it. Obsidian's own is assignable to it: the real one
 * also takes a bare url string and answers a promise carrying `arrayBuffer`/`json`/`text`
 * of its own, neither of which is used here — and a narrower type is one a test can stand
 * in for with a plain async function.
 */
export type RequestUrlFn = (
  request: RequestUrlParam,
  signal?: AbortSignal | null
) => Promise<RequestUrlResponse>

/** Statuses the fetch spec says carry no body; `Response` refuses to be built with one. */
const BODILESS_STATUS = new Set([204, 205, 304])

/** What `Response` will be built with at all: anything else it answers with a `RangeError`. */
const LOWEST_STATUS = 200
const HIGHEST_STATUS = 599

/**
 * A `fetch` over `requestUrl`.
 *
 * `throw: false` is what makes the two agree: `fetch` resolves for every answer a server
 * gives and leaves the status to the caller, while `requestUrl` would otherwise throw on
 * 400 and up. A request that never reached the server still rejects, which is what the
 * engine reads as being offline.
 */
export function fetchViaRequestUrl(requestUrl: RequestUrlFn): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = headersOf(init?.headers)
    // A blob HEAD is permission-scoped to the current device's vault, not just to its URL.
    // Native HTTP caching can otherwise reuse another vault's 200 after switching tokens and
    // make the engine skip an upload that the new vault still needs.
    if (method === 'HEAD') headers['cache-control'] = 'no-cache'
    const body = bodyOf(init?.body)
    // Obsidian sends `contentType` as the header of that name, and some builds ignore one
    // passed in `headers` alone. Sending both says the same thing twice, which is safe.
    const contentType = headers['content-type']

    // The url only: the headers carry the device token, and this line goes to a console
    // anyone can open.
    console.debug(`[abele-sync] ${method} ${url}`)
    const answer = await requestUrl(
      {
        url,
        method,
        headers,
        throw: false,
        ...(body === undefined ? {} : { body }),
        ...(contentType === undefined ? {} : { contentType }),
      },
      init?.signal
    )

    // Defence in depth only. A native adapter must prevent following before returning here;
    // Obsidian's requestUrl does not expose that control (the mobile gate remains separate).
    if (answer.status >= 300 && answer.status < 400 && answer.status !== 304) {
      throw new Error('sync transport refuses redirects')
    }

    if (answer.status < LOWEST_STATUS || answer.status > HIGHEST_STATUS) {
      return outOfRange(answer.status)
    }

    // A HEAD answers with headers and nothing else — `hasBlob` asks with one — and the
    // bodiless statuses are refused by the `Response` constructor if handed any bytes.
    const bodiless = method === 'HEAD' || BODILESS_STATUS.has(answer.status)
    return new Response(bodiless ? null : answer.arrayBuffer, {
      status: answer.status,
      headers: answerHeaders(answer.headers),
    })
  }
}

/**
 * The `WebSocket` the event stream is opened with: the WebView's own, on either platform.
 *
 * The main window's rather than the active one's — a popout can be closed while sync is still
 * listening, and the socket must outlive whatever note happens to be in front.
 */
export function wsFor(): typeof WebSocket {
  const socket = (window as { WebSocket?: typeof WebSocket }).WebSocket
  if (typeof socket !== 'function') {
    throw new Error('this Obsidian build has no WebSocket to listen for changes with')
  }
  return socket
}

/**
 * An answer no `Response` can carry, as one that can.
 *
 * A status outside 200–599 is not a server's: it is a captive portal, a proxy, or Obsidian
 * itself reporting a request that went nowhere. Letting the `Response` constructor throw
 * would make the engine call that offline, which is the one thing it is not — so it becomes
 * a 502 whose body is the protocol's own error envelope, and the engine prints what really
 * came back.
 */
function outOfRange(status: number): Response {
  const body: ErrorBody = {
    error: {
      code: 'internal',
      message: `something between this device and the server answered ${status}`,
      details: { status },
    },
  }
  return new Response(JSON.stringify(body), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  })
}

/** What was asked for, however the caller named it. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  // A `Request` carries its own method, headers and body, and none of them are read here:
  // sending only its url would put a different request on the wire than the one asked for.
  throw new TypeError('the Obsidian transport takes a url, not a Request')
}

/** The headers as `requestUrl` takes them, from any of the three shapes `fetch` accepts. */
function headersOf(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers === undefined) return out
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    // The spec says a `Headers` iterates lower case; not every implementation does, and the
    // map handed to `requestUrl` must have one spelling of a name and not two.
    headers.forEach((value, name) => {
      out[name.toLowerCase()] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) out[name.toLowerCase()] = value
    return out
  }
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = value
  return out
}

/**
 * The body as `requestUrl` takes it: text or bytes.
 *
 * The engine sends a `Uint8Array` for every blob, and often a window onto a larger buffer —
 * a multipart upload sends `bytes.subarray(from, to)`. Only the window's own bytes may go
 * out, so a view that is not its whole buffer is copied rather than sent whole.
 */
function bodyOf(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (body === null || body === undefined) return undefined
  if (typeof body === 'string') return body
  if (body instanceof ArrayBuffer) return body
  if (ArrayBuffer.isView(body)) {
    if (body.byteOffset === 0 && body.byteLength === body.buffer.byteLength) {
      return body.buffer
    }
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
  }
  // A stream, a Blob or a form: the engine sends none of them, and guessing at bytes for one
  // would put the wrong thing on the wire rather than say so.
  throw new TypeError('the Obsidian transport sends only text and bytes')
}

/** The answer's headers, as a `Headers` — which is what makes `get` case-insensitive. */
function answerHeaders(raw: Record<string, string> | undefined): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw ?? {})) {
    try {
      headers.set(name, value)
    } catch {
      // A name or value no `Headers` will hold came from something between us and the
      // server. Nothing here reads it, and dropping it beats failing the whole request.
    }
  }
  return headers
}
