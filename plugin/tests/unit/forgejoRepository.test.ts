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
      text: typeof json === 'string' ? json : JSON.stringify(json),
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
  it('reads native people without a GraphQL lookup or forwarding credentials to an external avatar', async () => {
    const { source, http } = fixture({
      '/users/sample-user': {
        login: 'sample-user',
        name: 'Sample Person',
        avatar_url: 'https://outside.example.test/avatar.png',
      },
    })
    expect(await source.github!.person!('sample-user')).toMatchObject({
      login: 'sample-user',
      name: 'Sample Person',
      avatar: null,
    })
    expect(await source.github!.person!('sample-user')).toMatchObject({ name: 'Sample Person' })
    expect(http).toHaveBeenCalledOnce()
  })
  it('opens an explicit endpoint comparison without requiring native compare files', async () => {
    const head = 'b'.repeat(40)
    const { source } = fixture({
      [`/repos/sample/project/git/trees/${sha}?recursive=true`]: { tree: [] },
      [`/repos/sample/project/git/trees/${head}?recursive=true`]: { tree: [] },
      [`/repos/sample/project/compare/${sha}...${head}`]: { commits: [], total_commits: 0 },
    })
    expect(await source.compare(sha, head, true)).toMatchObject({
      mode: 'endpoint',
      direct: true,
      files: [],
      filesComplete: true,
      aheadBy: null,
      behindBy: null,
      headSha: head,
    })
    expect(source.navigation.comparison(sha, head, true)).toContain(`/compare/${sha}..${head}`)
  })
  it('shows an unchanged file inside a lazily expanded pinned subtree', async () => {
    const directory = 'b'.repeat(40),
      content = 'c'.repeat(40)
    const { source } = fixture({
      [`/repos/sample/project/git/trees/${sha}?recursive=true`]: { truncated: true },
      [`/repos/sample/project/git/trees/${sha}`]: {
        tree: [{ path: 'src', type: 'tree', sha: directory, mode: '040000' }],
      },
      [`/repos/sample/project/git/trees/${directory}`]: {
        tree: [{ path: 'sample.ts', type: 'blob', sha: content, size: 7, mode: '100644' }],
      },
      [`/repos/sample/project/git/blobs/${content}`]: {
        encoding: 'base64',
        content: btoa('sample\n'),
      },
    })
    const result = await source.github!.loadTarget(
      {
        kind: 'blob',
        refKind: 'commit',
        provider: 'forgejo',
        host: 'forge.example.test',
        origin: base.webBase,
        owner: 'sample',
        repo: 'project',
        rest: [sha, 'src', 'sample.ts'],
      },
      () => {},
      {
        base: {
          origin: base.webBase,
          owner: 'sample',
          repo: 'project',
          baseSha: sha,
          enteredRef: 'main',
        },
      }
    )
    expect(result).toMatchObject({
      comparison: { change: { status: 'unchanged' }, text: { additions: 0, deletions: 0 } },
    })
  })
  it('keeps submodules, unknown-size and binary comparisons explicit without following them', async () => {
    const head = 'b'.repeat(40),
      id = 'c'.repeat(40)
    const { source, http } = fixture({
      [`/repos/sample/project/git/trees/${sha}?recursive=true`]: { tree: [] },
      [`/repos/sample/project/git/trees/${head}?recursive=true`]: {
        tree: [
          { path: 'module', type: 'commit', mode: '160000', sha: id },
          { path: 'unknown.bin', type: 'blob', mode: '100644', sha: id },
          { path: 'binary.bin', type: 'blob', mode: '100644', sha: id, size: 1 },
        ],
      },
      [`/repos/sample/project/git/blobs/${id}`]: { encoding: 'base64', content: 'AA==' },
    })
    const index = await source.comparison(sha, head)
    expect(await source.comparisonFile(index, 'module')).toMatchObject({
      note: expect.stringMatching(/submodule/i),
    })
    expect(await source.comparisonFile(index, 'unknown.bin')).toMatchObject({
      note: expect.stringMatching(/size is unknown/i),
    })
    expect(http).toHaveBeenCalledTimes(2)
    expect(await source.comparisonFile(index, 'binary.bin')).toMatchObject({
      note: expect.stringMatching(/binary/i),
    })
    expect(index.counts.get('binary.bin')).toEqual({ state: 'unavailable' })
  })
  it('rejects comparison indexes from another reader and honours cancellation before transport', async () => {
    const { source } = fixture({
      [`/repos/sample/project/git/trees/${sha}?recursive=true`]: { tree: [] },
    })
    const index = await source.comparison(sha, sha)
    const other = fixture({})
    await expect(other.source.comparisonFile(index, 'sample.ts')).rejects.toThrow(
      /another repository reader/
    )
    const controller = new AbortController()
    controller.abort()
    await expect(other.source.comparison(sha, sha, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(other.http).not.toHaveBeenCalled()
  })
  it('compares endpoint trees and immutable blobs, including deleted files and exact renames', async () => {
    const head = 'b'.repeat(40),
      before = 'c'.repeat(40),
      after = 'd'.repeat(40)
    const { source, http } = fixture({
      [`/repos/sample/project/git/trees/${sha}?recursive=true`]: {
        tree: [
          { path: 'old.ts', type: 'blob', mode: '100644', sha: before, size: 7 },
          { path: 'gone.ts', type: 'blob', mode: '100644', sha: after, size: 6 },
        ],
      },
      [`/repos/sample/project/git/trees/${head}?recursive=true`]: {
        tree: [{ path: 'new.ts', type: 'blob', mode: '100644', sha: before, size: 7 }],
      },
      [`/repos/sample/project/git/blobs/${after}`]: {
        encoding: 'base64',
        content: btoa('after\n'),
      },
    })
    const index = await source.comparison(sha, head)
    expect(index.changes).toMatchObject([
      { path: 'gone.ts', status: 'removed' },
      { path: 'new.ts', status: 'renamed', previousPath: 'old.ts' },
    ])
    expect(await source.comparisonFile(index, 'gone.ts')).toMatchObject({
      text: { additions: 0, deletions: 1 },
      before: { text: 'after\n' },
      after: { text: '' },
    })
    expect(index.counts.get('gone.ts')).toEqual({ state: 'ready', additions: 0, deletions: 1 })
    expect(http.mock.calls.some(([request]) => request.url.includes('/compare/'))).toBe(false)
  })
  it('reads commit patches and immutable path history through native routes', async () => {
    const raw = {
      sha,
      commit: {
        message: 'Sample commit',
        author: { name: 'Sample', date: '2026-01-01T00:00:00Z' },
      },
      parents: [{ sha: 'b'.repeat(40) }],
      files: [{ filename: 'old.ts', status: 'removed', additions: 0, deletions: 1 }],
    }
    const { source } = fixture({
      [`/repos/sample/project/git/commits/${sha}`]: raw,
      [`/repos/sample/project/git/commits/${sha}.diff`]:
        'diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-before\n',
      '/repos/sample/project/commits/feature%2Fone': { sha },
      [`/repos/sample/project/commits?sha=${sha}&path=src%2Fsample.ts&limit=100&page=1`]: [raw],
    })
    const commit = await source.commit(sha)
    expect(commit).toMatchObject({
      sha,
      parentSha: 'b'.repeat(40),
      message: 'Sample commit',
      files: [{ path: 'old.ts', hash: '' }],
    })
    await commit.files[0].loadPatch!()
    expect(commit.files[0].patch).toContain('-before')
    expect(await source.commits('feature/one', 'src/sample.ts')).toMatchObject([
      { sha, message: 'Sample commit' },
    ])
  })
  it('loads commit targets through the same repository reader', async () => {
    const { source } = fixture({
      [`/repos/sample/project/git/commits/${sha}`]: {
        sha,
        commit: { message: 'Sample root', author: { name: 'Sample', date: '' } },
        parents: [],
        files: [],
      },
    })
    expect(
      await source.github!.loadTarget(
        {
          kind: 'commit',
          host: 'forge.example.test',
          origin: base.webBase,
          owner: 'sample',
          repo: 'project',
          sha,
        },
        () => {}
      )
    ).toMatchObject({ sha, message: 'Sample root', files: [] })
  })
  it('keeps an immutable SHA distinct from a branch with the same spelling', async () => {
    const { source } = fixture({
      '/repos/sample/project/branches?limit=50&page=1': [{ name: sha }],
      '/repos/sample/project/tags?limit=50&page=1': [],
    })
    await source.refs()
    expect(await source.resolve(sha)).toBe(sha)
    expect(source.navigation.file(sha, 'src/sample.ts')).toContain(`/src/commit/${sha}/`)
  })
  it('shows an empty repository without requesting nonexistent contents', async () => {
    const { source, http } = fixture({
      '/repos/sample/project': {
        name: 'project',
        owner: { login: 'sample' },
        default_branch: 'main',
        empty: true,
      },
    })
    expect(await source.home()).toMatchObject({ empty: true, entries: [] })
    expect(http).toHaveBeenCalledTimes(1)
  })
  it('lists native open issues and pull requests without GitHub search syntax', async () => {
    const { source } = fixture({
      '/repos/sample/project/issues?state=open&type=issues&sort=recentupdate&limit=5&page=1': [
        { number: 12, title: 'Sample issue', user: null },
      ],
      '/repos/sample/project/pulls?state=open&sort=recentupdate&limit=5&page=1': [
        { number: 13, title: 'Sample change', user: null },
      ],
    })
    expect(await source.github!.issues()).toMatchObject([
      { number: 12, url: 'https://forge.example.test/team/sample/project/issues/12' },
    ])
    expect(await source.github!.pulls()).toMatchObject([
      { number: 13, url: 'https://forge.example.test/team/sample/project/pulls/13' },
    ])
  })
  it('loads native patches and inline review comments with partial failures retained', async () => {
    const { source } = fixture({
      '/repos/sample/project/pulls/12/files?limit=50&page=1': [
        { filename: 'src/sample.ts', status: 'modified', additions: 1, deletions: 1 },
      ],
      '/repos/sample/project/pulls/12.diff':
        'diff --git a/src/sample.ts b/src/sample.ts\n--- a/src/sample.ts\n+++ b/src/sample.ts\n@@ -1 +1 @@\n-before\n+after\n',
      '/repos/sample/project/pulls/12/reviews?limit=50&page=1': [{ id: 7 }],
      '/repos/sample/project/pulls/12/reviews/7/comments?limit=50&page=1': [
        { id: 8, path: 'src/sample.ts', body: 'Sample review', created_at: '2026-01-01T00:00:00Z' },
      ],
    })
    const data = await source.github!.pullFiles!(12)
    await data.files[0].loadPatch!()
    expect(data.files[0]).toMatchObject({
      patch: '@@ -1 +1 @@\n-before\n+after\n',
      reviewComments: [{ body: 'Sample review', location: 'src/sample.ts' }],
    })
  })
  it('loads a PR body without inventing aggregate counts', async () => {
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
      '/repos/sample/project/commits/feature%2Fone': { sha },
      [`/repos/sample/project/contents/src/sample.ts?ref=${sha}`]: {
        type: 'file',
        encoding: 'base64',
        content: 'Ly8gz4AK',
        sha,
      },
    })
    expect(await source.blob('feature/one', 'src/sample.ts')).toMatchObject({
      resolvedCommit: sha,
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
