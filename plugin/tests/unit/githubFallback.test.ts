/**
 * Secondary sections of an issue or pull request: a refusal of one of them does not take the item
 * down, and a REST refusal is asked again through GraphQL — the road `gh` takes, which a
 * fine-grained token can be allowed where REST refuses it.
 */
import { describe, it, expect, vi } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { loadIssue, loadPull, loadPullCommits, loadPullFiles } from '@/github/api'
import {
  commentsFromGraphql,
  commitsFromGraphql,
  filesFromGraphql,
  reviewCommentsFromGraphql,
  reviewsFromGraphql,
} from '@/github/graphql'

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> }

const respond = (r: Reply) =>
  ({
    status: r.status ?? 200,
    headers: r.headers ?? {},
    json: r.json,
    text: JSON.stringify(r.json ?? null),
    arrayBuffer: new ArrayBuffer(0),
  }) as RequestUrlResponse

/** REST by exact path (paging stripped); GraphQL by a word its query contains. */
function fake(
  rest: Record<string, Reply>,
  graphql: Record<string, Reply> = {},
  api = 'https://api.github.com'
) {
  const calls: RequestUrlParam[] = []
  const request = vi.fn(async (req: RequestUrlParam) => {
    calls.push(req)
    if (req.method === 'POST') {
      const query = String(JSON.parse(String(req.body)).query)
      const key = Object.keys(graphql).find((k) => query.includes(k))
      return respond(key ? graphql[key] : { json: { errors: [{ message: 'no route' }] } })
    }
    const path = req.url.replace(api, '').replace(/[?&]per_page=.*$/, '')
    return respond(rest[path] ?? { status: 404, json: { message: 'Not Found' } })
  })
  return { request, calls }
}

const REFUSED: Reply = {
  status: 403,
  json: { message: 'Resource not accessible by personal access token' },
  headers: { 'X-Accepted-GitHub-Permissions': 'issues=read; pull_requests=read' },
}

const PULL = {
  title: 'Feature',
  number: 42,
  html_url: 'https://github.com/acme/widgets/pull/42',
  user: { login: 'bob' },
  created_at: '2026-01-01T00:00:00Z',
  state: 'open',
  body: 'The body',
  base: { ref: 'main' },
  head: { label: 'bob:feat' },
  changed_files: 1,
  commits: 1,
}

const pullTarget = {
  kind: 'pull' as const,
  host: 'github.com',
  owner: 'acme',
  repo: 'widgets',
  number: 42,
  tab: 'conversation' as const,
}

const GQL_COMMENTS = {
  totalCount: 1,
  nodes: [
    {
      id: 'IC_1',
      databaseId: 901,
      body: 'From GraphQL',
      createdAt: '2026-01-02T00:00:00Z',
      url: 'https://github.com/acme/widgets/pull/42#issuecomment-901',
      author: { login: 'ann' },
    },
  ],
}

const GQL_REVIEWS = {
  totalCount: 3,
  nodes: [
    {
      id: 'PRR_1',
      databaseId: 501,
      state: 'APPROVED',
      body: '',
      submittedAt: '2026-01-03T00:00:00Z',
      url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-501',
      author: { login: 'rev' },
    },
    // A wrapper of inline comments: nothing to say on the timeline.
    { id: 'PRR_2', databaseId: 502, state: 'COMMENTED', body: '', author: { login: 'rev' } },
    { id: 'PRR_3', databaseId: 503, state: 'PENDING', body: 'draft', author: { login: 'rev' } },
  ],
}

describe('GraphQL answers in the REST model', () => {
  it('maps conversation comments, keeping the anchor a link scrolls to', () => {
    const { items, complete } = commentsFromGraphql(GQL_COMMENTS)
    expect(complete).toBe(true)
    expect(items).toEqual([
      {
        id: '901',
        author: 'ann',
        body: 'From GraphQL',
        createdAt: '2026-01-02T00:00:00Z',
        anchor: 'issuecomment-901',
        url: 'https://github.com/acme/widgets/pull/42#issuecomment-901',
      },
    ])
  })

  it('says a list is incomplete when GitHub holds more than came', () => {
    expect(commentsFromGraphql({ ...GQL_COMMENTS, totalCount: 250 }).complete).toBe(false)
  })

  it('a deleted author is the ghost, as REST has it', () => {
    const { items } = commentsFromGraphql({ nodes: [{ ...GQL_COMMENTS.nodes[0], author: null }] })
    expect(items[0].author).toBe('ghost')
  })

  it('maps reviews with their verdict and drops the ones with nothing to say', () => {
    const { items } = reviewsFromGraphql(GQL_REVIEWS)
    expect(items).toEqual([
      {
        id: 'review-501',
        author: 'rev',
        body: '',
        createdAt: '2026-01-03T00:00:00Z',
        anchor: 'pullrequestreview-501',
        badge: 'Approved',
        url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-501',
      },
    ])
  })

  it('maps review threads into comments per file, with their line and side', () => {
    const { items } = reviewCommentsFromGraphql({
      totalCount: 1,
      nodes: [
        {
          path: 'src/a.ts',
          diffSide: 'LEFT',
          line: 4,
          originalLine: 4,
          comments: {
            nodes: [
              {
                id: 'RC_1',
                databaseId: 77,
                body: 'nit',
                createdAt: '2026-01-04T00:00:00Z',
                url: 'u',
                line: 4,
                originalLine: 4,
                author: { login: 'rev' },
              },
              {
                id: 'RC_2',
                databaseId: 78,
                body: 'old',
                createdAt: '2026-01-05T00:00:00Z',
                line: null,
                originalLine: 9,
                author: { login: 'bob' },
              },
            ],
          },
        },
      ],
    })
    expect(items.map((c) => [c.path, c.comment.anchor, c.comment.location])).toEqual([
      ['src/a.ts', 'discussion_r77', 'old line 4'],
      ['src/a.ts', 'discussion_r78', 'old line 9 (outdated)'],
    ])
  })

  it('maps commits', () => {
    const commits = commitsFromGraphql({
      nodes: [
        {
          commit: {
            oid: 'abc123',
            message: 'fix: it',
            author: { name: 'Bob', date: '2026-01-01', user: { login: 'bob' } },
          },
        },
        { commit: { oid: 'def', message: 'x', author: { name: 'Nobody', date: '', user: null } } },
      ],
    })
    expect(commits).toEqual([
      { sha: 'abc123', message: 'fix: it', author: 'bob', date: '2026-01-01' },
      { sha: 'def', message: 'x', author: 'Nobody', date: '' },
    ])
  })

  it('maps changed files, which come without their diffs', () => {
    const { files, complete } = filesFromGraphql({
      totalCount: 2,
      nodes: [
        { path: 'a.ts', additions: 1, deletions: 2, changeType: 'MODIFIED' },
        { path: 'b.ts', additions: 0, deletions: 5, changeType: 'DELETED' },
      ],
    })
    expect(complete).toBe(true)
    expect(files).toEqual([
      { filename: 'a.ts', status: 'modified', additions: 1, deletions: 2 },
      { filename: 'b.ts', status: 'removed', additions: 0, deletions: 5 },
    ])
  })
})

describe('a pull request whose secondary sections are refused', () => {
  it('still loads when the comments are refused, and says so in their place', async () => {
    const { request } = fake(
      {
        '/repos/acme/widgets/pulls/42': { json: PULL },
        '/repos/acme/widgets/issues/42/comments': REFUSED,
        '/repos/acme/widgets/pulls/42/reviews': {
          json: [
            { id: 5, user: { login: 'rev' }, body: 'ok', state: 'APPROVED', submitted_at: 'x' },
          ],
        },
      },
      { comments: { json: { errors: [{ type: 'FORBIDDEN', message: 'GraphQL says no' }] } } }
    )
    const pull = await loadPull(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    expect(pull.title).toBe('Feature')
    expect(pull.body).toBe('The body')
    // The reviews that were readable are shown.
    expect(pull.comments.map((c) => c.anchor)).toEqual(['pullrequestreview-5'])
    expect(pull.commentsProblem).toMatch(/refused the pull request's comments to this token/)
    expect(pull.commentsProblem).toMatch(/Needs: Issues \(read\) or Pull requests \(read\)/)
    expect(pull.commentsProblem).toMatch(/Resource not accessible by personal access token/)
    expect(pull.commentsProblem).toMatch(/GraphQL[\s\S]*GraphQL says no/)
    // The pull request itself was read, which takes Pull requests (read): the token has it.
    expect(pull.commentsProblem).toMatch(/not a permission missing from the token/)
    expect(pull.commentsProblem).not.toMatch(/lacks that permission/)
  })

  it('reads the comments through GraphQL when REST refuses them', async () => {
    const { request, calls } = fake(
      {
        '/repos/acme/widgets/pulls/42': { json: PULL },
        '/repos/acme/widgets/issues/42/comments': REFUSED,
        '/repos/acme/widgets/pulls/42/reviews': REFUSED,
      },
      {
        'comments(': {
          json: { data: { repository: { pullRequest: { comments: GQL_COMMENTS } } } },
        },
        'reviews(': { json: { data: { repository: { pullRequest: { reviews: GQL_REVIEWS } } } } },
      }
    )
    const pull = await loadPull(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    expect(pull.commentsProblem).toBeUndefined()
    expect(pull.commentsComplete).toBe(true)
    expect(pull.comments.map((c) => c.anchor)).toEqual([
      'issuecomment-901',
      'pullrequestreview-501',
    ])
    const posted = calls.filter((c) => c.method === 'POST')
    expect(posted.map((c) => c.url)).toEqual([
      'https://api.github.com/graphql',
      'https://api.github.com/graphql',
    ])
    expect(JSON.parse(String(posted[0].body)).variables).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42,
    })
  })

  it('asks an Enterprise Server at /api/graphql', async () => {
    const api = 'https://github.example.com/api/v3'
    const { request, calls } = fake(
      {
        '/repos/acme/widgets/pulls/42': { json: PULL },
        '/repos/acme/widgets/issues/42/comments': REFUSED,
        '/repos/acme/widgets/pulls/42/reviews': { json: [] },
      },
      {
        'comments(': {
          json: { data: { repository: { pullRequest: { comments: GQL_COMMENTS } } } },
        },
      },
      api
    )
    const client = new GithubClient(endpoints('https://github.example.com'), 'tkn', request)
    const pull = await loadPull(client, { ...pullTarget, host: 'github.example.com' })
    expect(pull.comments).toHaveLength(1)
    expect(calls.find((c) => c.method === 'POST')?.url).toBe(
      'https://github.example.com/api/graphql'
    )
  })

  it('does not try GraphQL without a token, which GraphQL always wants', async () => {
    const { request, calls } = fake({
      '/repos/acme/widgets/pulls/42': { json: PULL },
      '/repos/acme/widgets/issues/42/comments': { status: 404, json: { message: 'Not Found' } },
      '/repos/acme/widgets/pulls/42/reviews': { json: [] },
    })
    const pull = await loadPull(new GithubClient(endpoints(''), '', request), pullTarget)
    expect(pull.commentsProblem).toMatch(/found nothing for the pull request's comments/)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('does not ask GraphQL about a used-up rate limit', async () => {
    const { request, calls } = fake({
      '/repos/acme/widgets/pulls/42': { json: PULL },
      '/repos/acme/widgets/issues/42/comments': {
        status: 403,
        json: { message: 'API rate limit exceeded' },
        headers: { 'X-RateLimit-Remaining': '0' },
      },
      '/repos/acme/widgets/pulls/42/reviews': { json: [] },
    })
    const pull = await loadPull(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    expect(pull.commentsProblem).toMatch(/limit/)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('fails whole when the pull request itself is not there', async () => {
    const { request } = fake({
      '/repos/acme/widgets/issues/42/comments': { json: [] },
      '/repos/acme/widgets/pulls/42/reviews': { json: [] },
    })
    await expect(
      loadPull(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    ).rejects.toThrow(/found nothing for the pull request/)
  })

  it('shows the files when their review comments are refused, and falls back for them', async () => {
    const { request } = fake(
      {
        '/repos/acme/widgets/pulls/42/files': {
          json: [{ filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
        },
        '/repos/acme/widgets/pulls/42/comments': REFUSED,
      },
      {
        reviewThreads: {
          json: {
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    totalCount: 1,
                    nodes: [
                      {
                        path: 'src/a.ts',
                        diffSide: 'RIGHT',
                        comments: {
                          nodes: [
                            { databaseId: 3, body: 'nit', line: 1, author: { login: 'rev' } },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }
    )
    const data = await loadPullFiles(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    expect(data.files[0].reviewComments.map((c) => c.body)).toEqual(['nit'])
    expect(data.reviewCommentsProblem).toBeUndefined()
  })

  it('shows the files with a notice when the review comments cannot be read either way', async () => {
    const { request } = fake({
      '/repos/acme/widgets/pulls/42/files': {
        json: [{ filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }],
      },
      '/repos/acme/widgets/pulls/42/comments': REFUSED,
    })
    const data = await loadPullFiles(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    expect(data.files).toHaveLength(1)
    expect(data.reviewCommentsProblem).toMatch(/pull request's review comments/)
  })

  it('lists the files through GraphQL, without diffs, when REST refuses them', async () => {
    const { request } = fake(
      {
        '/repos/acme/widgets/pulls/42/files': REFUSED,
        '/repos/acme/widgets/pulls/42/comments': { json: [] },
      },
      {
        'files(': {
          json: {
            data: {
              repository: {
                pullRequest: {
                  files: {
                    totalCount: 1,
                    nodes: [{ path: 'a.ts', additions: 1, deletions: 0, changeType: 'ADDED' }],
                  },
                },
              },
            },
          },
        },
      }
    )
    const data = await loadPullFiles(new GithubClient(endpoints(''), 'tkn', request), pullTarget)
    expect(data.files.map((f) => [f.path, f.status, f.patch])).toEqual([
      ['a.ts', 'added', undefined],
    ])
    expect(data.files[0].diffNote).toMatch(/GraphQL/)
  })

  it('reads the commits through GraphQL when REST refuses them', async () => {
    const { request } = fake(
      { '/repos/acme/widgets/pulls/42/commits': REFUSED },
      {
        'commits(': {
          json: {
            data: {
              repository: {
                pullRequest: {
                  commits: {
                    nodes: [{ commit: { oid: 'a1', message: 'm', author: { name: 'N' } } }],
                  },
                },
              },
            },
          },
        },
      }
    )
    const commits = await loadPullCommits(
      new GithubClient(endpoints(''), 'tkn', request),
      pullTarget
    )
    expect(commits.map((c) => c.sha)).toEqual(['a1'])
  })
})

describe('an issue whose comments are refused', () => {
  const ISSUE = {
    title: 'Bug',
    number: 5,
    html_url: 'https://github.com/acme/widgets/issues/5',
    user: { login: 'bob' },
    created_at: '2026-01-01',
    state: 'open',
    body: 'Body',
  }
  const target = {
    kind: 'issue' as const,
    host: 'github.com',
    owner: 'acme',
    repo: 'widgets',
    number: 5,
  }

  it('loads the issue and says the comments were refused', async () => {
    const { request } = fake({
      '/repos/acme/widgets/issues/5': { json: ISSUE },
      '/repos/acme/widgets/issues/5/comments': REFUSED,
    })
    const issue = await loadIssue(new GithubClient(endpoints(''), 'tkn', request), target)
    expect(issue.title).toBe('Bug')
    expect(issue.comments).toEqual([])
    expect(issue.commentsProblem).toMatch(/refused the issue's comments/)
  })

  it('reads them through GraphQL, asking for an issue', async () => {
    const { request, calls } = fake(
      {
        '/repos/acme/widgets/issues/5': { json: ISSUE },
        '/repos/acme/widgets/issues/5/comments': REFUSED,
      },
      { 'issue(': { json: { data: { repository: { issue: { comments: GQL_COMMENTS } } } } } }
    )
    const issue = await loadIssue(new GithubClient(endpoints(''), 'tkn', request), target)
    expect(issue.comments.map((c) => c.anchor)).toEqual(['issuecomment-901'])
    expect(issue.commentsProblem).toBeUndefined()
    expect(String(calls.find((c) => c.method === 'POST')?.body)).toContain('issue(number')
  })
})
