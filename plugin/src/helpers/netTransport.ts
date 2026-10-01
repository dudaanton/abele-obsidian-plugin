import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'

export type RequestTransport = (params: RequestUrlParam) => Promise<RequestUrlResponse>

interface NetResponse {
  statusCode: number
  headers: Record<string, string | string[]>
  on(event: 'data', listener: (chunk: Uint8Array) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
}
interface NetRequest {
  on(event: 'response', listener: (response: NetResponse) => void): void
  on(event: 'redirect', listener: (status: number, method: string, url: string) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'login', listener: (info: unknown, callback: () => void) => void): void
  write(data: string | Uint8Array): void
  end(): void
  abort(): void
}
export interface DesktopNet {
  request(options: {
    url: string
    method: string
    headers: Record<string, string>
    redirect: 'manual'
  }): NetRequest
}

function response(
  status: number,
  headers: Record<string, string>,
  bytes = new Uint8Array(0)
): RequestUrlResponse {
  return {
    status,
    headers,
    arrayBuffer: bytes.slice().buffer,
    get text() {
      return new TextDecoder().decode(bytes)
    },
    get json(): unknown {
      return JSON.parse(new TextDecoder().decode(bytes))
    },
  }
}

/** Electron redirects are returned unfollowed. Uses the same proxy stack as Obsidian. */
export function desktopTransport(net: DesktopNet): RequestTransport {
  return (params) =>
    new Promise((resolve, reject) => {
      let settled = false
      const finish = (action: () => void) => {
        if (settled) return
        settled = true
        action()
      }
      const req = net.request({
        url: params.url,
        method: params.method ?? 'GET',
        redirect: 'manual',
        headers: {
          ...params.headers,
          ...(params.contentType ? { 'Content-Type': params.contentType } : {}),
        },
      })
      req.on('login', (_info, callback) => callback())
      req.on('error', (error) => finish(() => reject(error)))
      req.on('redirect', (status, _method, url) => {
        finish(() => resolve(response(status, { location: url })))
        req.abort()
      })
      req.on('response', (incoming) => {
        const chunks: Uint8Array[] = []
        let size = 0
        // Register end before data: remote event registration is asynchronous, and data starts flow.
        incoming.on('error', (error) => finish(() => reject(error)))
        incoming.on('end', () => {
          if (settled) return
          const bytes = new Uint8Array(size)
          let at = 0
          for (const chunk of chunks) {
            bytes.set(chunk, at)
            at += chunk.length
          }
          const headers = Object.fromEntries(
            Object.entries(incoming.headers).map(([k, v]) => [
              k.toLowerCase(),
              Array.isArray(v) ? v.join(', ') : v,
            ])
          )
          finish(() => resolve(response(incoming.statusCode, headers, bytes)))
        })
        incoming.on('data', (chunk) => {
          if (settled) return
          const copy = new Uint8Array(chunk)
          chunks.push(copy)
          size += copy.length
        })
      })
      if (typeof params.body === 'string') req.write(params.body)
      else if (params.body) req.write(new Uint8Array(params.body))
      req.end()
    })
}

export function getDesktopNet(): DesktopNet | null {
  try {
    const require = (window as unknown as { require?: (name: string) => unknown }).require
    const electron = require?.('electron') as { remote?: { net?: DesktopNet } } | undefined
    return electron?.remote?.net ?? null
  } catch {
    return null
  }
}
