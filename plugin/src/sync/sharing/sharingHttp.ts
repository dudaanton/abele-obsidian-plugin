import { OWNER_SHARING_ENABLED } from './folderSharing'
export class SharingHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super('Sharing API refused request: ' + code)
  }
}
export interface SharingHttpOptions {
  baseUrl: string
  fetch: typeof fetch
  enabled?: () => boolean
}
/** Credentials are sent only through the caller's existing non-following transport. */
export class SharingHttp {
  readonly baseUrl: string
  constructor(private readonly options: SharingHttpOptions) {
    const u = new URL(options.baseUrl)
    if (
      u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    )
      throw new Error('Sharing requires HTTPS or local disposable transport')
    if (u.username || u.password || u.search || u.hash) throw new Error('Invalid sharing issuer')
    this.baseUrl = u.href.replace(/\/+$/, '')
  }
  fence() {
    if (!(this.options.enabled ?? (() => OWNER_SHARING_ENABLED))())
      throw new Error('Sharing HTTP activation is disabled')
  }
  async json(method: string, path: string, token: string | null, body?: unknown): Promise<unknown> {
    this.fence()
    if (!path.startsWith('/v1/')) throw new Error('Invalid sharing route')
    const headers: Record<string, string> = { 'cache-control': 'no-cache, no-store' }
    if (token) headers.authorization = 'Bearer ' + token
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response: Response
    try {
      response = await this.options.fetch(this.baseUrl + path, {
        method,
        headers,
        redirect: 'manual',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new SharingHttpError('network_unavailable', 0)
    }
    this.fence()
    if (response.status >= 300 && response.status < 400)
      throw new SharingHttpError('redirect_refused', response.status)
    if (!response.ok) {
      let code = 'request_failed'
      try {
        const value = (await response.json()) as { error?: { code?: unknown } }
        if (typeof value.error?.code === 'string' && /^[a-z_]+$/.test(value.error.code))
          code = value.error.code
      } catch {
        // Retain only the constant diagnostic, never raw response bytes/credentials.
      }
      throw new SharingHttpError(code, response.status)
    }
    return response.json()
  }
}
