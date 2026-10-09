import { describe, expect, it, vi } from 'vitest'
import { githubRepositorySource } from '@/repository/github'
import { sourceKey } from '@/repository/source'
import { loadRepositoryLocation } from '@/repository/load'
import { githubTabTarget, savedGithubTarget, savedNodeTarget } from '@/repository/state'
import { parseGithubUrl } from '@/github/urls'
import { clientWith } from '../helpers/githubTab'
import { InMemoryRepository } from '../helpers/inMemoryRepository'
import { BasePins } from '@/github/comparison/pins'

const repo = { host: 'github.com', owner: 'sample', repo: 'project' }
const SHA = 'a'.repeat(40)
describe('repository source contract', () => {
  it('keeps explicit authority identities separate even for the same repository', () => {
    const { client } = clientWith({})
    const first = githubRepositorySource(client, repo, 'first')
    const second = githubRepositorySource(client, repo, 'second')
    expect(first.identity).toEqual({
      provider: 'github',
      connection: 'first',
      server: 'https://github.com',
      repository: 'sample/project',
    })
    expect(sourceKey(first.identity)).not.toBe(sourceKey(second.identity))
    expect(first.cacheNamespace).toBe(client.cacheNamespace)
    expect(sourceKey(new InMemoryRepository().identity)).not.toBe(sourceKey(first.identity))
  })
  it('delegates explicit file reads without guessing a slash-containing branch or path', async () => {
    const { client, request } = clientWith({
      '/repos/sample/project/contents/src/app.ts': { text: 'source text' },
    })
    const source = githubRepositorySource(client, repo)
    const blob = await loadRepositoryLocation(source, {
      kind: 'file',
      ref: 'topic/work',
      path: 'src/app.ts',
    })
    expect(blob).toMatchObject({ ref: 'topic/work', path: 'src/app.ts', text: 'source text' })
    expect(request.mock.calls[0][0].url).toContain('ref=topic%2Fwork')
  })
  it('preserves GitHub navigation encoding and markdown line behavior', () => {
    const source = githubRepositorySource(clientWith({}).client, repo)
    expect(source.navigation.folder('topic/work', 'a b')).toBe(
      'https://github.com/sample/project/tree/topic/work/a%20b'
    )
    expect(source.navigation.file(SHA, 'README.md', 3)).toBe(
      `https://github.com/sample/project/blob/${SHA}/README.md?plain=1#L3`
    )
    expect(source.navigation.home('main', 'main')).toBe('https://github.com/sample/project')
  })
  it('reports unsupported working status rather than presenting a clean worktree', async () => {
    const source = githubRepositorySource(clientWith({}).client, repo)
    expect(await source.status()).toEqual({ supported: false, files: [] })
    expect(await source.workspaces()).toEqual([])
  })
  it('notifies authority retirement and rejects cached reads after revocation', async () => {
    const { client } = clientWith({})
    const source = githubRepositorySource(client, repo)
    const listener = vi.fn(),
      unsubscribe = source.subscribe(listener)
    client.retire()
    expect(listener).toHaveBeenCalledWith({ kind: 'authority' })
    expect(source.isCurrent).toBe(false)
    await expect(source.status()).rejects.toThrow('connection changed')
    expect(() => source.assertCurrent()).toThrow('connection changed')
    unsubscribe()
  })
  it('does not pin an invented full SHA merely because it looks like an object ID', async () => {
    const storage = { loadLocalStorage: () => undefined, saveLocalStorage: vi.fn() }
    const pins = new BasePins(storage)
    const source = githubRepositorySource(clientWith({}).client, repo)
    await expect(pins.resolveSource(source, repo, SHA)).rejects.toMatchObject({ kind: 'not-found' })
    expect(storage.saveLocalStorage).not.toHaveBeenCalled()
  })
  it('persists local bases under opaque workspace identity and keeps GitHub bases separate', async () => {
    const stored = new Map<string, unknown>()
    const storage = {
      loadLocalStorage: (key: string) => stored.get(key),
      saveLocalStorage: (key: string, value: unknown) => stored.set(key, value),
    }
    const pins = new BasePins(storage),
      source = new InMemoryRepository(SHA)
    pins.save(await pins.resolveSource(source, repo, 'main'))
    expect(pins.get(repo)).toBeNull()
    expect(new BasePins(storage).get(repo, source.identity)?.baseSha).toBe(SHA)
    expect(pins.get(repo, { ...source.identity, workspace: 'other-workspace' })).toBeNull()
    pins.unpin(repo, source.identity)
    expect(pins.get(repo, source.identity)).toBeNull()
  })
  it('loads local repository operations and unsubscribes without a remote capability', async () => {
    const source = new InMemoryRepository(SHA, { 'src/app.ts': 'local content' })
    expect(
      await loadRepositoryLocation(source, { kind: 'file', ref: 'main', path: 'src/app.ts' })
    ).toMatchObject({ text: 'local content' })
    expect(source.github).toBeUndefined()
    const listener = vi.fn(),
      unsubscribe = source.subscribe(listener)
    source.invalidate({ kind: 'tree', paths: ['src/app.ts'] })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    source.retire()
    expect(listener).toHaveBeenCalledTimes(1)
    await expect(source.blob('main', 'src/app.ts')).rejects.toThrow('revoked')
  })
})

describe('saved repository targets', () => {
  it('retains local observations and selected lines while whitelisting imported state', () => {
    const source = new InMemoryRepository().identity
    const target = {
      provider: 'node',
      source,
      location: {
        kind: 'file',
        ref: 'observation-1',
        path: 'src/app.ts',
        lines: { from: 3, to: 5 },
      },
      revision: {
        kind: 'working-tree',
        head: SHA,
        observation: 'observation-1',
        observedAt: '2026-10-09T10:00:00Z',
      },
    }
    expect(savedNodeTarget({ sourceTarget: { ...target, token: 'never-persist' } })).toEqual(target)
    for (const path of [
      '../outside',
      '/absolute',
      '.git/config',
      'src/../../outside',
      'src\\outside',
    ])
      expect(
        savedNodeTarget({ sourceTarget: { ...target, location: { ...target.location, path } } })
      ).toBeNull()
    expect(
      savedNodeTarget({
        sourceTarget: { ...target, source: { ...source, node: 'https://secret@example.com' } },
      })
    ).toBeNull()
  })
  it('persists source identity without serializing credentials or runtime grants', () => {
    const url = 'https://github.com/sample/project/blob/main/app.ts#L3'
    const target = githubTabTarget(url, parseGithubUrl(url, ['github.com'])!, 'connection-1')
    expect(savedGithubTarget({ sourceTarget: target })).toEqual(target)
    expect(savedGithubTarget({ url })).toBeNull()
    expect(JSON.stringify(target)).not.toContain('token')
  })
  it('rejects credential URLs, server mismatches and unknown providers', () => {
    const base = {
      provider: 'github',
      connection: '',
      repository: 'sample/project',
      server: 'https://github.com',
      url: 'https://github.com/sample/project',
    }
    expect(
      savedGithubTarget({
        sourceTarget: { ...base, url: 'https://secret@github.com/sample/project' },
      })
    ).toBeNull()
    expect(
      savedGithubTarget({ sourceTarget: { ...base, server: 'https://other.example' } })
    ).toBeNull()
    expect(savedGithubTarget({ sourceTarget: { ...base, provider: 'node' } })).toBeNull()
  })
})
