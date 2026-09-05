import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

/**
 * The Obsidian transport: the engine's `fetch`, built on Obsidian's own `requestUrl`.
 *
 * The engine speaks plain `fetch` and nothing else, so this is the whole of what makes it
 * an Obsidian client. `requestUrl` is what the plugin API offers instead: it goes out
 * through the app rather than the WebView, which is why a server on another origin answers
 * at all — a browser `fetch` would need CORS on desktop and would be refused outright on
 * mobile.
 */

/**
 * `requestUrl` as this module needs it. Obsidian's own is assignable to it: the real one
 * also takes a bare url string and answers a promise carrying `arrayBuffer`/`json`/`text`
 * of its own, neither of which is used here — and a narrower type is one a test can stand
 * in for with a plain async function.
 */
export type RequestUrlFn = (request: RequestUrlParam) => Promise<RequestUrlResponse>

/** Statuses the fetch spec says carry no body; `Response` refuses to be built with one. */
const BODILESS_STATUS = new Set([101, 204, 205, 304])

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
    const body = bodyOf(init?.body)
    // Obsidian sends `contentType` as the header of that name, and some builds ignore one
    // passed in `headers` alone. Sending both says the same thing twice, which is safe.
    const contentType = headers['content-type']

    // The url only: the headers carry the device token, and this line goes to a console
    // anyone can open.
    console.debug(`[abele-sync] ${method} ${url}`)
    const answer = await requestUrl({
      url,
      method,
      headers,
      throw: false,
      ...(body === undefined ? {} : { body }),
      ...(contentType === undefined ? {} : { contentType }),
    })

    // A HEAD answers with headers and nothing else — `hasBlob` asks with one — and the
    // bodiless statuses are refused by the `Response` constructor if handed any bytes.
    const bodiless = method === 'HEAD' || BODILESS_STATUS.has(answer.status)
    return new Response(bodiless ? null : bytesOf(answer), {
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

/** What was asked for, however the caller named it. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
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

/** The answer's bytes. A body that cannot be read is an empty one, not a failed request. */
function bytesOf(answer: RequestUrlResponse): ArrayBuffer {
  try {
    return answer.arrayBuffer ?? new ArrayBuffer(0)
  } catch {
    return new ArrayBuffer(0)
  }
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
