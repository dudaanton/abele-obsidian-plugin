/**
 * Read-only access to the GitHub API.
 *
 * Every request goes through Obsidian's `requestUrl`: it is not subject to CORS and it works on a
 * phone, where `fetch` to api.github.com from the app's origin would be refused.
 *
 * Responses are kept in memory with their ETag and asked about again with `If-None-Match`. An
 * unchanged answer is a 304 with no body, and GitHub does not count it against the hourly limit —
 * which is what makes reopening the same pull request free.
 */
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian'
import type { Endpoints } from './urls'
import {
  explainRefusal,
  header,
  refusalText,
  tokenKind,
  type Refusal,
  type RefusalKind,
  type TokenKind,
} from './refusal'

export type Requester = (request: RequestUrlParam) => Promise<RequestUrlResponse>

export type GithubErrorKind = RefusalKind

export class GithubError extends Error {
  /** The cause alone, without the fix or GitHub's words — for a row that shows them apart. */
  readonly reason: string
  readonly fix?: string
  readonly needed?: string
  readonly githubSaid?: string
  readonly graphqlNote?: string

  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    readonly status = 0,
    refusal?: Refusal
  ) {
    super(refusal ? refusalText(refusal) : message)
    this.name = 'GithubError'
    this.reason = refusal?.reason ?? message
    this.fix = refusal?.fix
    this.needed = refusal?.needed
    this.githubSaid = refusal?.githubSaid
    this.graphqlNote = refusal?.graphql
  }

  /** The refusal again, to be said differently or with more to it. */
  get refusal(): Refusal {
    return {
      kind: this.kind,
      reason: this.reason,
      fix: this.fix,
      needed: this.needed,
      githubSaid: this.githubSaid,
      graphql: this.graphqlNote,
    }
  }
}

/**
 * What to tell a person about a refused request: the cause first, naming the request, then what
 * to do, the permission it needed and GitHub's own words. See `refusal.ts` for the causes.
 */
export function errorFor(
  status: number,
  headers: Record<string, string> | undefined,
  body: unknown,
  hasToken: boolean,
  what = 'this item',
  noTokenReason?: string
): GithubError {
  const raw = typeof body === 'object' && body ? (body as { message?: unknown }).message : ''
  const message = typeof raw === 'string' ? raw : ''
  const refusal = explainRefusal({ status, headers, message, hasToken, what, noTokenReason })
  return new GithubError(refusal.kind, refusal.reason, status, refusal)
}

/** Whether a token went with the requests, and what kind — never the token itself. */
export interface TokenInfo {
  attached: boolean
  length: number
  kind: TokenKind
}

/** One answer as it came, for the access check, which reads headers a normal read ignores. */
export interface Probe<T = unknown> {
  status: number
  headers: Record<string, string>
  body: T | null
  /** Set when the status is not a success. */
  error?: GithubError
}

interface Cached {
  etag: string
  body: unknown
}

export interface GetOptions {
  /** Media type. `raw` asks for a file's bytes as text rather than a JSON wrapper. */
  accept?: string
  /** Read the answer as text rather than JSON. */
  text?: boolean
  /** Named in an error, as in "not allowed to read <what>". */
  what?: string
}

/** Pages a list is read to before stopping. 1000 comments is past anything worth scrolling. */
const MAX_PAGES = 10
const PER_PAGE = 100

export class GithubClient {
  private cache = new Map<string, Cached>()

  private readonly token: string

  constructor(
    readonly endpoints: Endpoints,
    token: string,
    private readonly request: Requester = (r) => requestUrl(r),
    /**
     * Why no token goes with these requests although one is set — a link on github.com while
     * the token belongs to an Enterprise server. Said in every refusal, so the token is not
     * blamed for a request it never went with.
     */
    readonly noTokenReason?: string
  ) {
    // A token pasted with a trailing newline or space is still the token; sent as it is, it is
    // not, and GitHub answers 401 for what looks like a perfectly good token.
    this.token = token.trim()
  }

  get hasToken(): boolean {
    return !!this.token
  }

  private refusal(
    status: number,
    headers: Record<string, string> | undefined,
    body: unknown,
    what?: string
  ): GithubError {
    return errorFor(status, headers, body, this.hasToken, what, this.noTokenReason)
  }

  get tokenInfo(): TokenInfo {
    return { attached: this.hasToken, length: this.token.length, kind: tokenKind(this.token) }
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: accept }
    // Enterprise Server before 3.9 answers 400 to an API version it does not know, and every
    // version that knows the header takes this one as its default anyway.
    if (!this.endpoints.server) headers['X-GitHub-Api-Version'] = '2022-11-28'
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    return headers
  }

  private async send(request: RequestUrlParam): Promise<RequestUrlResponse> {
    try {
      return await this.request({ ...request, throw: false })
    } catch (e) {
      throw new GithubError(
        'network',
        `Could not reach ${new URL(request.url).host}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  /** One REST resource, answered from memory when GitHub says it has not changed. */
  async get<T>(path: string, options: GetOptions = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.endpoints.api}${path}`
    const accept = options.accept ?? 'application/vnd.github+json'
    const key = `${accept} ${url}`
    const cached = this.cache.get(key)

    const headers = this.headers(accept)
    if (cached) headers['If-None-Match'] = cached.etag

    const response = await this.send({ url, method: 'GET', headers })

    if (response.status === 304 && cached) return cached.body as T

    if (response.status < 200 || response.status >= 300) {
      let body: unknown = null
      try {
        body = response.json
      } catch {
        // An error page rather than JSON; the status says enough.
      }
      throw this.refusal(response.status, response.headers, body, options.what)
    }

    const body = (options.text ? response.text : response.json) as unknown
    const etag = header(response.headers, 'etag')
    if (etag) this.cache.set(key, { etag, body })
    return body as T
  }

  /** One request, uncached, answered with its status and headers whatever they are. */
  async probe<T>(path: string, options: GetOptions = {}): Promise<Probe<T>> {
    const url = path.startsWith('http') ? path : `${this.endpoints.api}${path}`
    const response = await this.send({
      url,
      method: 'GET',
      headers: this.headers(options.accept ?? 'application/vnd.github+json'),
    })
    let body: T | null = null
    try {
      body = response.json as T
    } catch {
      body = null
    }
    const headers = response.headers ?? {}
    const ok = response.status >= 200 && response.status < 300
    return {
      status: response.status,
      headers,
      body,
      error: ok ? undefined : this.refusal(response.status, headers, body, options.what),
    }
  }

  /** A list, page after page, until a short page or `MAX_PAGES`. */
  async list<T>(
    path: string,
    options: GetOptions = {}
  ): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = []
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.get<T[]>(`${path}${sep}per_page=${PER_PAGE}&page=${page}`, options)
      items.push(...batch)
      if (batch.length < PER_PAGE) return { items, complete: true }
    }
    return { items, complete: false }
  }

  /** GraphQL, which is the only way to discussions. It always needs a token. */
  async graphql<T>(query: string, variables: Record<string, unknown>, what?: string): Promise<T> {
    if (!this.token) {
      throw new GithubError(
        'auth',
        'GitHub only shows discussions to a signed-in request. Add a token in Abele settings → GitHub.'
      )
    }
    const response = await this.send({
      url: this.endpoints.graphql,
      method: 'POST',
      headers: { ...this.headers('application/json'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })

    let body: { data?: T; errors?: { type?: string; message: string }[] } | null = null
    try {
      body = response.json
    } catch {
      body = null
    }

    if (response.status < 200 || response.status >= 300) {
      throw errorFor(response.status, response.headers, body, true, what)
    }

    const errors = body?.errors ?? []
    if (errors.length > 0) {
      const first = errors[0]
      // GraphQL answers 200 with the refusal inside; its message is what says which refusal.
      if (first.type === 'NOT_FOUND') throw errorFor(404, response.headers, first, true, what)
      if (first.type === 'FORBIDDEN') throw errorFor(403, response.headers, first, true, what)
      throw new GithubError('other', `GitHub: ${errors.map((e) => e.message).join('; ')}`)
    }
    if (!body?.data) throw new GithubError('other', 'GitHub sent back an empty answer.')
    return body.data
  }
}
