import { describe, expect, it, vi } from 'vitest'
import { MemoryClientStore, NodePathClient, NodeClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import { NodePathMutations } from '@/node/NodePathMutations'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import { WorktreePageSchema } from '@abele/node-protocol'

describe('owner folder intents', () => {
  it('starts a new managed removal when the accepted job ended busy', async () => {
    const store = new MemoryClientStore()
    await store.transaction((state) => {
      state.results['sample-removal'] = {
        request: { method: 'workspace.remove', params: { workspace_id: 'sample-workspace' } },
        result: { workspace_id: 'sample-workspace', job_id: 'sample-busy-job' },
      }
    })
    const removeWorkspace = vi.fn(async () => ({
      workspace_id: 'sample-workspace',
      job_id: 'sample-new-job',
    }))
    const mutations = new NodePathMutations({
      store,
      nodePath: {} as never,
      removeWorkspace,
      getJob: vi.fn(async () => ({ state: 'failed', error: 'resource_busy' })) as never,
      operationResult: (id) => store.transaction((state) => state.results[id]),
    })
    expect(await mutations.removeManaged('sample-workspace')).toMatchObject({
      job_id: 'sample-new-job',
    })
    expect(removeWorkspace).toHaveBeenCalledExactlyOnceWith('sample-workspace')
  })
  it('uses a new explicit deletion intent after a known busy refusal', async () => {
    const target = {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'worktree' as const,
      id: 'sample-tree',
    }
    const send = vi
      .fn()
      .mockRejectedValueOnce(new ChannelError('resource_busy'))
      .mockResolvedValueOnce({ worktree_id: target.id, state: 'deleted' })
    const client = {
      store: new MemoryClientStore(),
      nodePath: new NodePathClient(async () => ({}), send),
    }
    const row = { head: 'a'.repeat(40) } as never
    await expect(
      new NodePathMutations(client).delete(target, row, 'first-observation')
    ).rejects.toThrow('resource_busy')
    await new NodePathMutations(client).delete(target, row, 'second-observation')
    expect(send.mock.calls[1][2]).not.toBe(send.mock.calls[0][2])
    expect(send.mock.calls[1][1].expected_observation_id).toBe('second-observation')
  })
  it('allows a fresh removal after a completed busy refusal without replaying the refused operation', async () => {
    const store = new MemoryClientStore()
    await store.transaction((state) => {
      state.results['refused-removal'] = {
        error: 'resource_busy',
        request: {
          method: 'workspace.remove',
          params: { workspace_id: 'workspace-sample' },
        },
      }
    })
    const removeWorkspace = vi.fn(async () => ({
      workspace_id: 'workspace-sample',
      job_id: 'fresh-job',
    }))
    const mutations = new NodePathMutations({ store, nodePath: {} as never, removeWorkspace })
    expect(await mutations.removeManaged('workspace-sample')).toEqual({
      workspace_id: 'workspace-sample',
      job_id: 'fresh-job',
    })
    expect(removeWorkspace).toHaveBeenCalledOnce()
  })
  it.each([false, true])(
    'starts a fresh explicit Open after a terminal receipt, persisted=%s',
    async (persisted) => {
      const factory = new IDBFactory()
      let store = new NodeClientStore('sample-register', factory)
      const params = { path: '/sample/reopened', trust: 'untrusted', exact_root: true }
      const key = JSON.stringify(['project.register', params])
      await store.transaction((state) => {
        state.node_id = 'sample-node'
        if (persisted) {
          state.nodePathIntents = {
            [key]: { id: 'old-register', method: 'project.register', params },
          }
          state.results['old-register'] = {
            error: 'stale_revision',
            request: { method: 'project.register', params },
          }
        }
      })
      if (persisted) {
        store.close()
        store = new NodeClientStore('sample-register', factory)
      }
      const client = new NodeClient(
        { profile: 'local-token-v1', url: 'ws://127.0.0.1:1/channel', token: 'sample-token' },
        store
      )
      vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
      const sent: string[] = []
      const project = {
        project_id: 'project-sample',
        root_path: params.path,
        repository_path: null,
        git_common_dir: null,
        trust: 'untrusted',
        use_repository_claude_permissions: false,
        created_at: '2025-01-01T00:00:00Z',
      }
      vi.spyOn(client, 'flush').mockImplementation(async () => {
        await store.transaction((state) => {
          const entry = state.outbox[0]
          if (!entry) return
          sent.push(entry.operation_id)
          state.results[entry.operation_id] = {
            ...(!persisted && sent.length === 1
              ? { error: 'stale_revision' }
              : { result: project }),
            request: { method: entry.method, params: entry.params },
          }
          state.outbox = []
        })
      })
      if (!persisted) {
        await expect(new NodePathMutations(client).register(params.path)).rejects.toThrow(
          'stale_revision'
        )
        expect(sent).toHaveLength(1)
      }
      await expect(new NodePathMutations(client).register(params.path)).resolves.toEqual(project)
      expect(sent).toHaveLength(persisted ? 1 : 2)
      expect(new Set(sent).size).toBe(sent.length)
      expect(await client.operationResult(persisted ? 'old-register' : sent[0])).toMatchObject({
        error: 'stale_revision',
      })
      store.close()
    }
  )
  it.each(['disconnected', 'outcome_unknown', 'storage_unavailable', 'reply lost'])(
    'retains registration ID and params across reopen after %s',
    async (code) => {
      const factory = new IDBFactory()
      const store = new NodeClientStore('sample-unknown-register', factory)
      const mutations = vi
        .fn()
        .mockRejectedValueOnce(code === 'reply lost' ? new Error(code) : new ChannelError(code))
        .mockResolvedValueOnce({
          project_id: 'project-sample',
          root_path: '/sample/reopened',
          repository_path: null,
          git_common_dir: null,
          trust: 'untrusted',
          use_repository_claude_permissions: false,
          created_at: '2025-01-01T00:00:00Z',
        })
      const nodePath = new NodePathClient(async () => {}, mutations)
      await expect(
        new NodePathMutations({ store, nodePath }).register('/sample/reopened')
      ).rejects.toThrow(code)
      store.close()
      const reopened = new NodeClientStore('sample-unknown-register', factory)
      await new NodePathMutations({ store: reopened, nodePath }).register('/sample/reopened')
      expect(mutations.mock.calls[1]).toEqual(mutations.mock.calls[0])
      reopened.close()
    }
  )
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
  it('checks the same uncertain deletion after a fresh observation rather than submitting a new effect', async () => {
    const target = {
      nodeId: 'node-demo',
      registrationId: 'registration-demo',
      projectId: 'project-demo',
      kind: 'worktree' as const,
      id: 'tree-demo',
    }
    const row = WorktreePageSchema.parse({
      entries: [
        {
          worktree_id: target.id,
          project_id: target.projectId,
          workspace_id: null,
          kind: 'external',
          path_label: '/sample/topic',
          branch: 'topic',
          detached: false,
          head: 'a'.repeat(40),
          availability: 'available',
          locked: false,
          prunable: false,
          dirty: false,
        },
      ],
      cursor: null,
      incomplete: false,
      omissions: [],
    }).entries[0]
    const mutations = vi
      .fn()
      .mockResolvedValueOnce({ worktree_id: target.id, state: 'outcome_unknown' })
      .mockResolvedValueOnce({ worktree_id: target.id, state: 'deleted' })
    const client = {
      store: new MemoryClientStore(),
      nodePath: new NodePathClient(async () => {}, mutations),
    }
    const model = new NodePathMutations(client)
    await expect(model.delete(target, row, 'first-observation')).rejects.toThrow('unknown')
    await model.delete(target, row, 'fresh-observation')
    expect(mutations.mock.calls[1][1]).toEqual(mutations.mock.calls[0][1])
    expect(mutations.mock.calls[1][2]).toBe(mutations.mock.calls[0][2])
  })
  it('recovers a managed deletion receipt after reconnect instead of creating another removal', async () => {
    const store = new NodeClientStore('sample-managed-delete', new IDBFactory())
    const operation = 'operation-delete'
    await store.transaction((state) => {
      state.outbox.push({
        operation_id: operation,
        method: 'workspace.remove',
        params: { workspace_id: 'workspace-demo' },
      })
    })
    await store.transaction((state) => {
      state.results[operation] = { result: { workspace_id: 'workspace-demo', job_id: 'job-demo' } }
      state.outbox = []
    })
    const removeWorkspace = vi.fn()
    const model = new NodePathMutations({
      store,
      nodePath: new NodePathClient(
        async () => {},
        async () => {}
      ),
      removeWorkspace,
      flush: vi.fn(),
      operationResult: (id) => store.transaction((state) => state.results[id]),
    })
    expect(await model.removeManaged('workspace-demo')).toEqual({
      workspace_id: 'workspace-demo',
      job_id: 'job-demo',
    })
    expect(removeWorkspace).not.toHaveBeenCalled()
    store.close()
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
