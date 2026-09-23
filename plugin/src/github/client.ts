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

export type Requester = (request: RequestUrlParam) => Promise<RequestUrlResponse>

export type GithubErrorKind =
  | 'auth'
  | 'sso'
  | 'forbidden'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'other'

export class GithubError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    readonly status = 0
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

const header = (headers: Record<string, string> | undefined, name: string): string | undefined => {
  if (!headers) return undefined
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}

/**
 * What to tell a person about a refused request.
 *
 * A fine-grained token is refused in ways that look alike from outside and need different fixes,
 * so each one says which: a 404 from a private repository is how GitHub says "this token cannot
 * see it", and a 403 carrying `X-GitHub-SSO` is an organisation waiting for the token to be
 * authorised for single sign-on.
 */
export function errorFor(
  status: number,
  headers: Record<string, string> | undefined,
  body: unknown,
  hasToken: boolean,
  what = 'this'
): GithubError {
  const raw = typeof body === 'object' && body ? (body as { message?: unknown }).message : ''
  const message = typeof raw === 'string' ? raw : ''

  if (status === 401) {
    return new GithubError(
      'auth',
      hasToken
        ? 'GitHub did not accept the token. It may be mistyped, expired or revoked — set a new one in Abele settings → GitHub.'
        : 'GitHub asks for a token to show this. Add one in Abele settings → GitHub.',
      status
    )
  }

  const remaining = header(headers, 'x-ratelimit-remaining')
  if (status === 429 || ((status === 403 || status === 429) && remaining === '0')) {
    const reset = Number(header(headers, 'x-ratelimit-reset'))
    const when = reset ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : ''
    return new GithubError(
      'rate-limit',
      (hasToken
        ? 'The GitHub request limit for this token is used up.'
        : 'The GitHub limit for requests without a token (60 an hour) is used up. A token raises it to 5000.') +
        when,
      status
    )
  }

  if (status === 403) {
    const sso = header(headers, 'x-github-sso')
    if (sso) {
      const url = /url=([^;\s]+)/.exec(sso)?.[1]
      return new GithubError(
        'sso',
        'This organisation uses single sign-on, and the token has not been authorised for it.' +
          (url ? ` Authorise it here: ${url}` : ' Authorise it on GitHub under Settings → Tokens.'),
        status
      )
    }
    return new GithubError(
      'forbidden',
      `The token is not allowed to read ${what}. A fine-grained token needs this repository in its list and read access to Contents, Issues, Pull requests and Discussions` +
        (message ? ` (GitHub: ${message})` : '.'),
      status
    )
  }

  if (status === 404) {
    return new GithubError(
      'not-found',
      hasToken
        ? `GitHub found nothing here. Either it does not exist, or the token cannot see this repository — a fine-grained token only sees the repositories it was given.`
        : `GitHub found nothing here. If the repository is private, add a token in Abele settings → GitHub.`,
      status
    )
  }

  return new GithubError(
    'other',
    `GitHub answered ${status}${message ? `: ${message}` : ''}.`,
    status
  )
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

  constructor(
    readonly endpoints: Endpoints,
    private readonly token: string,
    private readonly request: Requester = (r) => requestUrl(r)
  ) {}

  get hasToken(): boolean {
    return !!this.token
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    }
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
      throw errorFor(response.status, response.headers, body, this.hasToken, options.what)
    }

    const body = (options.text ? response.text : response.json) as unknown
    const etag = header(response.headers, 'etag')
    if (etag) this.cache.set(key, { etag, body })
    return body as T
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
      if (first.type === 'NOT_FOUND') throw errorFor(404, response.headers, null, true, what)
      if (first.type === 'FORBIDDEN') throw errorFor(403, response.headers, null, true, what)
      throw new GithubError('other', `GitHub: ${errors.map((e) => e.message).join('; ')}`)
    }
    if (!body?.data) throw new GithubError('other', 'GitHub sent back an empty answer.')
    return body.data
  }
}
