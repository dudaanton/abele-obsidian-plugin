/**
 * `github_grep`, the agent's search over a repository's code at one version: what it answers, how
 * it pages, which version a link means, and what it says when the repository is too big.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { RequestUrlParam } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS, GITHUB_TOKEN_KEY_ID } from '@/github/settings'
import { resetGithubClients } from '@/github/GithubService'
import { indexes } from '@/github/search/source'
import { createGithubTools } from '@/ai/tools/github'
import { useVault } from '../helpers/testEnv'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))
vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

const archive = new Uint8Array(
  readFileSync(resolve(__dirname, '../fixtures/github/widgets.tar.gz'))
)
const SHA = '9bafc7b0401748aa7ce64a89653af1a32c4c6143'
const HEAD = 'a'.repeat(40)
const API = 'https://api.github.com'

type Reply = { status?: number; json?: unknown; text?: string; bytes?: Uint8Array }

function serve(size = 100, extra: Record<string, Reply> = {}) {
  const tree = { json: { truncated: false, tree: [{ path: 'src/app.ts', type: 'blob', size }] } }
  const routes: Record<string, Reply> = {
    '/repos/acme/widgets': { json: { default_branch: 'main' } },
    '/repos/acme/widgets/commits/main': { text: SHA },
    [`/repos/acme/widgets/git/trees/${SHA}?recursive=1`]: tree,
    [`/repos/acme/widgets/tarball/${SHA}`]: { bytes: archive },
    [`/repos/acme/widgets/git/trees/${HEAD}?recursive=1`]: tree,
    [`/repos/acme/widgets/tarball/${HEAD}`]: { bytes: archive },
    '/repos/acme/widgets/pulls/3': { json: { head: { sha: HEAD } } },
    ...extra,
  }
  requestUrl.mockImplementation(async (req: RequestUrlParam) => {
    const url = req.url.replace(API, '')
    const r = routes[url] ?? { status: 404, json: { message: 'Not Found' } }
    const b = r.bytes ?? new Uint8Array()
    return {
      status: r.status ?? 200,
      headers: {},
      json: r.json,
      text: r.text ?? JSON.stringify(r.json ?? null),
      arrayBuffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    }
  })
}

const urls = () => requestUrl.mock.calls.map((c) => (c[0] as RequestUrlParam).url)

function configure(o: { token?: string; limitMb?: number } = {}) {
  const app = useVault([])
  resetGithubClients()
  if (o.token) app.secretStorage.setSecret(GITHUB_TOKEN_KEY_ID, o.token)
  AbeleConfig.getInstance().github = {
    ...DEFAULT_GITHUB_SETTINGS,
    enabled: true,
    keyId: o.token ? GITHUB_TOKEN_KEY_ID : '',
    searchLimitMb: o.limitMb ?? 1,
  }
}

const grep = async (params: Record<string, unknown>) => {
  const tool = createGithubTools().find((t) => t.name === 'github_grep')!
  return (await tool.execute('1', params)).content[0].text
}

beforeEach(() => {
  requestUrl.mockReset()
  indexes.clear()
  configure()
  serve()
})

describe('github_grep', () => {
  it('answers matching lines grouped by file, naming the commit it searched', async () => {
    const text = await grep({ repo: 'acme/widgets', query: 'formatName' })
    expect(text.split('\n')[0]).toBe(
      'acme/widgets@9bafc7b (main) — matching lines 1–3 of 3, in 2 files (5 searched)'
    )
    expect(text).toContain('src/app.ts\n  1: import { formatName }')
    expect(text).toContain('  7:     return formatName(this.name)')
    expect(text).toContain('src/util/format.ts\n  1: export const formatName')
  })

  it('pages through results with offset and limit, and says there are more', async () => {
    const first = await grep({ repo: 'acme/widgets', query: 'name', limit: 2 })
    expect(first).toMatch(/matching lines 1–2 of more than/)
    expect(first).toMatch(/higher offset/)
    const second = await grep({ repo: 'acme/widgets', query: 'name', limit: 2, offset: 2 })
    expect(second).toMatch(/matching lines 3–4/)
  })

  it('narrows to a glob and takes a regular expression', async () => {
    const text = await grep({ repo: 'acme/widgets', query: '^def \\w+', regex: true, path: '*.py' })
    expect(text).toMatch(/deep\.py\n {2}1: def format_name\(name\):/)
  })

  it('searches the head of a pull request, named by its link or as owner/repo#n', async () => {
    for (const repo of ['https://github.com/acme/widgets/pull/3', 'acme/widgets#3']) {
      indexes.clear()
      const text = await grep({ repo, query: 'Widget' })
      expect(text.startsWith('acme/widgets@aaaaaaa')).toBe(true)
    }
    expect(urls().some((u) => u.endsWith(`/tarball/${HEAD}`))).toBe(true)
  })

  it('lists file names in names mode', async () => {
    const text = await grep({ repo: 'acme/widgets', query: 'app', mode: 'names' })
    expect(text.split('\n').slice(1)).toEqual(['src/app.ts'])
  })

  it("falls back to GitHub's code search for a repository over the limit, and says so", async () => {
    configure({ token: 'tkn' })
    const q = encodeURIComponent('formatName repo:acme/widgets')
    serve(10 * 1024 * 1024, {
      [`/search/code?q=${q}&per_page=100`]: {
        json: {
          total_count: 1,
          items: [{ path: 'src/app.ts', text_matches: [{ fragment: 'formatName(x)' }] }],
        },
      },
    })
    const text = await grep({ repo: 'acme/widgets', query: 'formatName' })
    expect(text).toMatch(/more than the 1\.0 MB set/)
    expect(text).toMatch(/default branch only/)
    expect(text).toContain('src/app.ts\n  … formatName(x)')
    expect(urls().some((u) => u.includes('tarball'))).toBe(false)
  })

  it('refuses a regular expression it would have to hand to GitHub', async () => {
    serve(10 * 1024 * 1024)
    await expect(grep({ repo: 'acme/widgets', query: 'a+', regex: true })).rejects.toThrow(
      /no regular expressions/
    )
  })

  it('refuses a host that is neither github.com nor the configured server', async () => {
    await expect(grep({ repo: 'gitlab.example.com/acme/widgets', query: 'x' })).rejects.toThrow(
      /neither github.com/
    )
  })
})
