import { expect, it, vi } from 'vitest'
import { nodeTreeAction } from '@/node/nodeTreeActions'

const f = vi.hoisted(() => ({
  move: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  directory: vi.fn(async () => ({
    content_id: 'b'.repeat(64),
    entries: [{ path: 'child.ts', kind: 'file', content_id: 'a'.repeat(64) }],
  })),
  confirm: vi.fn(async () => true),
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
        client: {
          channel: { channel: { welcome: { methods: ['repository.v1.file.directory'] } } },
          nodePath: { fileDirectory: f.directory },
          repository: { editingStatus: async () => ({ enabled: true }) },
        },
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
    fileRemove = f.remove
  },
}))
vi.mock('@/components/obsidian/dialogs', () => ({
  promptDialog: f.prompt,
  confirmDialog: f.confirm,
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
  expect(f.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ submitText: 'Rename' }))
  const validate = f.prompt.mock.lastCall?.[0].validate
  expect(() => validate?.('nested/new-name.ts')).toThrow('Enter a file name without folders.')
  expect(() => validate?.('')).toThrow('Enter a file name without folders.')
  expect(validate?.('new-name.ts')).toBe('new-name.ts')
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

it('previews the complete directory manifest before move or delete, and cancellation writes nothing', async () => {
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-worktree',
  }
  f.move.mockClear()
  f.confirm.mockResolvedValueOnce(false)
  await nodeTreeAction('rename', { target, path: 'src/old-folder', directory: true })
  expect(f.directory).toHaveBeenCalledWith({ worktree_id: target.id, path: 'src/old-folder' })
  expect(f.confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: expect.stringContaining('child.ts'), size: 'tall' })
  )
  expect(f.move).not.toHaveBeenCalled()
  await nodeTreeAction('delete', { target, path: 'src/old-folder', directory: true })
  expect(f.remove).toHaveBeenLastCalledWith(target, 'src/old-folder', 'b'.repeat(64), true)
  await nodeTreeAction('move', { target, path: 'src/old-folder', directory: true })
  expect(f.move).toHaveBeenLastCalledWith(
    target,
    'src/old-folder',
    'new-name.ts',
    'b'.repeat(64),
    true
  )
})
