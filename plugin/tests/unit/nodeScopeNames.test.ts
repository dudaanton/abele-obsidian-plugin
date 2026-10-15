/**
 * What a place on a node is called on screen: looked up from the node, never kept as ids for
 * good because the node was not connected yet or the worktree came later.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const node = vi.hoisted(() => ({
  connected: false,
  worktrees: [] as { worktree_id: string; branch: string; path_label: string }[],
}))
vi.mock('@/ai/tools/node/owner', () => ({
  nodeAgentHost: async () => ({
    nodes: () => [{ id: 'sample-registration', node_id: 'sample-node', label: 'Sample node' }],
    connection: () => ({
      client: {
        get connected() {
          return node.connected
        },
        listProjects: async () => [
          {
            project_id: 'sample-project',
            root_path: '/work/sample-app',
            repository_path: '/work/sample-app',
          },
        ],
        repository: { worktrees: async () => ({ entries: node.worktrees }) },
      },
    }),
  }),
}))
import { forgetNodeScopeNames, nodeScopeNames } from '@/ai/tools/node/scopeNames'

const place = {
  node_id: 'sample-node',
  project_id: 'sample-project',
  target: { kind: 'worktree' as const, worktree_id: 'sample-tree' },
}
beforeEach(() => {
  forgetNodeScopeNames()
  node.connected = false
  node.worktrees = []
})

describe('the names of a place on a node', () => {
  it('learns them once the node connects, not keeping the ids from before', async () => {
    expect(await nodeScopeNames(place)).toEqual({
      node: 'Sample node',
      folder: 'sample-project',
      branch: 'sample-tree',
    })
    node.connected = true
    node.worktrees = [{ worktree_id: 'sample-tree', branch: 'refs/heads/main', path_label: '/x' }]
    expect(await nodeScopeNames(place)).toEqual({
      node: 'Sample node',
      folder: 'sample-app',
      branch: 'main',
    })
  })

  it('names a worktree added after the folder’s names were looked up', async () => {
    node.connected = true
    node.worktrees = [{ worktree_id: 'other-tree', branch: 'refs/heads/other', path_label: '/y' }]
    await nodeScopeNames({ ...place, target: { kind: 'worktree', worktree_id: 'other-tree' } })
    node.worktrees.push({ worktree_id: 'sample-tree', branch: 'refs/heads/main', path_label: '/x' })
    expect((await nodeScopeNames(place)).branch).toBe('main')
  })
})
