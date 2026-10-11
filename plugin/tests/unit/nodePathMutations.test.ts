import { describe, expect, it, vi } from 'vitest'
import { MemoryClientStore, NodePathClient } from '@abele/node-client'
import { NodePathMutations } from '@/node/NodePathMutations'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'

describe('owner folder intents', () => {
  it('survives reopening the strict device-local client store after an unknown folder operation', async () => {
    const factory = new IDBFactory()
    const store = new NodeClientStore('sample-folder-intent', factory)
    const mutations = vi
      .fn()
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({ path: '/sample/created' })
    const nodePath = new NodePathClient(async () => {}, mutations)
    await expect(
      new NodePathMutations({ store, nodePath }).mkdir('directory-demo', 'created')
    ).rejects.toThrow('reply lost')
    store.close()
    const reopened = new NodeClientStore('sample-folder-intent', factory)
    await expect(
      new NodePathMutations({ store: reopened, nodePath }).mkdir('directory-demo', 'created')
    ).resolves.toBe('/sample/created')
    expect(mutations.mock.calls[0][2]).toBe(mutations.mock.calls[1][2])
    reopened.close()
  })
  it('retains the same operation after an unknown mkdir reply and registers the real path separately', async () => {
    const mutations = vi
      .fn()
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({ path: '/sample/created' })
      .mockResolvedValueOnce({
        project_id: 'project-created',
        root_path: '/sample/created',
        repository_path: null,
        git_common_dir: null,
        trust: 'untrusted',
        use_repository_claude_permissions: false,
        created_at: '2025-01-01T00:00:00Z',
      })
    const client = {
      store: new MemoryClientStore(),
      nodePath: new NodePathClient(async () => {
        throw new Error('unused read')
      }, mutations),
    }
    const first = new NodePathMutations(client)
    await expect(first.mkdir('directory-demo', 'created')).rejects.toThrow('reply lost')
    const reopened = new NodePathMutations(client)
    expect(await reopened.mkdir('directory-demo', 'created')).toBe('/sample/created')
    expect(mutations.mock.calls[0][2]).toBe(mutations.mock.calls[1][2])
    await reopened.register('/sample/created')
    expect(mutations.mock.calls[2][0]).toBe('project.register')
    expect(mutations.mock.calls[2][1]).toEqual({
      path: '/sample/created',
      trust: 'untrusted',
      exact_root: true,
    })
    expect(mutations.mock.calls[2][2]).not.toBe(mutations.mock.calls[1][2])
  })
  it('keeps the original mkdir request and operation when a reopened picker has a fresh parent handle', async () => {
    const mutations = vi
      .fn()
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({ path: '/sample/created' })
    const client = {
      store: new MemoryClientStore(),
      nodePath: new NodePathClient(async () => {}, mutations),
    }
    await expect(
      new NodePathMutations(client).mkdir('old-handle', 'created', '/sample')
    ).rejects.toThrow('reply lost')
    await new NodePathMutations(client).mkdir('new-handle', 'created', '/sample')
    expect(mutations.mock.calls[1][1]).toEqual(mutations.mock.calls[0][1])
    expect(mutations.mock.calls[1][2]).toBe(mutations.mock.calls[0][2])
  })
  it('never deletes a created directory when registration fails', async () => {
    const mutations = vi
      .fn()
      .mockResolvedValueOnce({ path: '/sample/created' })
      .mockRejectedValueOnce(new Error('registration failed'))
    const client = {
      store: new MemoryClientStore(),
      nodePath: new NodePathClient(async () => {}, mutations),
    }
    const model = new NodePathMutations(client)
    const path = await model.mkdir('directory-demo', 'created')
    await expect(model.register(path)).rejects.toThrow('registration failed')
    expect(mutations.mock.calls.map((c) => c[0])).toEqual([
      'filesystem.v1.mkdir',
      'project.register',
    ])
  })
})
