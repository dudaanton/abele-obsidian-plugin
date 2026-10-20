import { expect, it, vi } from 'vitest'
import { nodeTreeAction } from '@/node/nodeTreeActions'

const f = vi.hoisted(() => ({
  move: vi.fn(async () => {}),
  prompt: vi.fn<
    (options: { value?: string; validate?: (name: string) => string }) => Promise<string | null>
  >(async () => 'new-name.ts'),
  refresh: vi.fn(async () => {}),
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        state: { value: 'connected' },
        client: { repository: { editingStatus: async () => ({ enabled: true }) } },
      }),
    }),
  },
}))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: {
    getInstance: () => ({
      model: () => ({
        port: { file: async () => ({ contentId: 'a'.repeat(64) }) },
        reloadTarget: f.refresh,
      }),
    }),
  },
}))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    fileMove = f.move
  },
}))
vi.mock('@/components/obsidian/dialogs', () => ({
  promptDialog: f.prompt,
  confirmDialog: async () => true,
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { workspace: {} } }) },
}))
vi.mock('@/node/nodePathNavigation', () => ({ openNodePathTab: vi.fn() }))

it('renames within the current folder while Move accepts a full relative destination', async () => {
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-worktree',
  }
  await nodeTreeAction('rename', { target, path: 'src/old-name.ts' })
  expect(f.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'old-name.ts' }))
  const validate = f.prompt.mock.lastCall?.[0].validate
  expect(validate?.('nested/new-name.ts')).toBe('Enter a file name without folders.')
  expect(validate?.('new-name.ts')).toBe('')
  expect(f.move).toHaveBeenLastCalledWith(
    target,
    'src/old-name.ts',
    'src/new-name.ts',
    'a'.repeat(64)
  )
  f.prompt.mockResolvedValueOnce('other/moved.ts')
  await nodeTreeAction('move', { target, path: 'src/old-name.ts' })
  expect(f.move).toHaveBeenLastCalledWith(
    target,
    'src/old-name.ts',
    'other/moved.ts',
    'a'.repeat(64)
  )
})
