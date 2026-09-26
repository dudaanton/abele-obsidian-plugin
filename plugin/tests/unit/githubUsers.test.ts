/**
 * People in GitHub tabs: names and pictures looked up together, kept for a week, kept across a
 * restart, and forgotten on request.
 *
 * What matters: logins asked about in the same moment cost one request, a login that has no
 * profile costs none, nothing is asked again inside the week, and the token goes to no picture
 * host that is not the configured Enterprise server.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { GithubUsers, USER_TTL_MS, sizedAvatar, type UserStorage } from '@/github/users'
import { loadCommit, loadIssue, loadIssueConversation } from '@/github/api'

type Reply = {
  status?: number
  json?: unknown
  headers?: Record<string, string>
  bytes?: Uint8Array
}

function respond(r: Reply): RequestUrlResponse {
  const bytes = r.bytes ?? new Uint8Array(0)
  return {
    status: r.status ?? 200,
    headers: r.headers ?? {},
    json: r.json,
    text: JSON.stringify(r.json ?? null),
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as RequestUrlResponse
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

/** Names by login, as the profiles have them; `null` is a profile with no name. */
const PROFILES: Record<string, string | null> = {
  octocat: 'The Octocat',
  hubot: 'Hubot',
  monalisa: null,
}

/** A GitHub that answers the batched `user(login:)` query, `/users/<login>`, and pictures. */
function github(options: { graphql?: boolean; rest?: Reply } = {}) {
  const calls: RequestUrlParam[] = []
  const request = vi.fn(async (req: RequestUrlParam) => {
    calls.push(req)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/graphql')) {
      if (options.graphql === false) return respond({ status: 404, json: { message: 'no' } })
      const { variables } = JSON.parse(String(req.body)) as { variables: Record<string, string> }
      const data: Record<string, unknown> = {}
      const errors: unknown[] = []
      for (const [v, login] of Object.entries(variables)) {
        const alias = `u${v.slice(1)}`
        if (login in PROFILES) {
          data[alias] = {
            login,
            name: PROFILES[login],
            avatarUrl: `https://avatars.example.com/${login}?s=40`,
          }
        } else {
          data[alias] = null
          errors.push({ type: 'NOT_FOUND', message: `Could not resolve to a User ${login}` })
        }
      }
      return respond({ json: { data, ...(errors.length ? { errors } : {}) } })
    }
    const user = /\/users\/([^/]+)$/.exec(url.pathname)
    if (user) {
      if (options.rest) return respond(options.rest)
      const login = decodeURIComponent(user[1])
      if (!(login in PROFILES)) return respond({ status: 404, json: { message: 'Not Found' } })
      return respond({
        json: {
          login,
          name: PROFILES[login],
          avatar_url: `https://avatars.example.com/${login}?v=4`,
        },
      })
    }
    if (url.pathname.startsWith('/avatars/') || url.hostname.startsWith('avatars.')) {
      return respond({ bytes: PNG, headers: { 'Content-Type': 'image/png' } })
    }
    return respond({ status: 404, json: { message: 'Not Found' } })
  })
  return { request, calls }
}

const clientFor = (request: ReturnType<typeof github>['request'], token = 'tkn', server = '') =>
  new GithubClient(endpoints(server), token, request)

const memory = (): UserStorage & { text: string | null } => {
  const store = {
    text: null as string | null,
    read: async () => store.text,
    write: async (t: string) => {
      store.text = t
    },
  }
  return store
}

const graphqlCalls = (calls: RequestUrlParam[]) => calls.filter((c) => c.url.endsWith('/graphql'))
const pictureCalls = (calls: RequestUrlParam[]) =>
  calls.filter((c) => c.headers?.Accept === 'image/*')

afterEach(() => {
  vi.useRealTimers()
})

describe('looking people up', () => {
  it('asks for everyone shown in the same moment in one query, and draws their names', async () => {
    const { request, calls } = github()
    const users = new GithubUsers()
    const client = clientFor(request)

    await Promise.all([
      users.lookup(client, ['octocat']),
      users.lookup(client, ['hubot', 'octocat']),
    ])

    expect(graphqlCalls(calls)).toHaveLength(1)
    expect(users.person('github.com', 'octocat').name).toBe('The Octocat')
    expect(users.person('github.com', 'hubot').name).toBe('Hubot')
  })

  it('keeps the picture as a data URL, asked for at the size it is drawn at', async () => {
    const { request, calls } = github()
    const users = new GithubUsers()

    await users.lookup(clientFor(request), ['octocat'])

    expect(users.person('github.com', 'octocat').avatar).toBe('data:image/png;base64,iVBORw==')
    expect(pictureCalls(calls).map((c) => new URL(c.url).searchParams.get('s'))).toEqual(['40'])
  })

  it('shows the login for a profile with no name, and for one that does not exist', async () => {
    const { request } = github()
    const users = new GithubUsers()

    await users.lookup(clientFor(request), ['monalisa', 'nobody-here', 'octocat'])

    expect(users.person('github.com', 'monalisa').name).toBeNull()
    expect(users.person('github.com', 'nobody-here').name).toBeNull()
    // One missing login does not cost the others their names.
    expect(users.person('github.com', 'octocat').name).toBe('The Octocat')
  })

  it('asks nothing for an app or a deleted account, but still draws their picture', async () => {
    const { request, calls } = github()
    const users = new GithubUsers()

    await users.lookup(clientFor(request), ['dependabot[bot]', 'ghost'], {
      'dependabot[bot]': 'https://avatars.example.com/in/29110?v=4',
    })

    expect(graphqlCalls(calls)).toHaveLength(0)
    expect(users.person('github.com', 'dependabot[bot]').avatar).toMatch(/^data:image\/png/)
  })

  it('reads profiles one by one without a token, a few at a time', async () => {
    const { request, calls } = github()
    const users = new GithubUsers()
    const many = Array.from({ length: 14 }, (_, i) => `someone-${i}`)

    await users.lookup(clientFor(request, ''), ['octocat', ...many])

    expect(graphqlCalls(calls)).toHaveLength(0)
    const profiles = calls.filter((c) => c.url.includes('/users/'))
    expect(profiles).toHaveLength(10)
    expect(users.person('github.com', 'octocat').name).toBe('The Octocat')
  })

  it('falls back to REST when the server refuses GraphQL', async () => {
    const { request } = github({ graphql: false })
    const users = new GithubUsers()

    await users.lookup(clientFor(request), ['hubot'])

    expect(users.person('github.com', 'hubot').name).toBe('Hubot')
  })

  it('stops at a rate limit and does not ask again for ten minutes', async () => {
    let now = 1_000_000
    const { request, calls } = github({
      rest: {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        json: { message: 'API rate limit exceeded' },
      },
    })
    const users = new GithubUsers(null, () => now)
    const client = clientFor(request, '')

    await users.lookup(client, ['octocat', 'hubot'])
    expect(calls.filter((c) => c.url.includes('/users/'))).toHaveLength(1)

    await users.lookup(client, ['octocat', 'hubot'])
    expect(calls.filter((c) => c.url.includes('/users/'))).toHaveLength(1)

    now += 11 * 60 * 1000
    await users.lookup(client, ['octocat'])
    expect(calls.filter((c) => c.url.includes('/users/'))).toHaveLength(2)
  })
})

describe('kept for a week', () => {
  it('asks nothing again inside the week, and asks again after it', async () => {
    let now = 1_000_000
    const { request, calls } = github()
    const users = new GithubUsers(null, () => now)
    const client = clientFor(request)

    await users.lookup(client, ['octocat'])
    now += USER_TTL_MS - 1000
    await users.lookup(client, ['octocat'])
    expect(graphqlCalls(calls)).toHaveLength(1)
    expect(pictureCalls(calls)).toHaveLength(1)

    now += 2000
    await users.lookup(client, ['octocat'])
    expect(graphqlCalls(calls)).toHaveLength(2)
    expect(pictureCalls(calls)).toHaveLength(2)
  })

  it('comes back after a restart from what was written, without asking', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const storage = memory()
    const first = github()
    const before = new GithubUsers(storage)
    const lookup = before.lookup(clientFor(first.request), ['octocat'])
    await vi.advanceTimersByTimeAsync(100)
    await lookup
    // Written a moment later, not on every person met.
    expect(storage.text).toBeNull()
    await vi.advanceTimersByTimeAsync(3000)
    expect(storage.text).toContain('The Octocat')

    const second = github()
    const after = new GithubUsers(storage)
    await after.ready()
    expect(after.person('github.com', 'octocat')).toMatchObject({
      name: 'The Octocat',
      avatar: 'data:image/png;base64,iVBORw==',
    })
    await after.lookup(clientFor(second.request), ['octocat'])
    expect(second.calls).toHaveLength(0)
  })

  it('keeps each server’s people apart', async () => {
    const { request } = github()
    const users = new GithubUsers()

    await users.lookup(clientFor(request), ['octocat'])

    expect(users.person('git.example.com', 'octocat').name).toBeNull()
  })

  it('forgets everything, on disk too, when cleared', async () => {
    const storage = memory()
    const { request, calls } = github()
    const users = new GithubUsers(storage)
    await users.lookup(clientFor(request), ['octocat'])
    expect(users.size).toBe(1)

    await users.clear()

    expect(users.size).toBe(0)
    expect(users.person('github.com', 'octocat').name).toBeNull()
    expect(JSON.parse(storage.text!)).toEqual({ version: 1, people: {} })
    await users.lookup(clientFor(request), ['octocat'])
    expect(graphqlCalls(calls)).toHaveLength(2)
    // What the plugin does on the way out: the write still waiting goes now, not after the test.
    await users.save()
  })
})

describe('pictures and the token', () => {
  it('sends no token for a picture on github.com', async () => {
    const { request, calls } = github()
    await clientFor(request).image('https://avatars.githubusercontent.com/u/1?v=4')
    expect(calls[0].headers).not.toHaveProperty('Authorization')
  })

  it('sends the token for a picture on the Enterprise server, and on its subdomains', async () => {
    const { request, calls } = github()
    const client = clientFor(request, 'tkn', 'https://git.example.com')
    await client.image('https://git.example.com/avatars/u/3?s=40')
    await client.image('https://avatars.git.example.com/u/3?s=40')
    await client.image('https://avatars.example.com/u/3?s=40').catch(() => {})
    expect(calls.map((c) => c.headers?.Authorization)).toEqual([
      'Bearer tkn',
      'Bearer tkn',
      undefined,
    ])
  })

  it('refuses an answer that is not a picture', async () => {
    const request = vi.fn(async () =>
      respond({ json: { message: 'sign in' }, headers: { 'Content-Type': 'text/html' } })
    )
    await expect(clientFor(request).image('https://avatars.example.com/u/1')).rejects.toThrow(
      /picture/
    )
  })

  it('sizes a picture’s address, keeping what it had', () => {
    expect(sizedAvatar('https://avatars.githubusercontent.com/u/583231?v=4')).toBe(
      'https://avatars.githubusercontent.com/u/583231?v=4&s=40'
    )
    expect(sizedAvatar('https://git.example.com/avatars/u/3?s=460')).toBe(
      'https://git.example.com/avatars/u/3?s=40'
    )
  })
})

describe('the pictures API answers name', () => {
  const answering = (routes: Record<string, unknown>) =>
    clientFor(
      vi.fn(async (req: RequestUrlParam) => {
        const path = new URL(req.url).pathname
        return path in routes
          ? respond({ json: routes[path] })
          : respond({ status: 404, json: { message: 'Not Found' } })
      })
    )

  it('carries the author’s and each commenter’s picture from REST', async () => {
    const client = answering({
      '/repos/o/r/issues/5': {
        title: 't',
        number: 5,
        user: { login: 'octocat', avatar_url: 'https://avatars.example.com/u/1?v=4' },
        labels: [],
      },
      '/repos/o/r/issues/5/comments': [
        { id: 1, user: { login: 'hubot', avatar_url: 'https://avatars.example.com/u/2?v=4' } },
      ],
    })
    const t = { kind: 'issue', host: 'github.com', owner: 'o', repo: 'r', number: 5 } as const
    const issue = await loadIssue(client, t)
    expect(issue.authorAvatar).toBe('https://avatars.example.com/u/1?v=4')
    expect((await loadIssueConversation(client, t)).comments[0].avatar).toBe(
      'https://avatars.example.com/u/2?v=4'
    )
  })

  it('tells a commit linked to an account from one that is only a name in git', async () => {
    const client = answering({
      '/repos/o/r/commits/abc': {
        sha: 'abc',
        commit: { message: 'm', author: { name: 'Octo Cat', date: '2026-01-01' } },
        author: { login: 'octocat', avatar_url: 'https://avatars.example.com/u/1?v=4' },
        files: [],
      },
      '/repos/o/r/commits/def': {
        sha: 'def',
        commit: { message: 'm', author: { name: 'Someone Offline', date: '2026-01-01' } },
        author: null,
        files: [],
      },
    })
    const at = (sha: string) =>
      loadCommit(client, { kind: 'commit', host: 'github.com', owner: 'o', repo: 'r', sha })
    expect(await at('abc')).toMatchObject({ author: 'octocat', login: 'octocat' })
    const unlinked = await at('def')
    expect(unlinked.author).toBe('Someone Offline')
    expect(unlinked.login).toBeUndefined()
  })
})
