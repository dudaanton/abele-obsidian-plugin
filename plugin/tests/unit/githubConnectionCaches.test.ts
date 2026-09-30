import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { repoTree, forgetRepoTrees } from '@/github/tree/repoTree'
import { repoIndex, indexes, cachedIndex } from '@/github/search/source'
import { loadLatestRelease } from '@/github/repoPage/repoHome'
import { createLinker } from '@/github/linking'
import type { RequestUrlResponse } from 'obsidian'

const repo = { host: 'github.com', owner: 'sample-org', repo: 'sample-repo' }
const sha = 'a'.repeat(40)
const archive = readFileSync(resolve(__dirname, '../fixtures/github/widgets.tar.gz'))
const reply = (
  status: number,
  json: unknown = {},
  bytes = new Uint8Array()
): RequestUrlResponse => ({
  status,
  headers: {},
  json,
  text: JSON.stringify(json),
  arrayBuffer: new Uint8Array(bytes).buffer,
})

beforeEach(() => {
  indexes.clear()
  forgetRepoTrees()
})

describe('connection content isolation', () => {
  it('pins the same branch independently when a tab moves to another repository', async () => {
    const c = new GithubClient(endpoints(''), 'invented-one', async (r) => ({
      ...reply(200),
      text: r.url.includes('/first/') ? 'a'.repeat(40) : 'b'.repeat(40),
    }))
    let shown = { kind: 'blob' as const, ...repo, repo: 'first', rest: ['main', 'file.ts'] }
    const linker = createLinker({
      app: {} as never,
      shown: () => shown,
      data: () => ({ ref: 'main', path: 'file.ts' }),
      title: () => '',
      client: () => c,
    })
    const first = await linker.blobLink({ start: 1, end: 1 })
    shown = { ...shown, repo: 'second' }
    const second = await linker.blobLink({ start: 1, end: 1 })
    expect(first.url).toContain('a'.repeat(40))
    expect(second.url).toContain('b'.repeat(40))
  })

  it('never returns one signed-in client tree to another at the same repository and SHA', async () => {
    const allowed = new GithubClient(endpoints(''), 'invented-one', async () =>
      reply(200, { tree: [{ path: 'private.txt', type: 'blob' }] })
    )
    const deniedRequest = vi.fn(async () => reply(404))
    const denied = new GithubClient(endpoints(''), 'invented-two', deniedRequest)
    await repoTree(allowed, repo, sha)
    await expect(repoTree(denied, repo, sha)).rejects.toMatchObject({ kind: 'not-found' })
    expect(deniedRequest).toHaveBeenCalledOnce()
  })

  it('never returns a private downloaded index to another signed-in client', async () => {
    const allowed = new GithubClient(endpoints(''), 'invented-one', async (r) =>
      r.url.includes('/tarball/')
        ? reply(200, {}, archive)
        : reply(200, { tree: [{ type: 'blob', path: 'private.txt', size: 20 }] })
    )
    const deniedRequest = vi.fn(async () => reply(404))
    const denied = new GithubClient(endpoints(''), 'invented-two', deniedRequest)
    await repoIndex(allowed, repo, sha, { limitBytes: 1000 })
    expect(cachedIndex(allowed, repo, sha)).toBeDefined()
    expect(cachedIndex(denied, repo, sha)).toBeUndefined()
    await expect(repoIndex(denied, repo, sha, { limitBytes: 1000 })).rejects.toMatchObject({
      kind: 'not-found',
    })
    expect(deniedRequest).toHaveBeenCalledOnce()
  })

  it('a retired client cannot finish a pending tree and publish private contents', async () => {
    let finish!: (response: RequestUrlResponse) => void
    const client = new GithubClient(
      endpoints(''),
      'invented-one',
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = repoTree(client, repo, sha)
    client.retire()
    finish(reply(200, { tree: [{ path: 'private.txt', type: 'blob' }] }))
    await expect(pending).rejects.toMatchObject({ kind: 'other' })
  })

  it('one account missing a release never suppresses another account release', async () => {
    const missing = new GithubClient(endpoints(''), 'invented-one', async () => reply(404))
    const visible = new GithubClient(endpoints(''), 'invented-two', async () =>
      reply(200, { tag_name: 'v1', name: 'Visible', author: {} })
    )
    expect(await loadLatestRelease(missing, repo)).toBeNull()
    expect(await loadLatestRelease(visible, repo)).toMatchObject({ name: 'Visible' })
  })
})
