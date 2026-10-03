import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'
import { repoTree, forgetRepoTrees } from '@/github/tree/repoTree'
import { repoIndex, indexes, cachedIndex } from '@/github/search/source'
import { resetGithubClients } from '@/github/GithubService'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { loadLatestRelease } from '@/github/repoPage/repoHome'
import { createLinker } from '@/github/linking'
import { guardedGithubClient } from '@/github/guardedClient'
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
  it('does not let an old same-key build remove the newer build after reset', async () => {
    useVault([])
    const oldArchive = deferred<RequestUrlResponse>()
    const newArchive = deferred<RequestUrlResponse>()
    let downloads = 0
    const client = new GithubClient(endpoints(''), 'invented-overlap', async (r) => {
      if (!r.url.includes('/tarball/')) return reply(200, { tree: [{ type: 'blob', path: 'sample.ts', size: 20 }] })
      return ++downloads === 1 ? oldArchive.promise : newArchive.promise
    })
    const old = repoIndex(client, repo, sha, { limitBytes: 1000 })
    const oldResult = old.catch(error => error)
    await vi.waitFor(() => expect(downloads).toBe(1))
    resetGithubClients()
    const newer = repoIndex(client, repo, sha, { limitBytes: 1000 })
    await vi.waitFor(() => expect(downloads).toBe(2))
    oldArchive.resolve(reply(200, {}, archive))
    expect(await oldResult).toMatchObject({ message: 'GitHub code search was reset' })
    expect(cachedIndex(client, repo, sha)).toBeUndefined()
    const joined = repoIndex(client, repo, sha, { limitBytes: 1000 })
    newArchive.resolve(reply(200, {}, archive))
    expect(await joined).toBe(await newer)
    expect(downloads).toBe(2)
    expect(cachedIndex(client, repo, sha)).toBe(await newer)
  })

  it('cancels one index waiter without disrupting a simultaneous waiter', async () => {
    const download = deferred<RequestUrlResponse>()
    let downloads = 0
    const client = new GithubClient(endpoints(''), 'invented-waiters', async (r) => {
      if (!r.url.includes('/tarball/')) return reply(200, { tree: [{ type: 'blob', path: 'sample.ts', size: 20 }] })
      downloads++
      return download.promise
    })
    const controller = new AbortController()
    const cancelled = repoIndex(client, repo, sha, { limitBytes: 1000, signal: controller.signal }).catch(error => error)
    const kept = repoIndex(client, repo, sha, { limitBytes: 1000 })
    await vi.waitFor(() => expect(downloads).toBe(1))
    controller.abort()
    download.resolve(reply(200, {}, archive))
    expect(await cancelled).toMatchObject({ name: 'AbortError' })
    expect(await kept).toBe(cachedIndex(client, repo, sha))
    expect(downloads).toBe(1)
  })

  it('clears downloaded code when credentials are reset', async () => {
    useVault([])
    const client = new GithubClient(endpoints(''), 'invented-one', async (r) =>
      r.url.includes('/tarball/')
        ? reply(200, {}, archive)
        : reply(200, { tree: [{ type: 'blob', path: 'sample.ts', size: 20 }] })
    )
    await repoIndex(client, repo, sha, { limitBytes: 1000 })
    expect(indexes.keys()).toHaveLength(1)
    resetGithubClients()
    expect(indexes.keys()).toEqual([])
    expect(cachedIndex(client, repo, sha)).toBeUndefined()
  })

  it('does not republish an archive finishing after a credential reset', async () => {
    useVault([])
    let finish!: (response: RequestUrlResponse) => void
    const client = new GithubClient(endpoints(''), 'invented-one', async (r) =>
      r.url.includes('/tarball/')
        ? new Promise((resolve) => { finish = resolve })
        : reply(200, { tree: [{ type: 'blob', path: 'sample.ts', size: 20 }] })
    )
    const pending = repoIndex(client, repo, sha, { limitBytes: 1000 })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    resetGithubClients()
    finish(reply(200, {}, archive))
    await expect(pending).rejects.toThrow('GitHub code search was reset')
    expect(indexes.keys()).toEqual([])
  })

  it('rejects a capability revoked during unpacking without an unhandled cache-write rejection', async () => {
    let allowed=true
    const raw=new GithubClient(endpoints(''),'invented-one',async r=>r.url.includes('/tarball/') ? reply(200,{},archive) : reply(200,{tree:[{type:'blob',path:'sample.ts',size:20}]}))
    const client=guardedGithubClient(raw,()=>{if(!allowed)throw new Error('Connection access changed')})
    await expect(repoIndex(client,repo,sha,{limitBytes:1000,onStage:stage=>{if(stage==='indexing')allowed=false}})).rejects.toThrow('Connection access changed')
    expect(cachedIndex(raw,repo,sha)).toBeUndefined()
    // The runner also checks that the independent cache-settlement callback did not reject.
    await new Promise(resolve=>setTimeout(resolve,0))
  })

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
