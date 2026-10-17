import { describe, expect, it, vi } from 'vitest'
import { forgejoRepository } from '@/forge/forgejoRepository'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'
import type { HttpTransport } from '@/forge/transport'

const base = deployment('forgejo', 'https://forge.example.test/team')
const sha = 'a'.repeat(40)
function fixture(data: Record<string, unknown>) {
  const http = vi.fn<HttpTransport>(async (request) => {
    const path = request.url.slice(base.apiBase.length)
    if (!(path in data)) throw new Error(`Unexpected fake request: ${path}`)
    const json = data[path]
    return {
      status: 200,
      headers: {},
      text: JSON.stringify(json),
      json,
      arrayBuffer: new ArrayBuffer(0),
    }
  })
  const source = forgejoRepository(
    new ForgejoClient(
      base,
      {
        connectionId: 'sample',
        generation: 'one',
        assertCurrent() {},
      },
      http,
      'sample-token'
    ),
    'sample/project'
  )
  return { source, http }
}
describe('Forgejo repository adapter', () => {
  // BUG: The shared PR presentation cannot yet represent unknown aggregate counts.
  it.fails('loads a PR body without inventing aggregate counts', async () => {
    const { source } = fixture({
      '/repos/sample/project/pulls/12': {
        number: 12,
        title: 'Sample change',
        body: 'Details',
        state: 'open',
        user: null,
        labels: [],
      },
      '/repos/sample/project/issues/12/comments?limit=50&page=1': [],
    })
    expect(
      await source.github!.loadTarget(
        {
          kind: 'pull',
          host: 'forge.example.test',
          origin: base.webBase,
          owner: 'sample',
          repo: 'project',
          number: 12,
          tab: 'conversation',
        },
        () => {}
      )
    ).toMatchObject({
      title: 'Sample change',
      additions: null,
      deletions: null,
      changedFiles: null,
      commitsCount: null,
    })
  })
  it('reads native PR files and commits without inventing patches or diff hashes', async () => {
    const { source } = fixture({
      '/repos/sample/project/pulls/12/files?limit=50&page=1': [
        { filename: 'src/sample.ts', status: 'modified', additions: 2, deletions: 1 },
      ],
      '/repos/sample/project/pulls/12/commits?limit=50&page=1': [
        {
          sha,
          commit: {
            message: 'Sample change',
            author: { name: 'Sample', date: '2026-01-01T00:00:00Z' },
          },
        },
      ],
    })
    expect(await source.github!.pullFiles!(12)).toMatchObject({
      complete: true,
      files: [{ path: 'src/sample.ts', patch: undefined, hash: '', diffNote: expect.any(String) }],
    })
    expect(await source.github!.pullCommits!(12)).toMatchObject({
      complete: true,
      commits: [{ sha, message: 'Sample change' }],
    })
  })
  it('reads private metadata and native paged branches and tags', async () => {
    const { source } = fixture({
      '/repos/sample/project': {
        name: 'project',
        owner: { login: 'sample' },
        private: true,
        default_branch: 'main',
        stars_count: 4,
        watchers_count: 2,
      },
      '/repos/sample/project/branches?limit=50&page=1': [{ name: 'feature/one' }],
      '/repos/sample/project/tags?limit=50&page=1': [{ name: 'v1' }],
    })
    expect(await source.metadata()).toMatchObject({ visibility: 'private', stars: 4, watchers: 2 })
    expect(await source.refs()).toEqual({ branches: ['feature/one'], tags: ['v1'], more: false })
  })
  it('reads UTF-8 contents with the selected ref and native immutable navigation', async () => {
    const { source } = fixture({
      '/repos/sample/project/contents/src/sample.ts?ref=feature%2Fone': {
        type: 'file',
        encoding: 'base64',
        content: 'Ly8gz4AK',
        sha,
      },
    })
    expect(await source.blob('feature/one', 'src/sample.ts')).toMatchObject({
      text: '// π\n',
      ref: 'feature/one',
    })
    expect(source.navigation.file(sha, 'src/sample.ts', 2)).toBe(
      `${base.webBase}/sample/project/src/commit/${sha}/src/sample.ts#L2`
    )
  })
  it('retains native tree truncation and expands by tree SHA', async () => {
    const { source } = fixture({
      [`/repos/sample/project/git/trees/${sha}?recursive=true`]: {
        sha,
        truncated: true,
        tree: [{ path: 'src', type: 'tree', sha: 'b'.repeat(40) }],
      },
      [`/repos/sample/project/git/trees/${sha}`]: {
        tree: [{ path: 'src', type: 'tree', sha: 'b'.repeat(40) }],
      },
      [`/repos/sample/project/git/trees/${'b'.repeat(40)}`]: {
        tree: [{ path: 'sample.ts', type: 'blob', sha }],
      },
    })
    const tree = await source.tree(sha)
    expect(tree.truncated).toBe(true)
    await tree.expand(tree.root.children![0])
    expect(tree.root.children![0].children![0].path).toBe('src/sample.ts')
  })
  it('preserves readable issue content when comments fail', async () => {
    const { source } = fixture({
      '/repos/sample/project/issues/12': {
        number: 12,
        title: 'Sample issue',
        body: 'Details',
        state: 'open',
        user: null,
        labels: [],
      },
    })
    const item = await source.github!.loadTarget(
      {
        kind: 'issue',
        host: 'forge.example.test',
        origin: base.webBase,
        owner: 'sample',
        repo: 'project',
        number: 12,
      },
      () => {}
    )
    expect(item).toMatchObject({
      title: 'Sample issue',
      body: 'Details',
      commentsComplete: false,
      commentsProblem: expect.any(String),
    })
  })
  it('rejects unavailable operations rather than returning empty success', async () => {
    const { source, http } = fixture({})
    await expect(source.blame('main', 'src/sample.ts')).rejects.toThrow(
      /not available for this service/i
    )
    expect(http).not.toHaveBeenCalled()
  })
})
