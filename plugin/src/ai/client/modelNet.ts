import type { DesktopNet } from '@/helpers/netTransport'
import { checkRequest } from '@/helpers/http'
import type { SessionNet } from '@/sync/desktopNet'

/** A renderer-owned stream over Electron networking, with explicit credential-safe redirects. */
export function getModelNet(net: DesktopNet): SessionNet {
  return {
    session: {
      fetch: (url, init) =>
        desktopModelFetch(
          net,
          typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
          init ?? {}
        ),
    },
    bytes: (bytes) => new Uint8Array(bytes),
    body: (bytes) => new Uint8Array(bytes),
    controller: () => new AbortController(),
  }
}

async function desktopModelFetch(
  net: DesktopNet,
  url: string,
  init: RequestInit
): Promise<Response> {
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value
  })
  let current = { url, method: init.method ?? 'GET', headers, body: init.body }
  const credentials =
    /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-subscription-token)$/i
  const carried = [
    ...checkRequest({ url, headers }),
    ...Object.entries(headers).flatMap(([name, value]) => {
      const bare = value.replace(/^(Bearer|Basic)\s+/i, '')
      return credentials.test(name) && bare.trim() ? [value, bare] : []
    }),
  ]
  const hasKey = (text: string) => {
    let decoded = text
    try {
      decoded = decodeURIComponent(text)
    } catch {
      /* Malformed escapes stay literal. */
    }
    return carried.some((key) => key && (text.includes(key) || decoded.includes(key)))
  }
  for (let hop = 0; ; hop++) {
    const response = await streamRequest(net, current, init.signal)
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response
    await response.body?.cancel()
    if (hop >= 20) throw new Error('Too many model request redirects')
    const next = new URL(location, current.url)
    if (!['https:', 'http:'].includes(next.protocol) || next.username || next.password)
      throw new Error('Invalid model request redirect')
    const changed = next.origin !== new URL(current.url).origin
    const toGet =
      (response.status === 303 && current.method !== 'HEAD') ||
      ([301, 302].includes(response.status) && current.method === 'POST')
    const nextHeaders = { ...current.headers }
    if (toGet)
      for (const name of Object.keys(nextHeaders))
        if (/^content-(type|length)$/i.test(name)) delete nextHeaders[name]
    if (changed) {
      for (const [name, value] of Object.entries(nextHeaders))
        if (credentials.test(name) || hasKey(value)) delete nextHeaders[name]
      if (hasKey(next.href) || (!toGet && typeof current.body === 'string' && hasKey(current.body)))
        throw new Error('A model redirect cannot carry a saved key in its address or body')
    }
    current = {
      url: next.href,
      method: toGet ? 'GET' : current.method,
      headers: nextHeaders,
      body: toGet ? undefined : current.body,
    }
    checkRequest({ url: current.url, headers: current.headers })
  }
}

function streamRequest(
  net: DesktopNet,
  input: { url: string; method: string; headers: Record<string, string>; body?: BodyInit | null },
  signal?: AbortSignal | null
): Promise<Response> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    let finished = false
    const finish = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', abort)
      return true
    }
    const fail = (error: unknown) => {
      if (!finish()) return
      const reason = error instanceof Error ? error : new Error('Model network request failed')
      if (stream) stream.error(reason)
      else reject(reason)
    }
    const req = net.request({
      url: input.url,
      method: input.method,
      headers: input.headers,
      redirect: 'manual',
    })
    const abort = () => {
      fail(signal?.reason ?? new DOMException('The request was aborted', 'AbortError'))
      req.abort()
    }
    signal?.addEventListener('abort', abort, { once: true })
    req.on('login', (_info, callback) => callback())
    req.on('error', fail)
    req.on('redirect', (status, _method, location) => {
      if (!finish()) return
      resolve(new Response(null, { status, headers: { location } }))
      req.abort()
    })
    req.on('response', (incoming) => {
      if (finished) return
      incoming.pause()
      const headers = Object.fromEntries(
        Object.entries(incoming.headers).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.join(', ') : value,
        ])
      )
      const body = new ReadableStream<Uint8Array>(
        {
          start(controller) {
            stream = controller
            incoming.on('error', fail)
            incoming.on('end', () => {
              if (finish()) controller.close()
            })
            incoming.on('data', (chunk) => {
              if (finished) return
              incoming.pause()
              controller.enqueue(new Uint8Array(chunk))
            })
          },
          pull() {
            incoming.resume()
          },
          cancel() {
            finish()
            req.abort()
          },
        },
        { highWaterMark: 0 }
      )
      if ([204, 205, 304].includes(incoming.statusCode)) {
        void body.cancel()
        resolve(new Response(null, { status: incoming.statusCode, headers }))
      } else resolve(new Response(body, { status: incoming.statusCode, headers }))
    })
    if (typeof input.body === 'string') req.write(input.body)
    else if (input.body) {
      fail(new TypeError('Model streaming requires a text request body'))
      req.abort()
      return
    }
    req.end()
  })
}
