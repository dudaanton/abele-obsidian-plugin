/**
 * GitHub notifications: reading the Notifications API's answer, working out the page each one
 * leads to from the API addresses it carries, polling the way GitHub asks (the poll interval,
 * `If-Modified-Since`), marking read or done, and what a refusal says about the token.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import {
  apiToWeb,
  commentAnchor,
  destination,
  parseNotifications,
  reasonText,
  subjectType,
  type RawNotification,
} from '@/github/notifications/model'
import { NotificationInbox } from '@/github/notifications/inbox'

afterEach(() => vi.restoreAllMocks())

const API = 'https://api.github.com/repos'
const COM = endpoints('')
const GHES = endpoints('git.example.test')

export const raw = (
  id: string,
  type: string,
  url: string | null,
  extra: Partial<RawNotification> & { comment?: string | null; title?: string } = {}
): RawNotification => ({
  id,
  unread: true,
  reason: 'mention',
  updated_at: '2026-09-01T10:00:00Z',
  subject: {
    title: extra.title ?? `Subject ${id}`,
    url,
    latest_comment_url: extra.comment === undefined ? url : extra.comment,
    type,
  },
  repository: { full_name: 'acme/widgets' },
  ...extra,
})

describe('parsing', () => {
  it('keeps what a row shows and drops what is not a notification', () => {
    const list = parseNotifications([
      raw('1', 'PullRequest', `${API}/acme/widgets/pulls/7`, { unread: false, reason: 'author' }),
      { nonsense: true },
      null,
    ])
    expect(list).toEqual([
      {
        id: '1',
        unread: false,
        reason: 'author',
        updatedAt: '2026-09-01T10:00:00Z',
        title: 'Subject 1',
        type: 'PullRequest',
        repo: 'acme/widgets',
        apiUrl: `${API}/acme/widgets/pulls/7`,
        commentApiUrl: `${API}/acme/widgets/pulls/7`,
      },
    ])
    expect(parseNotifications({ message: 'x' })).toEqual([])
  })

  it('names types and reasons in words, and an unknown one by its own name', () => {
    expect(subjectType('PullRequest')).toEqual({ label: 'Pull request', icon: 'git-pull-request' })
    expect(subjectType('SomethingNew').label).toBe('Something New')
    expect(reasonText('review_requested')).toBe('review requested')
    expect(reasonText('brand_new_reason')).toBe('brand new reason')
  })
})

describe('API address to page', () => {
  it('maps issues, pull requests, commits and discussions on github.com', () => {
    expect(apiToWeb(`${API}/acme/widgets/issues/5`, COM)).toBe(
      'https://github.com/acme/widgets/issues/5'
    )
    expect(apiToWeb(`${API}/acme/widgets/pulls/7`, COM)).toBe(
      'https://github.com/acme/widgets/pull/7'
    )
    expect(apiToWeb(`${API}/acme/widgets/commits/1a2b3c4d`, COM)).toBe(
      'https://github.com/acme/widgets/commit/1a2b3c4d'
    )
    expect(apiToWeb(`${API}/acme/widgets/discussions/3`, COM)).toBe(
      'https://github.com/acme/widgets/discussions/3'
    )
    expect(apiToWeb(`${API}/acme/widgets/releases/99`, COM)).toBeNull()
    expect(apiToWeb('https://elsewhere.test/repos/a/b/issues/1', COM)).toBeNull()
  })

  it('maps an Enterprise server’s API addresses onto its own pages', () => {
    expect(apiToWeb('https://git.example.test/api/v3/repos/acme/widgets/pulls/7', GHES)).toBe(
      'https://git.example.test/acme/widgets/pull/7'
    )
  })

  it('reads the latest comment as the anchor GitHub gives it on the page', () => {
    expect(commentAnchor(`${API}/acme/widgets/issues/comments/123`, COM)).toBe('issuecomment-123')
    expect(commentAnchor(`${API}/acme/widgets/pulls/comments/456`, COM)).toBe('discussion_r456')
    expect(commentAnchor(`${API}/acme/widgets/issues/5`, COM)).toBeUndefined()
    expect(commentAnchor(null, COM)).toBeUndefined()
  })
})

describe('where a notification leads', () => {
  const dest = (r: RawNotification, ends = COM) => destination(parseNotifications([r])[0], ends)

  it('opens an issue or pull request in a tab, at the latest comment', () => {
    expect(
      dest(
        raw('1', 'PullRequest', `${API}/acme/widgets/pulls/7`, {
          comment: `${API}/acme/widgets/issues/comments/11`,
        })
      )
    ).toEqual({ kind: 'tab', url: 'https://github.com/acme/widgets/pull/7#issuecomment-11' })
    expect(dest(raw('2', 'Issue', `${API}/acme/widgets/issues/5`))).toEqual({
      kind: 'tab',
      url: 'https://github.com/acme/widgets/issues/5',
    })
  })

  it('finds a discussion by its title, since GitHub gives no address for one', () => {
    expect(dest(raw('3', 'Discussion', null, { title: 'Ideas for v2' }))).toEqual({
      kind: 'discussion',
      repoUrl: 'https://github.com/acme/widgets',
      title: 'Ideas for v2',
    })
  })

  it('asks for a release’s page, and sends what no tab shows to GitHub', () => {
    expect(dest(raw('4', 'Release', `${API}/acme/widgets/releases/99`))).toEqual({
      kind: 'ask',
      apiUrl: `${API}/acme/widgets/releases/99`,
      fallback: 'https://github.com/acme/widgets/releases',
    })
    expect(dest(raw('5', 'CheckSuite', null))).toEqual({
      kind: 'browser',
      url: 'https://github.com/acme/widgets/actions',
    })
    expect(dest(raw('6', 'RepositoryDependabotAlertsThread', null))).toEqual({
      kind: 'browser',
      url: 'https://github.com/acme/widgets/security',
    })
    expect(dest(raw('7', 'Mystery', null))).toEqual({
      kind: 'tab',
      url: 'https://github.com/acme/widgets',
    })
  })
})

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> }

function fakeClient(reply: (req: RequestUrlParam) => Reply, token = 'ghp_classic') {
  const request = vi.fn(async (req: RequestUrlParam): Promise<RequestUrlResponse> => {
    const r = reply(req)
    return {
      status: r.status ?? 200,
      headers: r.headers ?? {},
      json: r.json,
      text: JSON.stringify(r.json ?? null),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(COM, token, request), request }
}

const LIST = [
  raw('1', 'Issue', `${API}/acme/widgets/issues/5`, { updated_at: '2026-09-01T10:00:00Z' }),
  raw('2', 'PullRequest', `${API}/acme/widgets/pulls/7`, { updated_at: '2026-09-02T10:00:00Z' }),
]

describe('polling', () => {
  it('waits the poll interval, then asks with If-Modified-Since and takes a 304 as unchanged', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { client, request } = fakeClient((req) => {
      const since = (req.headers ?? {})['If-Modified-Since']
      if (since === 'Tue, 01 Sep 2026 10:00:00 GMT') return { status: 304 }
      return {
        json: LIST,
        headers: { 'X-Poll-Interval': '90', 'Last-Modified': 'Tue, 01 Sep 2026 10:00:00 GMT' },
      }
    })
    const inbox = new NotificationInbox(client)

    const first = await inbox.load('unread')
    expect(first.items.map((n) => n.id)).toEqual(['2', '1'])
    expect(first.pollSeconds).toBe(90)
    const url = new URL(request.mock.calls[0][0].url)
    expect(url.pathname).toBe('/notifications')
    expect(url.searchParams.get('all')).toBe('false')
    expect(url.searchParams.get('per_page')).toBe('50')

    now += 30_000
    await inbox.load('unread')
    expect(request).toHaveBeenCalledTimes(1)
    expect(inbox.waitSeconds('unread')).toBe(60)

    now += 61_000
    const again = await inbox.load('unread')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][0].headers?.['If-Modified-Since']).toBe(
      'Tue, 01 Sep 2026 10:00:00 GMT'
    )
    expect(again.items.map((n) => n.id)).toEqual(['2', '1'])

    // Asked by hand before the interval: asked anyway, conditionally, so it costs nothing.
    await inbox.load('unread', true)
    expect(request).toHaveBeenCalledTimes(3)
    vi.restoreAllMocks()
  })

  it('reads every page of fifty, and keeps "all" apart from "unread"', async () => {
    const many = Array.from({ length: 50 }, (_, i) => raw(`p${i}`, 'Issue', null))
    const { client, request } = fakeClient((req) => {
      const u = new URL(req.url)
      if (u.searchParams.get('all') !== 'true') return { json: [] }
      return { json: u.searchParams.get('page') === '1' ? many : LIST }
    })
    const inbox = new NotificationInbox(client)
    const all = await inbox.load('all')
    expect(all.items).toHaveLength(52)
    expect(request).toHaveBeenCalledTimes(2)
    expect((await inbox.load('unread')).items).toEqual([])
  })
})

describe('polling after local writes', () => {
  it.each(['read', 'done'] as const)(
    'does not reuse a pre-%s validator when the same thread has new activity',
    async (action) => {
      const stamp = 'Tue, 01 Sep 2026 10:00:00 GMT'
      let changed = false
      const { client, request } = fakeClient((req) => {
        if (req.method !== 'GET') {
          changed = true
          return { status: req.method === 'DELETE' ? 204 : 205 }
        }
        // A validator rounded to seconds can still be the same after a write and new activity.
        if (req.headers?.['If-Modified-Since'] === stamp) return { status: 304 }
        return {
          json: changed ? [raw('1', 'Issue', null, { updated_at: '2026-09-01T10:00:01Z' })] : LIST,
          headers: { 'Last-Modified': stamp },
        }
      })
      const inbox = new NotificationInbox(client)
      await inbox.load('all')
      await inbox.load('unread')
      if (action === 'done') await inbox.markDone('1')
      else await inbox.markRead('1')
      for (const which of ['all', 'unread'] as const) {
        const page = await inbox.load(which, true)
        expect(page.items.map((n) => [n.id, n.unread, n.updatedAt])).toEqual([
          ['1', true, '2026-09-01T10:00:01Z'],
        ])
      }
      expect(request.mock.calls.slice(-2).every(([r]) => !r.headers?.['If-Modified-Since'])).toBe(
        true
      )
    }
  )

  it('does not let a GET started before Done republish the removed thread', async () => {
    const { client } = fakeClient((req) =>
      req.method === 'DELETE' ? { status: 204 } : { json: LIST }
    )
    const inbox = new NotificationInbox(client)
    await inbox.load('all')
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(client, 'call').mockImplementationOnce(async () => {
      await waiting
      return { status: 200, headers: {}, body: LIST } as never
    })
    const loading = inbox.load('all', true)
    await Promise.resolve()
    const done = inbox.markDone('1')
    await Promise.resolve()
    await Promise.resolve()
    release()
    await Promise.all([loading, done])
    expect(inbox.cached('all')?.map((n) => n.id)).toEqual(['2'])
  })

  it('keeps a newly arrived notification until the poll interval, then includes it', async () => {
    let now = Date.parse('2026-09-03T12:00:00Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let current = LIST
    const { client, request } = fakeClient(() => ({
      json: current,
      headers: { 'X-Poll-Interval': '90' },
    }))
    const inbox = new NotificationInbox(client)
    await inbox.load('all')
    current = [...LIST, raw('3', 'Issue', null, { updated_at: '2026-09-03T12:00:01Z' })]
    now += 45_000
    expect((await inbox.load('all')).items.map((n) => n.id)).toEqual(['2', '1'])
    expect(request).toHaveBeenCalledTimes(1)
    now += 46_000
    expect((await inbox.load('all')).items.map((n) => n.id)).toEqual(['3', '2', '1'])
    vi.restoreAllMocks()
  })

  it('does not advance bulk-read cutoff on 304 and invalidates every cached list after bulk read', async () => {
    let now = Date.parse('2026-09-03T12:00:00Z')
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const stamp = 'Wed, 02 Sep 2026 10:00:00 GMT'
    const { client, request } = fakeClient((req) =>
      req.method === 'PUT'
        ? { status: 202 }
        : req.headers?.['If-Modified-Since']
          ? { status: 304 }
          : { json: LIST, headers: { 'Last-Modified': stamp } }
    )
    const inbox = new NotificationInbox(client)
    await inbox.load('all')
    await inbox.load('unread')
    now += 120_000
    await inbox.load('all')
    await inbox.markAllRead('all')
    const put = request.mock.calls.at(-1)![0]
    expect(JSON.parse(String(put.body)).last_read_at).toBe('2026-09-03T12:00:00.000Z')
    await inbox.load('all', true)
    await inbox.load('unread', true)
    expect(request.mock.calls.slice(-2).every(([r]) => !r.headers?.['If-Modified-Since'])).toBe(
      true
    )
    vi.restoreAllMocks()
  })
})

describe('marking done', () => {
  it('DELETEs the thread and removes it from both cached lists, only after success', async () => {
    const { client, request } = fakeClient((req) =>
      req.method === 'DELETE' ? { status: 204 } : { json: LIST }
    )
    const inbox = new NotificationInbox(client)
    await inbox.load('all')
    await inbox.load('unread')
    await inbox.markDone('1')
    expect(request.mock.calls[2][0].method).toBe('DELETE')
    expect(request.mock.calls[2][0].url).toBe('https://api.github.com/notifications/threads/1')
    expect(inbox.cached('all')?.map((n) => n.id)).toEqual(['2'])
    expect(inbox.cached('unread')?.map((n) => n.id)).toEqual(['2'])
  })

  it.each([403, 304])(
    'does not remove a thread when DELETE answers %s rather than 204',
    async (status) => {
      const { client } = fakeClient((req) =>
        req.method === 'DELETE' ? { status, json: { message: 'Not done' } } : { json: LIST }
      )
      const inbox = new NotificationInbox(client)
      await inbox.load('all')
      await expect(inbox.markDone('1')).rejects.toBeInstanceOf(Error)
      expect(inbox.cached('all')?.map((n) => n.id)).toEqual(['2', '1'])
    }
  )
})

describe('marking read', () => {
  it('PATCHes one thread and PUTs all of them up to when the list was read', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-09-03T12:00:00Z'))
    const { client, request } = fakeClient((req) => {
      if (req.method === 'PATCH') return { status: 205 }
      if (req.method === 'PUT') return { status: 202, json: { message: 'queued' } }
      return { json: LIST }
    })
    const inbox = new NotificationInbox(client)
    await inbox.load('unread')

    await inbox.markRead('1')
    const patch = request.mock.calls[1][0]
    expect(patch.method).toBe('PATCH')
    expect(patch.url).toBe('https://api.github.com/notifications/threads/1')
    expect(inbox.cached('unread')?.map((n) => [n.id, n.unread])).toEqual([
      ['2', true],
      ['1', false],
    ])

    await inbox.markAllRead('unread')
    const put = request.mock.calls[2][0]
    expect(put.method).toBe('PUT')
    expect(put.url).toBe('https://api.github.com/notifications')
    expect(JSON.parse(String(put.body))).toEqual({
      last_read_at: '2026-09-03T12:00:00.000Z',
    })
    expect(inbox.cached('unread')?.every((n) => !n.unread)).toBe(true)
    vi.restoreAllMocks()
  })
})

describe('bulk-read server cutoff', () => {
  it.each(['', 'sample-org/sample-repo'])(
    'does not force unseen activity read on the server (repository %s)',
    async (repo) => {
      let now = Date.parse('2026-01-01T10:00:00Z')
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      let server = [
        raw('41', 'Issue', null, {
          updated_at: '2026-01-01T09:00:00Z',
          repository: { full_name: 'sample-org/sample-repo' },
        }),
      ]
      const { client, request } = fakeClient((req) => {
        if (req.method === 'PUT') {
          const body = JSON.parse(String(req.body)) as { last_read_at: string; read?: boolean }
          // Model the server decision, not just the optimistic local cache: read:true forces all.
          server = server.map((n) =>
            body.read === true || Date.parse(n.updated_at) <= Date.parse(body.last_read_at)
              ? { ...n, unread: false }
              : n
          )
          return { status: 205 }
        }
        return { json: server }
      })
      const inbox = new NotificationInbox(client)
      await inbox.load('all')
      now += 60_000
      server = [
        ...server,
        raw('42', 'Issue', null, {
          updated_at: '2026-01-01T10:01:00Z',
          repository: { full_name: 'sample-org/sample-repo' },
        }),
      ]
      now += 60_000
      await inbox.markAllRead('all', repo)
      expect(server.map((n) => [n.id, n.unread])).toEqual([
        ['41', false],
        ['42', true],
      ])
      const put = request.mock.calls.at(-1)![0]
      expect(JSON.parse(String(put.body))).toEqual({ last_read_at: '2026-01-01T10:00:00.000Z' })
      expect(put.url).toBe(
        repo
          ? 'https://api.github.com/repos/sample-org/sample-repo/notifications'
          : 'https://api.github.com/notifications'
      )
      expect((await inbox.load('all', true)).items.map((n) => [n.id, n.unread])).toEqual([
        ['42', true],
        ['41', false],
      ])
    }
  )
})

describe('bulk-read cutoff precision', () => {
  it('marks an update exactly at the cutoff read despite ISO precision, but not a later update', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-03T12:00:00Z'))
    const { client } = fakeClient((req) =>
      req.method === 'PUT'
        ? { status: 205 }
        : {
            json: [
              raw('1', 'Issue', null, { updated_at: '2026-09-03T12:00:00Z' }),
              raw('2', 'Issue', null, { updated_at: '2026-09-03T12:00:01Z' }),
            ],
          }
    )
    const inbox = new NotificationInbox(client)
    await inbox.load('all')
    await inbox.markAllRead('all')
    expect(inbox.cached('all')?.map((n) => [n.id, n.unread])).toEqual([
      ['2', true],
      ['1', false],
    ])
  })
})

describe('marking one repository read', () => {
  it('PUTs to the repository and leaves the others unread', async () => {
    const other = raw('3', 'Issue', null, {
      repository: { full_name: 'acme/gadgets' },
    } as Partial<RawNotification>)
    const { client, request } = fakeClient((req) =>
      req.method === 'PUT' ? { status: 205 } : { json: [...LIST, other] }
    )
    const inbox = new NotificationInbox(client)
    await inbox.load('unread')
    await inbox.markAllRead('unread', 'acme/widgets')
    expect(request.mock.calls[1][0].url).toBe(
      'https://api.github.com/repos/acme/widgets/notifications'
    )
    expect(inbox.cached('unread')?.map((n) => [n.id, n.unread])).toEqual([
      ['2', false],
      ['1', false],
      ['3', true],
    ])
  })
})

describe('what a refusal says', () => {
  const refused = async (token: string, reply: Reply) => {
    const { client } = fakeClient(() => reply, token)
    return new NotificationInbox(client).load('unread').catch((e: Error) => e)
  }

  it('tells a fine-grained token apart: GitHub does not let it read notifications at all', async () => {
    const e = await refused('github_pat_abc', {
      status: 403,
      json: { message: 'Resource not accessible by personal access token' },
    })
    expect(e).toBeInstanceOf(Error)
    expect((e as Error).message).toMatch(/fine-grained token read notifications/)
    expect((e as Error).message).toMatch(/classic/)
    expect((e as Error).message).toMatch(/Resource not accessible by personal access token/)
  })

  it('names the missing scope for a classic token', async () => {
    const e = await refused('ghp_abc', {
      status: 403,
      json: { message: 'Forbidden' },
      headers: { 'X-OAuth-Scopes': 'read:user', 'X-Accepted-OAuth-Scopes': 'notifications, repo' },
    })
    expect((e as Error).message).toMatch(/its scopes: read:user/)
    expect((e as Error).message).toMatch(/notifications or the repo scope/)
  })

  it('asks for a token before asking GitHub, when there is none', async () => {
    const { client, request } = fakeClient(() => ({ json: [] }), '')
    const e = await new NotificationInbox(client).load('unread').catch((x: Error) => x)
    expect((e as Error).message).toMatch(/only to a request with a token/)
    expect(request).not.toHaveBeenCalled()
  })

  it('leaves a used-up rate limit as it is', async () => {
    const e = await refused('ghp_abc', {
      status: 403,
      json: { message: 'API rate limit exceeded' },
      headers: { 'X-RateLimit-Remaining': '0' },
    })
    expect((e as Error).message).toMatch(/request limit/)
  })
})

describe('opening', () => {
  it('finds a discussion by its exact title, and falls back to the search', async () => {
    const { client } = fakeClient((req) => {
      if (req.url.endsWith('/graphql'))
        return {
          json: {
            data: {
              search: {
                nodes: [
                  { number: 9, title: 'Ideas for v2 (old)', updatedAt: '2026-09-01T00:00:00Z' },
                  { number: 4, title: 'Ideas for v2', updatedAt: '2026-08-01T00:00:00Z' },
                ],
              },
            },
          },
        }
      return { status: 404, json: { message: 'Not Found' } }
    })
    const inbox = new NotificationInbox(client)
    const [found, missing] = parseNotifications([
      raw('1', 'Discussion', null, { title: 'Ideas for v2' }),
      raw('2', 'Discussion', null, { title: 'Gone' }),
    ])
    expect(await inbox.open(found)).toEqual({
      url: 'https://github.com/acme/widgets/discussions/4',
      tab: true,
    })
    expect(await inbox.open(missing)).toEqual({
      url: `https://github.com/acme/widgets/discussions?q=${encodeURIComponent('in:title Gone')}`,
      tab: true,
    })
  })

  it('opens a release on GitHub at the page the API names', async () => {
    const { client } = fakeClient(() => ({
      json: { html_url: 'https://github.com/acme/widgets/releases/tag/v2.0.0' },
    }))
    const [release] = parseNotifications([raw('1', 'Release', `${API}/acme/widgets/releases/99`)])
    expect(await new NotificationInbox(client).open(release)).toEqual({
      url: 'https://github.com/acme/widgets/releases/tag/v2.0.0',
      tab: false,
    })
  })
})
