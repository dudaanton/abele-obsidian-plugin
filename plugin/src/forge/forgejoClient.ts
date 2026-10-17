import type { Deployment, ReadResult } from './model'
import { deployment, deploymentKey } from './identity'
import {
  checkedRead,
  type CredentialSession,
  type HttpTransport,
  type HttpResponse,
} from './transport'

export class ForgejoError extends Error {
  constructor(readonly status: number) {
    super(`Forgejo refused the request (${status}).`)
  }
}

/** Native Forgejo REST reads. Transport is single-hop and never follows server links. */
export class ForgejoClient {
  constructor(
    readonly deployment: Deployment,
    readonly session: CredentialSession,
    private readonly transport: HttpTransport,
    private readonly token: string
  ) {
    if (
      deployment.kind !== 'forgejo' ||
      deploymentKey(deployment) !== deploymentKey(this.normalized(deployment))
    )
      throw new Error('Invalid Forgejo deployment.')
  }

  private normalized(value: Deployment): Deployment {
    return deployment('forgejo', value.webBase)
  }

  async get<T>(path: string): Promise<T> {
    return this.read<T>(path, false)
  }

  async text(path: string): Promise<string> {
    return this.read<string>(path, true)
  }

  private async read<T>(path: string, text: boolean): Promise<T> {
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
      const headers: Record<string, string> = { Accept: text ? 'text/plain' : 'application/json' }
      if (this.token) headers.Authorization = `token ${this.token}`
      let result: HttpResponse
      try {
        result = await this.transport({ url: url.href, headers, throw: false })
      } catch {
        throw new Error('Could not reach the Forgejo service.')
      }
      if (result.status >= 300 && result.status < 400)
        throw new Error('Forgejo redirected the request; check the configured server address.')
      if (result.status < 200 || result.status >= 300) throw new ForgejoError(result.status)
      try {
        return (text ? result.text : result.json) as T
      } catch {
        throw new Error('Forgejo returned an unreadable response.')
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
