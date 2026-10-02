/**
 * The API client against a scripted `requestUrl`.
 *
 * What matters: the token is sent only as a header, an unchanged answer comes from memory, and
 * every refusal says what to do about it rather than a bare status.
 */
import { describe, it, expect, vi } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient, GithubError, errorFor, anonymousGithubRate } from '@/github/client'
import { endpoints } from '@/github/urls'
import {
  loadBlob,
  loadDiscussion,
  loadIssue,
  loadPull,
  loadPullFiles,
  loadCommit,
} from '@/github/api'

it('bounds cached API responses and evicts the least recently used first', async () => {
  const request = vi.fn(async (req: RequestUrlParam) =>
    respond({
      status: req.headers?.['If-None-Match'] ? 304 : 200,
      headers: { etag: 'sample-version' },
      json: { sample: true },
    })
  )
  const client = new GithubClient(endpoints(''), '', request)
  for (let index = 0; index < 256; index++) await client.get(`/sample/${index}`)
  await client.get('/sample/0')
  await client.get('/sample/256')
  await client.get('/sample/1')
  expect(request.mock.calls.at(-1)![0].headers?.['If-None-Match']).toBeUndefined()
  await client.get('/sample/0')
  expect(request.mock.calls.at(-1)![0].headers?.['If-None-Match']).toBe('sample-version')
})

it('returns oversized API replies without retaining their bodies in the cache', async () => {
  const text = 'x'.repeat(16 * 1024 * 1024 + 1)
  const request = vi.fn(async () => respond({ text, headers: { etag: 'sample-large-version' } }))
  const client = new GithubClient(endpoints(''), '', request)
  expect((await client.get<string>('/sample-large', { text: true })).length).toBe(text.length)
  await client.get('/sample-large', { text: true })
  expect(
    (request.mock.calls.at(-1) as unknown as [RequestUrlParam])[0].headers?.['If-None-Match']
  ).toBeUndefined()
})

type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }

function respond(r: Reply): RequestUrlResponse {
  return {
    status: r.status ?? 200,
    headers: r.headers ?? {},
    json: r.json,
    text: r.text ?? JSON.stringify(r.json ?? null),
    arrayBuffer: new ArrayBuffer(0),
  } as RequestUrlResponse
}

/** Answers by URL prefix; records every request. */
function fake(routes: Record<string, Reply | ((req: RequestUrlParam) => Reply)>) {
  const calls: RequestUrlParam[] = []
  const request = vi.fn(async (req: RequestUrlParam) => {
    calls.push(req)
    const path = req.url.replace('https://api.github.com', '')
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path.startsWith(k))
    if (!key) return respond({ status: 404, json: { message: 'Not Found' } })
    const route = routes[key]
    return respond(typeof route === 'function' ? route(req) : route)
  })
  return { request, calls }
}

const client = (request: ReturnType<typeof fake>['request'], token = 'tkn') =>
  new GithubClient(endpoints(''), token, request)

describe('requests', () => {
  it('keeps rate limits per client and observes even unchanged responses', async () => {
    let n = 0
    const a = client(
      vi.fn(async () =>
        respond({
          status: n++ ? 304 : 200,
          json: {},
          headers: {
            etag: 'sample',
            'X-RateLimit-Remaining': String(10 - n),
            'X-RateLimit-Limit': '5000',
            'X-RateLimit-Reset': '1800000000',
            'X-RateLimit-Resource': 'core',
          },
        })
      )
    )
    const b = client(
      vi.fn(async () =>
        respond({ json: {}, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Limit': '60' } })
      ),
      ''
    )
    await a.get('/user')
    await a.get('/user')
    await b.get('/rate_limit')
    expect(a.rate.value).toMatchObject({
      remaining: 8,
      limit: 5000,
      reset: 1800000000000,
      resource: 'core',
    })
    expect(b.rate.value).toMatchObject({ remaining: 0, limit: 60 })
    expect(anonymousGithubRate.value).toMatchObject({ remaining: 0, limit: 60 })
  })

  it('sends the token as a bearer header and asks for the pinned API version', async () => {
    const { request, calls } = fake({ '/x': { json: { ok: true } } })
    await client(request).get('/x')
    expect(calls[0].headers).toMatchObject({
      Authorization: 'Bearer tkn',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(calls[0].url).toBe('https://api.github.com/x')
    expect(calls[0].throw).toBe(false)
  })

  it('sends no Authorization header without a token', async () => {
    const { request, calls } = fake({ '/x': { json: {} } })
    await client(request, '').get('/x')
    expect(calls[0].headers).not.toHaveProperty('Authorization')
  })

  it('answers from memory when GitHub says 304', async () => {
    let n = 0
    const { request, calls } = fake({
      '/x': () => (n++ === 0 ? { json: { v: 1 }, headers: { ETag: '"e1"' } } : { status: 304 }),
    })
    const c = client(request)
    expect(await c.get('/x')).toEqual({ v: 1 })
    expect(await c.get('/x')).toEqual({ v: 1 })
    expect(calls[1].headers?.['If-None-Match']).toBe('"e1"')
  })

  it('reads a list page by page until a short page', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))
    const { request, calls } = fake({
      '/l?per_page=100&page=1': { json: page(100) },
      '/l?per_page=100&page=2': { json: page(3) },
    })
    const { items, complete } = await client(request).list('/l')
    expect(items).toHaveLength(103)
    expect(complete).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('turns a failed connection into a network error', async () => {
    const request = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    })
    await expect(client(request).get('/x')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('credential destination confinement', () => {
  const hostile = [
    'https://api.github.com.evil.test/repos/a/b',
    'https://api.github.com:444/repos/a/b',
    'http://api.github.com/repos/a/b',
    'https://user:pass@api.github.com/repos/a/b',
    'https://api.github.com@evil.test/repos/a/b',
    'https://api.github.com/repos/../..//evil',
  ]
  it.each(hostile)('rejects unsafe REST URLs before every request: %s', async (url) => {
    const { request } = fake({})
    const c = client(request)
    await expect(c.get(url)).rejects.toBeInstanceOf(GithubError)
    await expect(c.bytes(url)).rejects.toBeInstanceOf(GithubError)
    await expect(c.probe(url)).rejects.toBeInstanceOf(GithubError)
    await expect(c.call('POST', url)).rejects.toBeInstanceOf(GithubError)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not allow caller headers to override or inject authorization in any casing', async () => {
    const { request, calls } = fake({ '/x': { json: {} } })
    await client(request).call('POST', '/x', {
      headers: { authorization: 'Bearer injected', Authorization: 'Bearer injected' },
    })
    expect(
      Object.entries(calls[0].headers ?? {}).filter(([k]) => k.toLowerCase() === 'authorization')
    ).toEqual([['Authorization', 'Bearer tkn']])
    const anonymous = client(request, '')
    await anonymous.call('GET', '/x', { headers: { AUTHORIZATION: 'Bearer injected' } })
    expect(
      Object.keys(calls[1].headers ?? {}).some((k) => k.toLowerCase() === 'authorization')
    ).toBe(false)
  })

  it('accepts the Enterprise GraphQL endpoint, but not REST prefix lookalikes', async () => {
    const calls: RequestUrlParam[] = []
    const request = vi.fn(async (r: RequestUrlParam) => {
      calls.push(r)
      return respond({ json: { data: { ok: true } } })
    })
    const c = new GithubClient(endpoints('http://git.example.test:8080'), 'secret', request)
    await c.graphql('query { ok }', {})
    expect(calls[0].url).toBe('http://git.example.test:8080/api/graphql')
    expect(calls[0].headers?.Authorization).toBe('Bearer secret')
    await expect(c.get('http://git.example.test:8080/api/v3evil/repos')).rejects.toBeInstanceOf(
      GithubError
    )
    await expect(c.get('https://git.example.test:8080/api/v3/repos')).rejects.toBeInstanceOf(
      GithubError
    )
    expect(calls).toHaveLength(1)
  })

  it('never sends an avatar token to a scheme downgrade, another port, or github.com', async () => {
    const calls: RequestUrlParam[] = []
    const request = vi.fn(async (r: RequestUrlParam) => {
      calls.push(r)
      return respond({ headers: { 'content-type': 'image/png' } })
    })
    const c = new GithubClient(endpoints('https://git.example.test:8443'), 'secret', request)
    await c.image('https://avatars.git.example.test:8443/a.png')
    await c.image('http://avatars.git.example.test:8443/a.png')
    await c.image('https://avatars.git.example.test/a.png')
    await c.image('https://github.com/a.png')
    expect(calls.map((r) => r.headers?.Authorization)).toEqual([
      'Bearer secret',
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('authentication material never becomes diagnostic output', () => {
  it('redacts a server echo of the bearer token in a refusal and its metadata', async () => {
    const request = vi.fn(async () =>
      respond({
        status: 403,
        json: { message: 'Refused invented-private-token' },
        headers: { 'x-accepted-github-permissions': 'invented-private-token' },
      })
    )
    const c = client(request, 'invented-private-token')
    const result = await c.probe('/user')
    expect(JSON.stringify(result.error)).not.toContain('invented-private-token')
    expect(result.error?.message).not.toContain('invented-private-token')
  })

  it('redacts token echoes in GraphQL error messages', async () => {
    const request = vi.fn(async () =>
      respond({ json: { errors: [{ type: 'OTHER', message: 'invented-private-token' }] } })
    )
    await expect(
      client(request, 'invented-private-token').graphql('query { viewer { login } }', {})
    ).rejects.toMatchObject({ message: expect.not.stringContaining('invented-private-token') })
  })
})

describe('redirects are new requests', () => {
  it('an API redirect outside the REST boundary is refused before the second send', async () => {
    const request = vi.fn(async () =>
      respond({ status: 302, headers: { location: 'https://unrelated.example.test/private' } })
    )
    await expect(client(request).get('/private')).rejects.toMatchObject({ kind: 'other' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('a redirected archive never regains Authorization, even if it returns to the API', async () => {
    const calls: RequestUrlParam[] = []
    const request = vi.fn(async (r: RequestUrlParam) => {
      calls.push(r)
      return respond(
        calls.length === 1
          ? { status: 302, headers: { location: 'https://download.example.test/signed' } }
          : calls.length === 2
            ? { status: 302, headers: { location: 'https://api.github.com/final' } }
            : { status: 200 }
      )
    })
    await client(request).bytes('/tarball')
    expect(calls.map((r) => r.headers?.Authorization)).toEqual(['Bearer tkn', undefined, undefined])
  })

  it('never follows a redirect on a notification write', async () => {
    const request = vi.fn(async () =>
      respond({ status: 307, headers: { location: '/notifications/new' } })
    )
    await expect(client(request).call('PATCH', '/notifications')).rejects.toMatchObject({
      kind: 'other',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('refuses secure-to-insecure archive redirects', async () => {
    const request = vi.fn(async () =>
      respond({ status: 302, headers: { location: 'http://download.example.test/file' } })
    )
    await expect(client(request).bytes('/tarball')).rejects.toMatchObject({ kind: 'other' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('bounds redirect loops', async () => {
    const request = vi.fn(async () => respond({ status: 302, headers: { location: '/loop' } }))
    await expect(client(request).get('/loop')).rejects.toMatchObject({ kind: 'other' })
    expect(request).toHaveBeenCalledTimes(6)
  })
})

describe('refusals say what to do', () => {
  it('401 with a token: the token is bad', () => {
    const e = errorFor(401, {}, null, true)
    expect(e.kind).toBe('auth')
    expect(e.message).toMatch(/did not accept the token/)
  })

  it('403 with X-GitHub-SSO: authorise for single sign-on, with the link', () => {
    const e = errorFor(
      403,
      { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=1' },
      null,
      true
    )
    expect(e.kind).toBe('sso')
    expect(e.message).toContain('https://github.com/orgs/acme/sso?authorization_request=1')
  })

  it('403 with no requests left is the rate limit, not a permission', () => {
    expect(errorFor(403, { 'X-RateLimit-Remaining': '0' }, null, false).kind).toBe('rate-limit')
  })

  it('403 otherwise names the request and keeps what GitHub said', () => {
    const e = errorFor(403, {}, { message: 'Resource not accessible' }, true, 'the issue')
    expect(e.kind).toBe('forbidden')
    expect(e.message).toMatch(/^GitHub refused the issue/)
    expect(e.message).toContain('GitHub said: "Resource not accessible"')
  })

  it('404 explains that a token only sees the repositories it was given', () => {
    expect(errorFor(404, {}, null, true).message).toMatch(/selected in the token/)
    expect(errorFor(404, {}, null, false).message).toMatch(/add a token/)
  })

  it('a pull request whose reviews are refused still loads, and says it was the reviews', async () => {
    const { request } = fake({
      '/repos/o/r/pulls/7/reviews': {
        status: 403,
        json: { message: 'Resource not accessible by personal access token' },
        headers: { 'X-Accepted-GitHub-Permissions': 'pull_requests=read' },
      },
      '/repos/o/r/issues/7/comments': { json: [] },
      '/repos/o/r/pulls/7': { json: { number: 7 } },
    })
    const pull = await loadPull(client(request), {
      kind: 'pull',
      host: 'github.com',
      owner: 'o',
      repo: 'r',
      number: 7,
      tab: 'conversation',
    })
    expect(pull.commentsProblem).toMatch(
      /refused the pull request's reviews[\s\S]*Needs: Pull requests \(read\)/
    )
  })

  it('a GraphQL refusal keeps its message, so an IP allow list is named as one', async () => {
    const { request } = fake({
      '/graphql': {
        json: {
          errors: [
            {
              type: 'FORBIDDEN',
              message:
                'Although you appear to have the correct authorization credentials, the `acme` organization has an IP allow list enabled, and your IP address is not permitted to access this resource.',
            },
          ],
        },
      },
    })
    await expect(
      loadDiscussion(client(request), {
        kind: 'discussion',
        host: 'github.com',
        owner: 'o',
        repo: 'r',
        number: 1,
      })
    ).rejects.toMatchObject({ kind: 'ip-allow-list' })
  })

  it('discussions without a token fail before any request', async () => {
    const { request } = fake({})
    await expect(
      loadDiscussion(client(request, ''), {
        kind: 'discussion',
        host: 'github.com',
        owner: 'o',
        repo: 'r',
        number: 1,
      })
    ).rejects.toBeInstanceOf(GithubError)
    expect(request).not.toHaveBeenCalled()
  })
})

const repo = { host: 'github.com', owner: 'o', repo: 'r' }

describe('loaders', () => {
  it('reads an issue with its comments', async () => {
    const { request } = fake({
      '/repos/o/r/issues/5/comments': {
        json: [{ id: 9, user: { login: 'ann' }, body: 'hi', created_at: '2026-01-02' }],
      },
      '/repos/o/r/issues/5': {
        json: {
          title: 'Bug',
          number: 5,
          html_url: 'https://github.com/o/r/issues/5',
          user: { login: 'bob' },
          created_at: '2026-01-01',
          state: 'closed',
          state_reason: 'not_planned',
          labels: [{ name: 'bug', color: 'ff0000' }],
          body: 'Body',
        },
      },
    })
    const issue = await loadIssue(client(request), { kind: 'issue', ...repo, number: 5 })
    expect(issue).toMatchObject({
      title: 'Bug',
      author: 'bob',
      state: 'not planned',
      labels: [{ name: 'bug', color: 'ff0000' }],
    })
    expect(issue.comments[0]).toMatchObject({ author: 'ann', anchor: 'issuecomment-9' })
  })

  it('puts comments and reviews of a pull request on one timeline', async () => {
    const { request } = fake({
      '/repos/o/r/pulls/7/reviews': {
        json: [
          {
            id: 1,
            user: { login: 'rev' },
            body: '',
            state: 'APPROVED',
            submitted_at: '2026-01-03',
          },
          {
            id: 2,
            user: { login: 'rev' },
            body: '',
            state: 'COMMENTED',
            submitted_at: '2026-01-04',
          },
        ],
      },
      '/repos/o/r/issues/7/comments': {
        json: [{ id: 3, user: { login: 'ann' }, body: 'first', created_at: '2026-01-02' }],
      },
      '/repos/o/r/pulls/7': {
        json: {
          title: 'Feature',
          number: 7,
          user: { login: 'bob' },
          state: 'closed',
          merged_at: '2026-01-05',
          base: { ref: 'main' },
          head: { label: 'bob:feat' },
          additions: 3,
          deletions: 1,
          changed_files: 1,
          commits: 2,
        },
      },
    })
    const pull = await loadPull(client(request), {
      kind: 'pull',
      ...repo,
      number: 7,
      tab: 'conversation',
    })
    expect(pull.state).toBe('merged')
    // The empty COMMENTED review is only a wrapper for inline comments.
    expect(pull.comments.map((c) => [c.author, c.badge])).toEqual([
      ['ann', undefined],
      ['rev', 'Approved'],
    ])
  })

  it('gives every changed file its diff anchor and its review comments', async () => {
    const { request } = fake({
      '/repos/o/r/pulls/7/files': {
        json: [
          {
            filename: 'README.md',
            status: 'modified',
            additions: 1,
            deletions: 0,
            patch: '@@ -1 +1 @@\n+x',
          },
        ],
      },
      '/repos/o/r/pulls/7/comments': {
        json: [
          { id: 4, path: 'README.md', line: 1, side: 'RIGHT', user: { login: 'rev' }, body: 'nit' },
        ],
      },
    })
    const { files } = await loadPullFiles(client(request), {
      kind: 'pull',
      ...repo,
      number: 7,
      tab: 'files',
    })
    expect(files[0].hash).toBe('b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5')
    expect(files[0].reviewComments[0]).toMatchObject({ body: 'nit', location: 'line 1' })
  })

  it('reads a commit', async () => {
    const { request } = fake({
      '/repos/o/r/commits/abc': {
        json: {
          sha: 'abc123',
          commit: { message: 'fix: it', author: { name: 'Bob', date: '2026-01-01' } },
          files: [{ filename: 'a.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+a' }],
        },
      },
    })
    const commit = await loadCommit(client(request), { kind: 'commit', ...repo, sha: 'abc' })
    expect(commit).toMatchObject({ sha: 'abc123', author: 'Bob', message: 'fix: it' })
    expect(commit.files[0].path).toBe('a.ts')
  })

  it('finds where a slashed branch ends and the path begins', async () => {
    const { request, calls } = fake({
      '/repos/o/r/contents/src/a.ts?ref=feature%2Fx': { text: 'code' },
    })
    const blob = await loadBlob(client(request), {
      kind: 'blob',
      ...repo,
      rest: ['feature', 'x', 'src', 'a.ts'],
    })
    expect(blob).toMatchObject({ ref: 'feature/x', path: 'src/a.ts', text: 'code' })
    expect(calls[0].headers?.Accept).toBe('application/vnd.github.raw')
    expect(calls).toHaveLength(2)
  })

  it('stops at the first refusal that is not "not found"', async () => {
    const { request } = fake({ '/repos/o/r/contents': { status: 401 } })
    await expect(
      loadBlob(client(request), { kind: 'blob', ...repo, rest: ['main', 'a.ts', 'b'] })
    ).rejects.toMatchObject({ kind: 'auth' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('reads a discussion with its answer and replies', async () => {
    const { request, calls } = fake({
      '/graphql': {
        json: {
          data: {
            repository: {
              discussion: {
                title: 'Q',
                number: 3,
                url: 'u',
                body: 'b',
                createdAt: '2026-01-01',
                isAnswered: true,
                closed: false,
                author: { login: 'ann' },
                category: { name: 'Q&A' },
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      id: 'c1',
                      databaseId: 11,
                      body: 'this',
                      isAnswer: true,
                      author: { login: 'bob' },
                      replies: {
                        totalCount: 3,
                        nodes: [{ id: 'r1', body: 'thanks', author: null }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    })
    const d = await loadDiscussion(client(request), { kind: 'discussion', ...repo, number: 3 })
    expect(calls[0].method).toBe('POST')
    expect(d).toMatchObject({ state: 'answered', category: 'Q&A' })
    expect(d.comments[0]).toMatchObject({
      badge: 'Answer',
      anchor: 'discussioncomment-11',
      moreReplies: 2,
    })
    expect(d.comments[0].replies?.[0].author).toBe('ghost')
  })

  it('maps a GraphQL NOT_FOUND to the same not-found message', async () => {
    const { request } = fake({
      '/graphql': { json: { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] } },
    })
    await expect(
      loadDiscussion(client(request), { kind: 'discussion', ...repo, number: 3 })
    ).rejects.toMatchObject({ kind: 'not-found' })
  })
})
