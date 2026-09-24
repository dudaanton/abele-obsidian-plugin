/**
 * The GitHub tools an agent reads GitHub with: `github_read`, `github_pr_files`, `github_file`,
 * `github_commits`, `github_search`.
 *
 * What matters to the person: an agent gets a part of a pull request at a time and is told where
 * the rest is, never the whole thing; the tools send the same token to the same server as the
 * tabs do and are refused in the same words; and they exist only while GitHub is switched on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RequestUrlParam } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS, GITHUB_TOKEN_KEY_ID } from '@/github/settings'
import { resetGithubClients } from '@/github/GithubService'
import { createGithubTools } from '@/ai/tools/github'
import { MAX_OUTPUT, answer } from '@/ai/tools/github/shared'
import { createAgentTools, getToolRegistry } from '@/ai/tools'
import { DEFAULT_AI_SETTINGS, GITHUB_TOOLS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

type Reply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }
type Route = Reply | ((req: RequestUrlParam) => Reply)

const API = 'https://api.github.com'

/** Answers by path, query ignored unless the route names one; records every request. */
function serve(routes: Record<string, Route>, api = API) {
  requestUrl.mockImplementation(async (req: RequestUrlParam) => {
    const url = req.url.replace(api, '')
    const path = url.replace(/[?].*$/, '')
    const key = routes[url] !== undefined ? url : routes[path] !== undefined ? path : null
    const route: Route = key ? routes[key] : { status: 404, json: { message: 'Not Found' } }
    const r = typeof route === 'function' ? route(req) : route
    return {
      status: r.status ?? 200,
      headers: r.headers ?? {},
      json: r.json,
      text: r.text ?? JSON.stringify(r.json ?? null),
      arrayBuffer: new ArrayBuffer(0),
    }
  })
}

const urls = () => requestUrl.mock.calls.map((c) => (c[0] as RequestUrlParam).url)

function configure(o: { token?: string; server?: string; enabled?: boolean } = {}) {
  const app = useVault([])
  resetGithubClients()
  if (o.token) app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, o.token)
  AbeleConfig.getInstance().github = {
    ...DEFAULT_GITHUB_SETTINGS,
    enabled: o.enabled ?? true,
    keyId: o.token ? GITHUB_TOKEN_KEY_ID : '',
    server: o.server ?? '',
  }
  return app
}

const tool = (name: string) => createGithubTools().find((t) => t.name === name)!

async function run(name: string, params: Record<string, unknown>): Promise<string> {
  const result = await tool(name).execute('call-1', params)
  return result.content[0].text
}

const ISSUE = {
  title: 'Crash on start',
  number: 5,
  html_url: 'https://github.com/acme/widgets/issues/5',
  user: { login: 'bob' },
  created_at: '2026-01-01T10:00:00Z',
  state: 'open',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  body: 'It **crashes** on start.',
}

const PULL = {
  title: 'Fix the crash',
  number: 7,
  html_url: 'https://github.com/acme/widgets/pull/7',
  user: { login: 'ann' },
  created_at: '2026-01-02T10:00:00Z',
  state: 'open',
  draft: false,
  labels: [],
  body: 'Fixes #5',
  base: { ref: 'main' },
  head: { label: 'ann:fix' },
  additions: 2,
  deletions: 1,
  changed_files: 2,
  commits: 1,
}

const comment = (n: number) => ({
  id: n,
  user: { login: `user${n}` },
  body: `Comment number ${n}`,
  created_at: `2026-01-02T10:${String(n).padStart(2, '0')}:00Z`,
  html_url: `https://github.com/acme/widgets/issues/5#issuecomment-${n}`,
})

const PATCH = '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d'

const prFile = (filename: string, patch: string | undefined = PATCH) => ({
  filename,
  status: 'modified',
  additions: 2,
  deletions: 1,
  patch,
})

beforeEach(() => {
  requestUrl.mockReset()
  configure()
})

describe('offered', () => {
  it('only while the GitHub integration is on', () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    const names = () => createAgentTools().map((t) => t.name)

    configure({ enabled: false })
    expect(names().filter((n) => n.startsWith('github_'))).toEqual([])

    configure({ enabled: true })
    expect(
      names()
        .filter((n) => n.startsWith('github_'))
        .sort()
    ).toEqual([...GITHUB_TOOLS].sort())
  })

  it('as a GitHub group in the agent settings', () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    const github = getToolRegistry().filter((t) => t.category === 'GitHub')
    expect(github.map((t) => t.name).sort()).toEqual([...GITHUB_TOOLS].sort())
  })
})

describe('github_read', () => {
  const routes = (comments: unknown[]) => ({
    '/repos/acme/widgets/issues/5': { json: ISSUE },
    '/repos/acme/widgets/issues/5/comments': { json: comments },
  })

  it('reads an issue by owner/repo#n: its head, description and comments', async () => {
    serve(routes([comment(1)]))
    const out = await run('github_read', { item: 'acme/widgets#5' })
    expect(out).toContain('Issue acme/widgets#5 — Crash on start')
    expect(out).toContain('State: open · by bob · opened 2026-01-01')
    expect(out).toContain('Labels: bug')
    expect(out).toContain('It **crashes** on start.')
    expect(out).toContain('comments 1–1 of 1')
    expect(out).toContain('Comment number 1')
  })

  it('pages the conversation twenty at a time and says where the rest is', async () => {
    serve(routes(Array.from({ length: 25 }, (_, i) => comment(i + 1))))
    const first = await run('github_read', { item: 'https://github.com/acme/widgets/issues/5' })
    expect(first).toContain('comments 1–20 of 25')
    expect(first).toContain('Comment number 20')
    expect(first).not.toContain('Comment number 21')
    expect(first).toContain('page=2')

    const second = await run('github_read', { item: 'acme/widgets#5', page: 2 })
    expect(second).toContain('comments 21–25 of 25')
    expect(second).not.toContain('## Description')
    expect(second).not.toContain('page=3')
  })

  it('reads a number that is a pull request as the pull request', async () => {
    serve({
      '/repos/acme/widgets/issues/7': { json: { ...ISSUE, number: 7, pull_request: {} } },
      '/repos/acme/widgets/issues/7/comments': { json: [] },
      '/repos/acme/widgets/pulls/7': { json: PULL },
      '/repos/acme/widgets/pulls/7/reviews': {
        json: [
          {
            id: 3,
            user: { login: 'eve' },
            body: 'Looks good',
            state: 'APPROVED',
            submitted_at: '2026-01-03T00:00:00Z',
          },
        ],
      },
    })
    const out = await run('github_read', { item: 'acme/widgets#7' })
    expect(out).toContain('Pull request acme/widgets#7 — Fix the crash')
    expect(out).toContain('ann:fix → main')
    expect(out).toContain('Looks good')
    expect(out).toContain('github_pr_files')
  })

  it("answers a refusal in the tabs' own words", async () => {
    serve({})
    await expect(run('github_read', { item: 'acme/widgets#5' })).rejects.toThrow(
      'GitHub found nothing for the issue'
    )
  })

  it('reads owner/repo#n that is neither an issue nor a pull request as a discussion', async () => {
    configure({ token: 'ghp_x' })
    serve({
      '/graphql': {
        json: {
          data: {
            repository: {
              discussion: {
                title: 'How to configure?',
                number: 3,
                url: 'https://github.com/acme/widgets/discussions/3',
                body: 'Asking.',
                createdAt: '2026-01-01T00:00:00Z',
                closed: false,
                isAnswered: true,
                author: { login: 'kim' },
                category: { name: 'Q&A' },
                labels: { nodes: [] },
                comments: {
                  totalCount: 1,
                  nodes: [
                    {
                      id: 'c1',
                      databaseId: 1,
                      body: 'Like this.',
                      createdAt: '2026-01-02T00:00:00Z',
                      isAnswer: true,
                      url: 'https://github.com/acme/widgets/discussions/3#discussioncomment-1',
                      author: { login: 'ann' },
                      replies: { totalCount: 0, nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    })
    const out = await run('github_read', { item: 'acme/widgets#3' })
    expect(out).toContain('Discussion acme/widgets#3 — How to configure?')
    expect(out).toContain('Answer · ann')
  })

  it('sends a file link to the tool that reads files', async () => {
    await expect(
      run('github_read', { item: 'https://github.com/acme/widgets/blob/main/a.ts' })
    ).rejects.toThrow('github_file')
  })

  it('refuses a host that is not GitHub rather than sending it the token', async () => {
    await expect(
      run('github_read', { item: 'https://git.example.org/acme/widgets' })
    ).rejects.toThrow('neither github.com nor the GitHub server')
  })
})

describe('github_pr_files', () => {
  const routes = (files: unknown[]) => ({
    '/repos/acme/widgets/pulls/7/files': { json: files },
    '/repos/acme/widgets/pulls/7/comments': {
      json: [
        {
          id: 11,
          path: 'src/app.ts',
          user: { login: 'eve' },
          body: 'Why c?',
          created_at: '2026-01-03T00:00:00Z',
          side: 'RIGHT',
          line: 2,
        },
      ],
    },
  })

  it('lists the files with their counts, and no diff', async () => {
    serve(routes([prFile('src/app.ts'), prFile('README.md')]))
    const out = await run('github_pr_files', { item: 'https://github.com/acme/widgets/pull/7' })
    expect(out).toContain('2 files changed, +4 −2')
    expect(out).toContain('src/app.ts  [1 review comment]')
    expect(out).toContain('README.md')
    expect(out).not.toContain('+c')
  })

  it("shows one file's diff numbered on both sides, with its review comments", async () => {
    serve(routes([prFile('src/app.ts'), prFile('README.md')]))
    const out = await run('github_pr_files', { item: 'acme/widgets#7', path: 'app.ts' })
    expect(out).toContain('src/app.ts — modified, +2 −1 — diff rows 1–5 of 5')
    expect(out).toContain('    1     1  a')
    expect(out).toContain('    2       -b')
    expect(out).toContain('          2 +c')
    expect(out).toContain('Why c?')
  })

  it('reads a long diff a window at a time and says where the next one starts', async () => {
    const long =
      '@@ -1,0 +1,900 @@\n' + Array.from({ length: 900 }, (_, i) => `+line ${i + 1}`).join('\n')
    serve(routes([prFile('big.ts', long)]))
    const first = await run('github_pr_files', { item: 'acme/widgets#7', path: 'big.ts' })
    expect(first).toContain('diff rows 1–400 of 901')
    expect(first).toContain('offset=401')
    expect(first).not.toContain('line 400\n')

    const next = await run('github_pr_files', {
      item: 'acme/widgets#7',
      path: 'big.ts',
      offset: 401,
      limit: 10,
    })
    expect(next).toContain('diff rows 401–410 of 901')
    expect(next).toContain('+line 400')
  })

  it('says a file has no diff to send rather than showing nothing', async () => {
    serve(routes([{ ...prFile('logo.png'), patch: undefined }]))
    const out = await run('github_pr_files', { item: 'acme/widgets#7', path: 'logo.png' })
    expect(out).toContain('binary')
  })

  it('names the files a path could mean when it is not one of them', async () => {
    serve(routes([prFile('src/app.ts'), prFile('test/app.ts')]))
    await expect(
      run('github_pr_files', { item: 'acme/widgets#7', path: 'app.ts' })
    ).rejects.toThrow('matches several changed files: src/app.ts, test/app.ts')
  })
})

describe('github_file', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `row ${i + 1}`).join('\n')
  const b64 = (s: string) => btoa(s)

  it('reads the lines a blob link marks', async () => {
    serve({
      '/repos/acme/widgets/contents/src/app.ts?ref=main': {
        json: { type: 'file', encoding: 'base64', content: b64(lines(30)) },
      },
    })
    const out = await run('github_file', {
      repo: 'https://github.com/acme/widgets/blob/main/src/app.ts#L10-L12',
    })
    expect(out).toContain('acme/widgets@main · src/app.ts — 30 lines, showing 10–12')
    expect(out).toContain('10  row 10')
    expect(out).toContain('12  row 12')
    expect(out).not.toContain('row 13')
  })

  it('gives a long file 400 lines at a time, saying where to go on', async () => {
    serve({
      '/repos/acme/widgets/contents/big.ts': {
        json: { type: 'file', encoding: 'base64', content: b64(lines(1000)) },
      },
    })
    const out = await run('github_file', { repo: 'acme/widgets', path: 'big.ts' })
    expect(out).toContain('1000 lines, showing 1–400')
    expect(out).toContain('start_line=401')

    const window = await run('github_file', {
      repo: 'acme/widgets',
      path: 'big.ts',
      start_line: 990,
    })
    expect(window).toContain('showing 990–1000')
  })

  it('lists a folder, folders first', async () => {
    serve({
      '/repos/acme/widgets/contents/src': {
        json: [
          { name: 'b.ts', type: 'file', size: 10 },
          { name: 'lib', type: 'dir' },
        ],
      },
    })
    const out = await run('github_file', { repo: 'acme/widgets', path: 'src' })
    expect(out.split('\n').slice(1)).toEqual(['lib/', 'b.ts  (10 bytes)'])
  })

  it('maps the whole tree of an unknown codebase, from the default branch', async () => {
    serve({
      '/repos/acme/widgets': { json: { default_branch: 'trunk' } },
      '/repos/acme/widgets/git/trees/trunk': {
        json: {
          tree: [
            { path: 'src', type: 'tree' },
            { path: 'src/app.ts', type: 'blob' },
            { path: 'README.md', type: 'blob' },
          ],
        },
      },
    })
    const out = await run('github_file', { repo: 'acme/widgets', recursive: true })
    expect(out).toContain('acme/widgets@trunk — 3 entries')
    expect(out).toContain('src/\nsrc/app.ts\nREADME.md')
  })

  it('asks an Enterprise server at its own API address, with its token', async () => {
    configure({ server: 'https://github.example.com', token: 'ghp_x' })
    serve(
      {
        '/repos/acme/widgets/contents/a.ts': {
          json: { type: 'file', encoding: 'base64', content: b64('one') },
        },
      },
      'https://github.example.com/api/v3'
    )
    const out = await run('github_file', { repo: 'acme/widgets', path: 'a.ts' })
    expect(out).toContain('1  one')
    const req = requestUrl.mock.calls[0][0] as RequestUrlParam
    expect(req.url).toBe('https://github.example.com/api/v3/repos/acme/widgets/contents/a.ts')
    expect(req.headers?.Authorization).toBe('Bearer ghp_x')
  })
})

describe('github_commits', () => {
  const commit = (files: unknown[]) => ({
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
    html_url: 'https://github.com/acme/widgets/commit/abcdef1',
    author: { login: 'ann' },
    commit: {
      message: 'Fix the crash\n\nIt no longer crashes.',
      author: { date: '2026-01-02T00:00:00Z' },
    },
    files,
  })

  it("shows one commit's message, files and diffs", async () => {
    serve({ '/repos/acme/widgets/commits/abcdef1': { json: commit([prFile('src/app.ts')]) } })
    const out = await run('github_commits', {
      repo: 'https://github.com/acme/widgets/commit/abcdef1',
    })
    expect(out).toContain('Commit acme/widgets@abcdef1 — ann, 2026-01-02')
    expect(out).toContain('It no longer crashes.')
    expect(out).toContain('          2 +c')
  })

  it('stops showing diffs once they get long, and names the ones left out', async () => {
    const long = '@@ -1,0 +1,300 @@\n' + Array.from({ length: 300 }, (_, i) => `+x${i}`).join('\n')
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map((n) => prFile(n, long))
    serve({ '/repos/acme/widgets/commits/abcdef1': { json: commit(files) } })
    const out = await run('github_commits', { repo: 'acme/widgets', sha: 'abcdef1' })
    expect(out).toContain('Diffs not shown')
    expect(out).toContain('d.ts')
  })

  it('compares two refs from a compare link', async () => {
    serve({
      '/repos/acme/widgets/compare/main...feature': {
        json: {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [commit([])],
          files: [prFile('src/app.ts')],
        },
      },
    })
    const out = await run('github_commits', {
      repo: 'https://github.com/acme/widgets/compare/main...feature',
    })
    expect(out).toContain('Compare acme/widgets main...feature — ahead: 1 ahead, 0 behind')
    expect(out).toContain('abcdef1  2026-01-02  ann  Fix the crash')
    expect(out).toContain('+c')
  })

  it("lists a pull request's commits", async () => {
    serve({ '/repos/acme/widgets/pulls/7/commits': { json: [commit([])] } })
    const out = await run('github_commits', { repo: 'acme/widgets#7' })
    expect(out).toContain('Pull request acme/widgets#7 — 1 commit (1–1)')
    expect(out).toContain('abcdef1  2026-01-02  ann  Fix the crash')
  })

  it("lists a file's history on a branch", async () => {
    serve({ '/repos/acme/widgets/commits': { json: [commit([])] } })
    const out = await run('github_commits', {
      repo: 'acme/widgets',
      ref: 'dev',
      path: 'src/app.ts',
    })
    expect(out).toContain('commits on dev touching src/app.ts')
    expect(urls()[0]).toContain('sha=dev&path=src%2Fapp.ts')
  })
})

describe('github_search', () => {
  it('says code search needs a token, in the refusal words and what to do instead', async () => {
    serve({ '/search/code': { status: 401, json: { message: 'Requires authentication' } } })
    const error = await run('github_search', { query: 'useState', type: 'code' }).catch((e) => e)
    expect(error.message).toContain('GitHub asks for a token to show code search')
    expect(error.message).toContain('github_file')
  })

  it('finds code with its matching fragments, within one repository', async () => {
    configure({ token: 'ghp_x' })
    serve({
      '/search/code': {
        json: {
          total_count: 1,
          items: [
            {
              path: 'src/app.ts',
              html_url: 'https://github.com/acme/widgets/blob/abc/src/app.ts',
              repository: { full_name: 'acme/widgets' },
              text_matches: [{ fragment: 'const x = useState()' }],
            },
          ],
        },
      },
    })
    const out = await run('github_search', {
      query: 'useState',
      type: 'code',
      repo: 'acme/widgets',
    })
    expect(out).toContain('acme/widgets · src/app.ts')
    expect(out).toContain('    const x = useState()')
    expect(decodeURIComponent(urls()[0])).toContain('q=useState repo:acme/widgets')
  })

  it('finds issues and pull requests, telling them apart', async () => {
    serve({
      '/search/issues': {
        json: {
          total_count: 45,
          items: [
            {
              number: 7,
              title: 'Fix the crash',
              state: 'closed',
              pull_request: { merged_at: '2026-01-05T00:00:00Z' },
              repository_url: 'https://api.github.com/repos/acme/widgets',
              user: { login: 'ann' },
              updated_at: '2026-01-05T00:00:00Z',
              html_url: 'https://github.com/acme/widgets/pull/7',
            },
          ],
        },
      },
    })
    const out = await run('github_search', { query: 'crash', type: 'issues' })
    expect(out).toContain('acme/widgets#7 [PR, merged] Fix the crash')
    expect(out).toContain('page=2')
  })
})

describe('size', () => {
  it('holds every answer to the cap and says how to ask for less', () => {
    const text = answer('x'.repeat(MAX_OUTPUT + 500)).content[0].text
    expect(text.length).toBeLessThan(MAX_OUTPUT + 200)
    expect(text).toContain('Truncated')
  })
})
