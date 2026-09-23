/**
 * The API client against a scripted `requestUrl`.
 *
 * What matters: the token is sent only as a header, an unchanged answer comes from memory, and
 * every refusal says what to do about it rather than a bare status.
 */
import { describe, it, expect, vi } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient, GithubError, errorFor } from '@/github/client'
import { endpoints } from '@/github/urls'
import {
  loadBlob,
  loadDiscussion,
  loadIssue,
  loadPull,
  loadPullFiles,
  loadCommit,
} from '@/github/api'

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

  it('403 otherwise names the fine-grained permissions', () => {
    const e = errorFor(403, {}, { message: 'Resource not accessible' }, true, 'issues')
    expect(e.kind).toBe('forbidden')
    expect(e.message).toMatch(/read access to Contents, Issues, Pull requests and Discussions/)
  })

  it('404 explains that a token only sees its own repositories', () => {
    expect(errorFor(404, {}, null, true).message).toMatch(/only sees the repositories/)
    expect(errorFor(404, {}, null, false).message).toMatch(/add a token/)
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
    expect(calls[0].headers?.Accept).toBe('application/vnd.github.raw+json')
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
