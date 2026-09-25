/**
 * What the "Open on GitHub" picker offers, against a scripted API: a number resolved to what it
 * is, titles, branches and commits found while typing, each question asked once, and refusals
 * said in the picker rather than swallowed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { parseOpenQuery, type QueryContext } from '@/github/open/query'
import { OpenSearch } from '@/github/open/search'

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> }

const respond = (r: Reply): RequestUrlResponse =>
  ({
    status: r.status ?? 200,
    headers: r.headers ?? {},
    json: r.json,
    text: JSON.stringify(r.json ?? null),
    arrayBuffer: new ArrayBuffer(0),
  }) as RequestUrlResponse

/** Answers by the longest matching path prefix (GraphQL by `graphql`); records every request. */
function fake(routes: Record<string, Reply | ((req: RequestUrlParam) => Reply)>) {
  const calls: RequestUrlParam[] = []
  const request = vi.fn(async (req: RequestUrlParam) => {
    calls.push(req)
    const path = decodeURIComponent(req.url.replace('https://api.github.com', ''))
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path.startsWith(k))
    if (!key) return respond({ status: 404, json: { message: 'Not Found' } })
    const route = routes[key]
    return respond(typeof route === 'function' ? route(req) : route)
  })
  return { request, calls }
}

const repo = { host: 'github.com', owner: 'octo-org', repo: 'octo-repo' }
const ctx: QueryContext = { hosts: ['github.com'], defaultHost: 'github.com', repo }
const R = '/repos/octo-org/octo-repo'

function setup(routes: Parameters<typeof fake>[0], token = '') {
  const { request, calls } = fake(routes)
  const client = new GithubClient(endpoints(''), token, request)
  const search = new OpenSearch(() => client)
  const run = async (input: string, context = ctx) => {
    const q = parseOpenQuery(input, context)
    await search.fetch(q, 'github.com')
    return search.view(q, 'github.com', context.repo)
  }
  return { search, calls, run }
}

beforeEach(() => {
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true }
})

describe('a number', () => {
  it('that is a pull request opens as one, with its title', async () => {
    const { run } = setup({
      [`${R}/issues/12`]: {
        json: { number: 12, title: 'Fix login', state: 'open', pull_request: { merged_at: null } },
      },
    })
    const view = await run('#12')
    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: 'pull',
        title: 'Fix login',
        url: 'https://github.com/octo-org/octo-repo/pull/12',
      }),
    ])
    expect(view.rows[0].note).toContain('open')
  })

  it('that is an issue opens as one', async () => {
    const { run } = setup({
      [`${R}/issues/3`]: { json: { number: 3, title: 'Crash', state: 'closed' } },
    })
    const [row] = (await run('3')).rows
    expect(row).toMatchObject({
      kind: 'issue',
      url: 'https://github.com/octo-org/octo-repo/issues/3',
    })
    expect(row.note).toContain('closed')
  })

  it('the issues API does not know is a discussion, confirmed with a token', async () => {
    const { run, calls } = setup(
      {
        '/graphql': {
          json: { data: { repository: { discussion: { title: 'Ideas', isAnswered: true } } } },
        },
      },
      'tkn'
    )
    const [row] = (await run('#9')).rows
    expect(row).toMatchObject({
      kind: 'discussion',
      title: 'Ideas',
      url: 'https://github.com/octo-org/octo-repo/discussions/9',
    })
    expect(JSON.parse(String(calls[1].body)).variables).toEqual({
      owner: 'octo-org',
      repo: 'octo-repo',
      number: 9,
    })
  })

  it('without a token is offered as a discussion, saying why it cannot be confirmed', async () => {
    const { run, calls } = setup({})
    const [row] = (await run('#9')).rows
    expect(row.kind).toBe('discussion')
    expect(row.note).toMatch(/token/)
    expect(calls.map((c) => c.url)).not.toContain('https://api.github.com/graphql')
  })

  it('shows a row at once that opens after asking, before the answer is in', async () => {
    const { search } = setup({
      [`${R}/issues/12`]: { json: { number: 12, title: 'Fix', state: 'open', pull_request: {} } },
    })
    const q = parseOpenQuery('#12', ctx)
    const view = search.view(q, 'github.com', repo)
    expect(view.pending).toBe(true)
    expect(view.rows[0].title).toBe('#12')
    await expect(view.rows[0].resolve!()).resolves.toBe(
      'https://github.com/octo-org/octo-repo/pull/12'
    )
  })

  it('in no repository asks which', () => {
    const { search } = setup({})
    const q = parseOpenQuery('#12', { ...ctx, repo: null })
    const view = search.view(q, 'github.com', null)
    expect(view.rows).toEqual([])
    expect(view.message).toMatch(/owner\/repo#12/)
  })
})

describe('words', () => {
  it('find issues and pull requests by title, and matching branches', async () => {
    const { run, calls } = setup({
      '/search/issues': {
        json: {
          items: [
            { number: 5, title: 'Login fails', state: 'open' },
            { number: 6, title: 'Login page', state: 'closed', pull_request: { merged_at: 'x' } },
          ],
        },
      },
      [`${R}/branches`]: { json: [{ name: 'main' }, { name: 'fix-login' }, { name: 'login' }] },
    })
    const view = await run('login')
    expect(view.rows.map((r) => [r.kind, r.title])).toEqual([
      ['issue', 'Login fails'],
      ['pull', 'Login page'],
      ['branch', 'login'],
      ['branch', 'fix-login'],
    ])
    expect(view.rows[1].note).toContain('merged')
    expect(view.rows[2].url).toBe('https://github.com/octo-org/octo-repo/tree/login')
    const searched = calls.find((c) => c.url.includes('/search/issues'))!
    expect(decodeURIComponent(searched.url)).toContain('q=repo:octo-org/octo-repo login in:title')
  })

  it('ask each question once, and narrow the kept branch list as typing goes on', async () => {
    const { run, calls } = setup({
      '/search/issues': { json: { items: [] } },
      [`${R}/branches`]: { json: [{ name: 'feat/a' }, { name: 'feat/b' }] },
    })
    await run('feat')
    const view = await run('feat/b')
    expect(view.rows.map((r) => r.title)).toEqual(['feat/b'])
    expect(view.rows[0].url).toBe('https://github.com/octo-org/octo-repo/tree/feat/b')
    await run('feat')
    expect(calls.filter((c) => c.url.includes('/branches')).length).toBe(1)
    expect(calls.filter((c) => c.url.includes('/search/issues')).length).toBe(2)
  })

  it('search discussions too when there is a token', async () => {
    const { run } = setup(
      {
        '/search/issues': { json: { items: [] } },
        [`${R}/branches`]: { json: [] },
        '/graphql': {
          json: { data: { search: { nodes: [{ number: 4, title: 'Roadmap' }, {}] } } },
        },
      },
      'tkn'
    )
    const view = await run('road')
    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: 'discussion',
        url: 'https://github.com/octo-org/octo-repo/discussions/4',
      }),
    ])
  })

  it('past a full page of branches ask GitHub by prefix as well', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}` }))
    const { run, calls } = setup({
      '/search/issues': { json: { items: [] } },
      [`${R}/branches`]: { json: many },
      [`${R}/git/matching-refs/heads/release`]: { json: [{ ref: 'refs/heads/release/2.0' }] },
    })
    const view = await run('release')
    expect(view.rows.map((r) => r.title)).toEqual(['release/2.0'])
    expect(calls.some((c) => c.url.endsWith('/git/matching-refs/heads/release'))).toBe(true)
  })

  it('that look like a SHA find the commit', async () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12'
    const { run } = setup({
      '/search/issues': { json: { items: [] } },
      [`${R}/branches`]: { json: [] },
      [`${R}/commits/abcdef1`]: {
        json: { sha, commit: { message: 'Fix the thing\n\nbody', author: { name: 'Mona' } } },
      },
    })
    const view = await run('abcdef1')
    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: 'commit',
        title: 'Fix the thing',
        url: `https://github.com/octo-org/octo-repo/commit/${sha}`,
      }),
    ])
  })

  it('shaped like owner/repo offer that repository at its default branch', async () => {
    const { run } = setup({
      '/repos/feat/login': {
        json: {
          default_branch: 'trunk',
          description: 'A thing',
          name: 'login',
          owner: { login: 'feat' },
        },
      },
      '/search/issues': { json: { items: [] } },
      [`${R}/branches`]: { json: [] },
    })
    const view = await run('feat/login')
    expect(view.rows).toEqual([
      expect.objectContaining({ kind: 'repo', url: 'https://github.com/feat/login/tree/trunk' }),
    ])
  })

  it('with no repository at all search repositories by name', async () => {
    const { run } = setup({
      '/search/repositories': {
        json: {
          items: [{ name: 'octo-repo', owner: { login: 'octo-org' }, default_branch: 'main' }],
        },
      },
    })
    const view = await run('octo', { ...ctx, repo: null })
    expect(view.rows).toEqual([
      expect.objectContaining({ kind: 'repo', title: 'octo-org/octo-repo' }),
    ])
  })

  it('say when GitHub’s search limit is used up, instead of showing nothing', async () => {
    const { run } = setup({
      '/search/issues': {
        status: 403,
        json: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-resource': 'search' },
      },
      [`${R}/branches`]: { json: [] },
    })
    const view = await run('login')
    expect(view.rows).toEqual([])
    expect(view.message).toMatch(/few searches a minute/)
  })

  it('keep what was found and add the refusal as a line under it', async () => {
    const { run } = setup({
      '/search/issues': {
        status: 403,
        json: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0' },
      },
      [`${R}/branches`]: { json: [{ name: 'login' }] },
    })
    const view = await run('login')
    expect(view.rows.map((r) => r.kind)).toEqual(['branch', 'note'])
  })
})

describe('a pasted link', () => {
  it('opens as it is, asking nothing', async () => {
    const { run, calls } = setup({})
    const view = await run('https://github.com/octo-org/octo-repo/pull/12/files')
    expect(view.rows).toEqual([
      expect.objectContaining({
        kind: 'pull',
        url: 'https://github.com/octo-org/octo-repo/pull/12/files',
      }),
    ])
    expect(calls).toEqual([])
  })

  it('to a repository opens its default branch', async () => {
    const { run } = setup({ [R]: { json: { default_branch: 'main' } } })
    const [row] = (await run('https://github.com/octo-org/octo-repo')).rows
    expect(row.url).toBe('https://github.com/octo-org/octo-repo/tree/main')
  })

  it('to another host says whose it is', async () => {
    const { run } = setup({})
    expect((await run('https://example.com/a/b/pull/1')).message).toMatch(/example\.com/)
  })
})

describe('a comparison', () => {
  it('typed as base...head is offered at once, asking GitHub nothing', async () => {
    const { run, calls } = setup({})
    const view = await run('main...dev')
    expect(calls).toHaveLength(0)
    expect(view.rows).toEqual([
      {
        kind: 'compare',
        title: 'main...dev',
        note: 'octo-org/octo-repo · Comparison · what dev has that main has not',
        url: 'https://github.com/octo-org/octo-repo/compare/main...dev',
        repo,
      },
    ])
  })

  it('without a repository asks for one', async () => {
    const { run } = setup({})
    const view = await run('main...dev', { ...ctx, repo: null })
    expect(view.rows).toEqual([])
    expect(view.message).toMatch(/which repository/)
  })

  it('as a link is a comparison row', async () => {
    const { run } = setup({})
    const view = await run('https://github.com/octo-org/octo-repo/compare/v1..v2')
    expect(view.rows[0]).toMatchObject({ kind: 'compare', title: 'octo-org/octo-repo v1..v2' })
  })
})
