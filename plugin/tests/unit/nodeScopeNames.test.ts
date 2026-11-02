/**
 * What a place on a node is called on screen: looked up from the node, never kept as ids for
 * good because the node was not connected yet or the worktree came later.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const node = vi.hoisted(() => ({
  connected: false,
  paged: false,
  worktrees: [] as { worktree_id: string; branch: string; path_label: string }[],
}))
vi.mock('@/ai/tools/node/owner', () => ({
  nodeAgentHost: async () => ({
    nodes: () => [
      { id: 'sample-old-registration', node_id: 'sample-node', label: 'Sample node' },
      { id: 'sample-registration', node_id: 'sample-node', label: 'Sample node' },
    ],
    connection: (id: string) => {
      // Asked by the node's own id with two registrations, the host has no single answer.
      if (id === 'sample-node') throw new Error('Choose the node installation explicitly')
      if (id === 'sample-old-registration') return { client: { connected: false } }
      return sampleConnection()
    },
  }),
}))
const sampleConnection = () => ({
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
    repository: {
      worktrees: async ({ cursor }: { cursor?: string }) =>
        node.paged && !cursor
          ? { entries: [], cursor: 'sample-next' }
          : { entries: node.worktrees },
    },
  },
})
import {
  forgetNodeScopeNames,
  nodeScopeNames,
  nodeScopeSentence,
  nodeScopeDisplayNames,
} from '@/ai/tools/node/scopeNames'

const place = {
  node_id: 'sample-node',
  project_id: 'sample-project',
  target: { kind: 'worktree' as const, worktree_id: 'sample-tree' },
}
beforeEach(() => {
  forgetNodeScopeNames()
  node.connected = false
  node.paged = false
  node.worktrees = []
})

describe('the names of a place on a node', () => {
  it('uses persisted words when no catalogue has ever named this place', async () => {
    const saved = {
      kind: 'target' as const,
      ...place,
      project_id: 'persisted-only-project',
      display: { folder: 'remembered-app', branch: 'remembered-branch' },
      access: 'read' as const,
    }
    expect(await nodeScopeDisplayNames(saved)).toMatchObject({
      folder: 'remembered-app',
      branch: 'remembered-branch',
      missing: true,
    })
    expect(saved.display).toEqual({ folder: 'remembered-app', branch: 'remembered-branch' })
  })
  it('prefers fresh words and retains the latest branch when the place disappears', async () => {
    const saved = {
      kind: 'target' as const,
      ...place,
      target: { kind: 'worktree' as const, worktree_id: 'retained-tree' },
      display: { folder: 'old-app', branch: 'old-branch' },
      access: 'read' as const,
    }
    node.connected = true
    node.worktrees = [
      { worktree_id: 'retained-tree', branch: 'refs/heads/current', path_label: '/x' },
    ]
    expect(await nodeScopeDisplayNames(saved)).toMatchObject({
      folder: 'sample-app',
      branch: 'current',
    })
    node.connected = false
    forgetNodeScopeNames()
    expect(await nodeScopeDisplayNames(saved)).toMatchObject({
      folder: 'sample-app',
      branch: 'current',
      missing: true,
    })
  })
  it('says an unavailable folder in words while keeping the original grant', async () => {
    const display = await nodeScopeDisplayNames(place)
    const sentence = nodeScopeSentence(display, 'read')
    expect(sentence).toContain('Unknown folder')
    expect(display.missing).toBe(true)
    expect(sentence).not.toContain('sample-project')
    expect(sentence).not.toContain('sample-tree')
    expect(place.target.worktree_id).toBe('sample-tree')
  })
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

  it('refreshes the branch words without changing the granted worktree identity', async () => {
    node.connected = true
    node.worktrees = [{ worktree_id: 'sample-tree', branch: 'refs/heads/main', path_label: '/x' }]
    expect((await nodeScopeNames(place)).branch).toBe('main')
    node.worktrees = [{ worktree_id: 'sample-tree', branch: 'refs/heads/topic', path_label: '/x' }]
    expect((await nodeScopeNames(place)).branch).toBe('topic')
    expect(place.target.worktree_id).toBe('sample-tree')
  })

  it('finds the connected one when the node is registered here twice', async () => {
    node.connected = true
    node.worktrees = [{ worktree_id: 'sample-tree', branch: 'refs/heads/main', path_label: '/x' }]
    expect((await nodeScopeNames(place)).folder).toBe('sample-app')
  })

  it('names a worktree added after the folder’s names were looked up', async () => {
    node.connected = true
    node.worktrees = [{ worktree_id: 'other-tree', branch: 'refs/heads/other', path_label: '/y' }]
    await nodeScopeNames({ ...place, target: { kind: 'worktree', worktree_id: 'other-tree' } })
    node.worktrees.push({ worktree_id: 'sample-tree', branch: 'refs/heads/main', path_label: '/x' })
    expect((await nodeScopeNames(place)).branch).toBe('main')
  })
})

it('resolves branch labels beyond the first catalogue page', async () => {
  node.connected = true
  node.paged = true
  node.worktrees = [{ worktree_id: 'sample-tree', branch: 'refs/heads/topic', path_label: '/x' }]
  expect((await nodeScopeNames(place)).branch).toBe('topic')
})
