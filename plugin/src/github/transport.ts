/** Single-hop adapters. Obsidian requestUrl follows redirects with Authorization unchanged. */
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

interface NativeHttp {
  request(
    options: Record<string, unknown>
  ): Promise<{ status: number; headers: Record<string, string>; data: unknown }>
}

function response(
  status: number,
  headers: Record<string, string>,
  bytes: Uint8Array
): RequestUrlResponse {
  const text = new TextDecoder().decode(bytes)
  return {
    status,
    headers,
    text,
    arrayBuffer: bytes.slice().buffer,
    get json() {
      return JSON.parse(text) as unknown
    },
  }
}

/** CapacitorHttp (not App.requestUrl) exposes the native redirect switch on iOS/Android. */
export async function nativeRequest(
  request: RequestUrlParam,
  bridge: NativeHttp
): Promise<RequestUrlResponse> {
  const r = await bridge.request({
    url: request.url,
    method: request.method ?? 'GET',
    headers: request.headers ?? {},
    data: request.body,
    responseType: 'arraybuffer',
    disableRedirects: true,
    connectTimeout: 30_000,
    readTimeout: 60_000,
  })
  // CapacitorHttp decodes application/json itself on iOS even when arraybuffer was requested.
  const type =
    Object.entries(r.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ??
    ''
  if (type.toLowerCase().includes('json')) {
    return response(r.status, r.headers ?? {}, new TextEncoder().encode(JSON.stringify(r.data)))
  }
  if (r.data !== undefined && r.data !== null && typeof r.data !== 'string') {
    throw new Error('Native HTTP returned an unsupported binary response.')
  }
  const binary = atob((r.data as string | undefined) ?? '')
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return response(r.status, r.headers ?? {}, bytes)
}

function nodeBuiltin(name: string): unknown {
  const hostRequire = (window as typeof window & { require?: (name: string) => unknown }).require
  // Prefer the actual desktop host. Obsidian's emulated-mobile plugin loader displays an
  // error Notice before returning null; invoking it first floods the code view with overlays.
  if (hostRequire) return hostRequire(name)
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Runtime-only Node adapter; static imports break mobile.
  return require(name)
}

/** Node HTTP does not follow redirects; keep this request bound to its exact URL. */
function desktopRequest(request: RequestUrlParam): Promise<RequestUrlResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url)
    // Runtime-only Node adapter: importing it statically breaks mobile plugin loading.
    const protocol = url.protocol === 'https:' ? 'https' : 'http'
    const http = nodeBuiltin(protocol) as typeof import('node:http')
    // Obsidian's module loader returns null for Node built-ins during desktop phone emulation;
    // the host window still has Node. A real phone never takes this desktop adapter.
    if (!http?.request) {
      reject(new Error('Node HTTP is unavailable.'))
      return
    }
    const call = http.request(
      url,
      { method: request.method ?? 'GET', headers: request.headers },
      (r) => {
        const chunks: Uint8Array[] = []
        let length = 0
        r.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk)
          length += chunk.length
        })
        r.on('error', reject)
        r.on('end', () => {
          const bytes = new Uint8Array(length)
          let at = 0
          for (const chunk of chunks) {
            bytes.set(chunk, at)
            at += chunk.length
          }
          const headers = Object.fromEntries(
            Object.entries(r.headers)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])
          )
          try {
            const encoding = headers['content-encoding']?.toLowerCase().trim()
            let decoded = bytes
            if (encoding && encoding !== 'identity') {
              const zlib = nodeBuiltin('zlib') as typeof import('node:zlib')
              for (const method of encoding
                .split(',')
                .map((s) => s.trim())
                .reverse()) {
                if (method === 'gzip' || method === 'x-gzip')
                  decoded = new Uint8Array(zlib.gunzipSync(decoded))
                else if (method === 'deflate') decoded = new Uint8Array(zlib.inflateSync(decoded))
                else if (method === 'br')
                  decoded = new Uint8Array(zlib.brotliDecompressSync(decoded))
                else if (method !== 'identity')
                  throw new Error('Unsupported HTTP content encoding.')
              }
            }
            resolve(response(r.statusCode ?? 0, headers, decoded))
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    call.setTimeout(60_000, () => call.destroy(new Error('Request timed out')))
    call.on('error', reject)
    if (request.body !== undefined)
      call.write(typeof request.body === 'string' ? request.body : new Uint8Array(request.body))
    call.end()
  })
}

export function singleHopRequest(request: RequestUrlParam): Promise<RequestUrlResponse> {
  const bridge = (
    window as typeof window & {
      Capacitor?: { isNativePlatform?(): boolean; Plugins?: { CapacitorHttp?: NativeHttp } }
    }
  ).Capacitor
  if (bridge?.isNativePlatform?.()) {
    if (bridge.Plugins?.CapacitorHttp) return nativeRequest(request, bridge.Plugins.CapacitorHttp)
    return Promise.reject(new Error('A redirect-controlled native HTTP transport is unavailable.'))
  }
  if (typeof require === 'function') return desktopRequest(request)
  // Never fall back to the unsafe auto-redirecting transport if a native bridge is absent.
  return Promise.reject(new Error('A redirect-controlled HTTP transport is unavailable.'))
}
