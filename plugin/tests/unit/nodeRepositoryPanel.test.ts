/**
 * A node folder or worktree as a whole opens in the node panel, not as a repository home page:
 * the command, a place link and an agent opening a place without a file all land there.
 */
import { expect, it, vi } from 'vitest'
import { ref } from 'vue'

const f = vi.hoisted(() => ({
  reveal: vi.fn(async () => {}),
  select: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  leaf: { id: 'sidebar' },
  setViewState: vi.fn(async () => {}),
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        workspace: {
          getLeavesOfType: (type: string) => (type === 'abele-node-sidebar' ? [f.leaf] : []),
          getLeaf: () => ({ setViewState: f.setViewState }),
          revealLeaf: vi.fn(),
        },
      },
    }),
  },
}))
vi.mock('@/node/nodePathNavigation', () => ({
  NODE_SIDEBAR_VIEW: 'abele-node-sidebar',
  revealNodeDrawer: f.reveal,
}))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: {
    getInstance: () => ({
      model: () => ({ targets: ref([]), refresh: f.refresh, select: f.select }),
    }),
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        connect: async () => {},
        client: {
          store: {
            transaction: async (run: (s: object) => unknown) =>
              run({ installation_id: 'sample-installation', node_id: 'sample-node' }),
          },
        },
      }),
    }),
  },
}))
vi.mock('@/repository/node', () => ({
  WORKING_TREE: 'Working tree',
  NodeRepositorySource: class {
    async workspaces() {
      return [{ id: 'sample-worktree', workspaceId: 'sample-managed' }]
    }
    dispose() {}
  },
}))

it('opens a place without a file in the node panel, selected there', async () => {
  const { openNodeRepository } = await import('@/node/openRepository')
  const leaf = await openNodeRepository('sample-registration', 'sample-project', 'sample-managed')
  expect(f.reveal).toHaveBeenCalledWith(expect.anything(), 'sample-registration')
  expect(f.refresh).toHaveBeenCalled()
  expect(f.select).toHaveBeenCalledWith('sample-worktree')
  expect(leaf).toBe(f.leaf)
  expect(f.setViewState).not.toHaveBeenCalled()
})

it('still opens a file of the place in the repository tab', async () => {
  const { openNodeRepository } = await import('@/node/openRepository')
  await openNodeRepository('sample-registration', 'sample-project', 'sample-worktree', {
    path: 'src/sample.ts',
  }).catch(() => {})
  expect(f.setViewState).toHaveBeenCalledWith(
    expect.objectContaining({
      state: expect.objectContaining({
        sourceTarget: expect.objectContaining({
          location: expect.objectContaining({ kind: 'file', path: 'src/sample.ts' }),
        }),
      }),
    })
  )
})
