import { isNativeForge } from '@/forge/native'
import type { Deployment, ReadResult } from './model'
import { deployment, deploymentKey } from './identity'
import {
  checkedRead,
  type CredentialSession,
  type HttpTransport,
  type HttpResponse,
} from './transport'

export class ForgejoError extends Error {
  constructor(
    readonly status: number,
    service = 'Forgejo'
  ) {
    super(`${service} refused the request (${status}).`)
  }
}
export class ForgejoUnknownWrite extends Error {
  constructor() {
    super('The write outcome is unknown. Check the service before submitting again.')
    this.name = 'ForgejoUnknownWrite'
  }
}
const uncertainWrites = new Set<string>()

/** Native Forgejo REST reads. Transport is single-hop and never follows server links. */
export class ForgejoClient {
  private get service(): string {
    return this.deployment.kind === 'gitea' ? 'Gitea' : 'Forgejo'
  }
  get hasToken(): boolean {
    return !!this.token
  }
  guarded(assertAccess: () => void): ForgejoClient {
    const session = this.session
    return new ForgejoClient(
      this.deployment,
      {
        ...session,
        assertCurrent() {
          session.assertCurrent()
          assertAccess()
        },
      },
      this.transport,
      this.token
    )
  }
  constructor(
    readonly deployment: Deployment,
    readonly session: CredentialSession,
    private readonly transport: HttpTransport,
    private readonly token: string
  ) {
    if (
      !isNativeForge(deployment.kind) ||
      deploymentKey(deployment) !== deploymentKey(this.normalized(deployment))
    )
      throw new Error('Invalid Forgejo deployment.')
  }

  private normalized(value: Deployment): Deployment {
    return deployment(value.kind, value.webBase)
  }

  async get<T>(path: string): Promise<T> {
    return this.read<T>(path, 'json')
  }

  async text(path: string): Promise<string> {
    return this.read<string>(path, 'text')
  }

  async bytes(path: string): Promise<ArrayBuffer> {
    return this.read<ArrayBuffer>(path, 'bytes')
  }
  async avatar(address: string): Promise<string | null> {
    return checkedRead(this.session, async () => {
      let url: URL
      try {
        url = new URL(address)
      } catch {
        return null
      }
      const base = new URL(this.deployment.webBase),
        prefix = base.pathname.replace(/\/$/, '')
      if (
        url.origin !== base.origin ||
        url.username ||
        url.password ||
        [...url.searchParams].some(
          ([key, value]) => key !== 'size' || !/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1024
        ) ||
        url.searchParams.getAll('size').length > 1 ||
        url.hash ||
        !url.pathname.startsWith(`${prefix}/avatars/`)
      )
        return null
      try {
        const response = await this.transport({
          url: url.href,
          headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp' },
          throw: false,
        })
        const bytes = new Uint8Array(response.arrayBuffer)
        if (response.status !== 200 || bytes.length > 65536) return null
        const magic = String.fromCharCode(...bytes.slice(0, 12))
        const mime = magic.startsWith('\x89PNG\r\n\x1a\n')
          ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? 'image/jpeg'
            : magic.startsWith('GIF8')
              ? 'image/gif'
              : magic.startsWith('RIFF') && magic.slice(8) === 'WEBP'
                ? 'image/webp'
                : ''
        return mime
          ? `data:${mime};base64,${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`
          : null
      } catch {
        return null
      }
    })
  }
  async write<T = void>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    response: 'json' | 'none' = 'json',
    retrySafe = false
  ): Promise<T> {
    this.session.assertCurrent()
    // An uncertain mutation belongs to the operation, even after credentials are refreshed.
    const key = JSON.stringify([
      deploymentKey(this.deployment),
      this.session.connectionId,
      method,
      path,
      body,
    ])
    // Known idempotent PATCH/PUT operations can be explicitly retried, never automatically.
    const retainUnknown = !retrySafe || method === 'POST'
    if (retainUnknown && uncertainWrites.has(key)) throw new ForgejoUnknownWrite()
    if (retainUnknown && uncertainWrites.size >= 256)
      throw new Error(
        'Too many unverified write outcomes. Check the service before starting another write.'
      )
    try {
      return await this.read<T>(path, response, { method, body })
    } catch (error) {
      if (error instanceof ForgejoError && error.status >= 400 && error.status < 500) throw error
      if (retainUnknown) uncertainWrites.add(key)
      throw new ForgejoUnknownWrite()
    }
  }

  private async read<T>(
    path: string,
    mode: 'json' | 'text' | 'bytes' | 'none',
    write?: { method: string; body?: unknown }
  ): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\#\r\n]/.test(path))
      throw new Error('Invalid Forgejo API path.')
    const parts = path.split('?')[0].split('/')
    if (
      parts.some((part) => {
        const decoded = decodeURIComponent(part)
        return (
          decoded.split('/').some((entry) => entry === '.' || entry === '..') ||
          decoded.includes('\\') ||
          [...decoded].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        )
      })
    )
      throw new Error('Invalid Forgejo API path.')
    const url = new URL(`${this.deployment.apiBase}${path}`)
    if ([...url.searchParams.keys()].some((key) => /token|authorization|password/i.test(key)))
      throw new Error('Credentials cannot appear in an API URL.')
    return checkedRead(this.session, async () => {
      const headers: Record<string, string> = {
        Accept:
          mode === 'bytes'
            ? 'application/octet-stream'
            : mode === 'text'
              ? 'text/plain'
              : 'application/json',
      }
      if (this.token) headers.Authorization = `token ${this.token}`
      if (write?.body !== undefined) headers['Content-Type'] = 'application/json'
      let result: HttpResponse
      try {
        result = await this.transport({
          url: url.href,
          headers,
          throw: false,
          ...(write
            ? {
                method: write.method,
                ...(write.body !== undefined ? { body: JSON.stringify(write.body) } : {}),
              }
            : {}),
        })
      } catch {
        throw new Error(`Could not reach the ${this.service} service.`)
      }
      if (result.status >= 300 && result.status < 400)
        throw new Error(
          `${this.service} redirected the request; check the configured server address.`
        )
      if (result.status < 200 || result.status >= 300)
        throw new ForgejoError(result.status, this.service)
      if (mode === 'none' || result.status === 204) return undefined
      try {
        return (
          mode === 'bytes' ? result.arrayBuffer : mode === 'text' ? result.text : result.json
        ) as T
      } catch {
        throw new Error(`${this.service} returned an unreadable response.`)
      }
    })
  }

  async pages<T>(path: string, limit = 50, maxPages = 20): Promise<ReadResult<T[]>> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(maxPages) ||
      maxPages < 1
    )
      throw new Error('Invalid Forgejo pagination limit.')
    const value: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      const rows = await this.get<T[]>(
        `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&page=${page}`
      )
      if (!Array.isArray(rows)) throw new Error('Invalid Forgejo page response.')
      value.push(...rows)
      if (rows.length < limit) return { value, complete: true, notes: [] }
    }
    return { value, complete: false, notes: ['More results are available on this service.'] }
  }
}
