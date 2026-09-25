/**
 * A comparison of two versions, read from GitHub: the counts, every commit a page at a time, the
 * files from the first page, and what is said when the answer is not the whole story.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { RequestUrlParam } from 'obsidian'
import { clientWith, type Route } from '../helpers/githubTab'
import { loadCompare, MAX_FILES } from '@/github/compare'
import { parseGithubUrl } from '@/github/urls'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
})

const target = (url: string) => {
  const t = parseGithubUrl(url, ['github.com'])
  if (t?.kind !== 'compare') throw new Error('not a comparison')
  return t
}

const SHA_HEAD = 'a'.repeat(40)
const SHA_BASE = 'b'.repeat(40)

const commit = (n: number) => ({
  sha: n.toString(16).padStart(40, '0'),
  commit: { message: `Commit ${n}`, author: { name: 'Mona', date: '2026-01-01T00:00:00Z' } },
  author: { login: 'octocat' },
})

const changed = (name: string, status = 'modified', ref = SHA_HEAD) => ({
  filename: name,
  status,
  additions: 1,
  deletions: 1,
  patch: '@@ -1 +1 @@\n-a\n+b',
  contents_url: `https://api.github.com/repos/octocat/Hello-World/contents/${name}?ref=${ref}`,
})

const page = (url: string) => Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1)

describe('a comparison', () => {
  it('reads the counts, the files and every page of commits', async () => {
    const total = 230
    const { client, request } = clientWith({
      '/repos/octocat/Hello-World/compare/main...feature/x': (req: RequestUrlParam) => {
        const p = page(req.url)
        const from = (p - 1) * 100
        const commits = Array.from({ length: Math.min(100, total - from) }, (_, i) =>
          commit(from + i + 1)
        )
        return {
          json: {
            status: 'diverged',
            ahead_by: total,
            behind_by: 3,
            total_commits: total,
            merge_base_commit: { sha: SHA_BASE },
            commits,
            files: p === 1 ? [changed('gone.md', 'removed', SHA_BASE), changed('app.ts')] : [],
          },
        }
      },
    })
    const d = await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/main...feature/x')
    )

    expect(d).toMatchObject({
      base: 'main',
      head: 'feature/x',
      status: 'diverged',
      aheadBy: 230,
      behindBy: 3,
      totalCommits: 230,
      commitsComplete: true,
      filesComplete: true,
      additions: 2,
      deletions: 2,
      mergeBaseSha: SHA_BASE,
      // Head's commit comes from a file it keeps, never from one it removes.
      headSha: SHA_HEAD,
      url: 'https://github.com/octocat/Hello-World/compare/main...feature/x',
    })
    expect(d.commits.map((c) => c.message)).toEqual(
      Array.from({ length: total }, (_, i) => `Commit ${i + 1}`)
    )
    expect(d.files.map((f) => f.path)).toEqual(['gone.md', 'app.ts'])
    const asked = request.mock.calls.map((c) => (c[0] as RequestUrlParam).url)
    expect(asked.map(page).sort()).toEqual([1, 2, 3])
    expect(asked.every((u) => u.includes('per_page=100'))).toBe(true)
  })

  it('compares a lone ref with the default branch', async () => {
    const { client, request } = clientWith({
      '/repos/octocat/Hello-World': { json: { default_branch: 'master' } },
      '/repos/octocat/Hello-World/compare/master...topic': {
        json: {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [commit(1)],
          files: [],
        },
      },
    })
    const d = await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/topic')
    )
    expect(d.base).toBe('master')
    // No file says where head is: the last commit, all of them read, is head's own.
    expect(d.headSha).toBe(commit(1).sha)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('asks for two dots as three, and says what that means when the two have diverged', async () => {
    const { client, request } = clientWith({
      '/repos/octocat/Hello-World/compare/v1...v2': {
        json: {
          status: 'diverged',
          ahead_by: 1,
          behind_by: 1,
          total_commits: 1,
          commits: [commit(1)],
          files: [],
        },
      },
    })
    const d = await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/v1..v2')
    )
    expect((request.mock.calls[0][0] as RequestUrlParam).url).toContain('/compare/v1...v2?')
    expect(d.direct).toBe(true)
    expect(d.note).toMatch(/only from where the two branches split/)
    expect(d.url).toBe('https://github.com/octocat/Hello-World/compare/v1..v2')
  })

  it('says nothing about two dots when base is where head started', async () => {
    const { client } = clientWith({
      '/repos/octocat/Hello-World/compare/v1...v2': {
        json: {
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          commits: [commit(1)],
          files: [],
        },
      },
    })
    const d = await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/v1..v2')
    )
    expect(d.note).toBeUndefined()
  })

  it('keeps colons of a fork and slashes of a branch in the request', async () => {
    const { client, request } = clientWith({
      '/repos/octocat/Hello-World/compare/main...someone:Hello-World:fix/it': {
        json: {
          status: 'ahead',
          ahead_by: 0,
          behind_by: 0,
          total_commits: 0,
          commits: [],
          files: [],
        },
      },
    })
    await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/main...someone:Hello-World:fix/it')
    )
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('stops at ten pages, and at 300 files says the rest are on GitHub', async () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) => changed(`f${i}.ts`))
    const { client, request } = clientWith({
      '/repos/octocat/Hello-World/compare/a...b': (req: RequestUrlParam) => ({
        json: {
          status: 'ahead',
          ahead_by: 5000,
          behind_by: 0,
          total_commits: 5000,
          commits: Array.from({ length: 100 }, (_, i) => commit((page(req.url) - 1) * 100 + i)),
          files: page(req.url) === 1 ? files : [],
        },
      }),
    })
    const d = await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/a...b')
    )
    expect(request).toHaveBeenCalledTimes(10)
    expect(d.commits).toHaveLength(1000)
    expect(d.commitsComplete).toBe(false)
    expect(d.filesComplete).toBe(false)
  })

  it('is a refusal when GitHub has no such comparison', async () => {
    const { client } = clientWith({})
    await expect(
      loadCompare(client, target('https://github.com/octocat/Hello-World/compare/a...b'))
    ).rejects.toThrow()
  })
})

describe('a comparison REST refuses', () => {
  it('reads the commits and counts through GraphQL, and says the files are on GitHub', async () => {
    const request = async (req: RequestUrlParam) => {
      if (req.url.endsWith('/graphql')) {
        const body = JSON.parse(String(req.body)) as { variables: Record<string, string> }
        expect(body.variables).toMatchObject({ base: 'main', head: 'dev' })
        return {
          status: 200,
          headers: {},
          json: {
            data: {
              repository: {
                ref: {
                  compare: {
                    aheadBy: 1,
                    behindBy: 0,
                    status: 'AHEAD',
                    commits: {
                      totalCount: 1,
                      nodes: [
                        {
                          oid: SHA_HEAD,
                          message: 'Hi',
                          author: { name: 'Mona', date: '2026-01-01' },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          text: '',
          arrayBuffer: new ArrayBuffer(0),
        }
      }
      return {
        status: 403,
        headers: {},
        json: { message: 'Resource not accessible by personal access token' },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }
    }
    const client = new GithubClient(endpoints(''), 'tkn', request as never)
    const d = await loadCompare(
      client,
      target('https://github.com/octocat/Hello-World/compare/main...dev')
    )
    expect(d.status).toBe('ahead')
    expect(d.commits.map((c) => c.sha)).toEqual([SHA_HEAD])
    expect(d.files).toEqual([])
    expect(d.note).toMatch(/GraphQL/)
  })
})

export type { Route }
