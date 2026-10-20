import { expect, it, vi } from 'vitest'
import { MemoryClientStore, NodePathClient } from '@abele/node-client'
import { NodePathMutations } from '@/node/NodePathMutations'

const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-worktree',
}
it('creates an empty file only when the destination does not already exist', async () => {
  const write = vi.fn(async () => ({ operation_id: 'sample-operation' }))
  const mutationResult = vi.fn(async (operation_id: string) => ({
    operation_id,
    state: 'saved',
    worktree_id: target.id,
    path: 'new-file.ts',
    expected_content_id: null,
  }))
  const mutations = new NodePathMutations({
    store: new MemoryClientStore(),
    nodePath: {} as never,
    repository: { write, mutationResult } as never,
  })
  await mutations.createFile(target, 'new-file.ts')
  expect(write).toHaveBeenCalledWith(
    { worktree_id: target.id, path: 'new-file.ts', text: '', expected_content_id: null },
    expect.any(String)
  )
})
it('does not accept a create receipt for another path', async () => {
  const mutations = new NodePathMutations({
    store: new MemoryClientStore(),
    nodePath: {} as never,
    repository: {
      write: vi.fn(async () => ({})),
      mutationResult: async (operation_id: string) => ({
        operation_id,
        state: 'saved',
        worktree_id: target.id,
        path: 'other.ts',
        expected_content_id: null,
      }),
    } as never,
  })
  await expect(mutations.createFile(target, 'new-file.ts')).rejects.toThrow()
})
it('moves and removes only the version shown, and creates directories through the node', async () => {
  const send = vi.fn(async (_method, _params, operation_id) => ({
    operation_id,
    state: 'applied',
    recovery_path: null,
  }))
  const mutations = new NodePathMutations({
    store: new MemoryClientStore(),
    nodePath: new NodePathClient(async () => ({}), send),
  })
  await mutations.fileMove(target, 'sample.ts', 'src/renamed.ts', 'a'.repeat(64))
  await mutations.fileRemove(target, 'sample.ts', 'a'.repeat(64))
  await mutations.fileMkdir(target, 'src/new-folder')
  expect(send.mock.calls.map(([method, params]) => [method, params])).toEqual([
    [
      'repository.v1.file.move',
      {
        worktree_id: target.id,
        from: 'sample.ts',
        to: 'src/renamed.ts',
        expected_content_id: 'a'.repeat(64),
      },
    ],
    [
      'repository.v1.file.remove',
      { worktree_id: target.id, path: 'sample.ts', expected_content_id: 'a'.repeat(64) },
    ],
    ['repository.v1.file.mkdir', { worktree_id: target.id, path: 'src/new-folder' }],
  ])
})
it('keeps the same operation id after a lost file-operation result', async () => {
  const send = vi.fn(async (_method, _params, operation_id) => ({
    operation_id,
    state: 'outcome_unknown',
    recovery_path: null,
  }))
  const client = {
    store: new MemoryClientStore(),
    nodePath: new NodePathClient(async () => ({}), send),
  }
  await expect(new NodePathMutations(client).fileMkdir(target, 'new-folder')).rejects.toThrow()
  await expect(new NodePathMutations(client).fileMkdir(target, 'new-folder')).rejects.toThrow()
  expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2])
})
