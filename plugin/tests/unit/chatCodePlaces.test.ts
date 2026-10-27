import { expect, it, vi } from 'vitest'
import { chatCodePlaces } from '@/node/chatCodePlaces'
import { NodeService } from '@/node/NodeService'
const { model } = vi.hoisted(() => ({
  model: {
    targets: {
      value: [
        { nodeId: 'node', projectId: 'project', kind: 'worktree', id: 'tree' },
        { nodeId: 'node', projectId: 'project', kind: 'workspace', id: 'folder' },
      ],
    },
    folders: { value: [{ id: 'project', path: '/sample/root' }] },
    copy: () => undefined,
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({ nodes: { value: [{ id: 'registration', expectedNodeId: 'node' }] } }),
  },
}))
vi.mock('@/node/NodePathService', () => ({
  NodePathService: { getInstance: () => ({ model: () => model }) },
}))

it('does not initialize node services for a chat without node access', () => {
  const initialize = vi.spyOn(NodeService, 'getInstance')
  try {
    expect(chatCodePlaces([])).toEqual([])
    expect(initialize).not.toHaveBeenCalled()
  } finally {
    initialize.mockRestore()
  }
})

it('uses the chat selection, excludes inaccessible places and never borrows a missing worktree root', () => {
  const target = {
    node_id: 'node',
    project_id: 'project',
    target: { kind: 'worktree' as const, worktree_id: 'tree' },
  }
  expect(chatCodePlaces([{ kind: 'target', access: 'read', ...target }], target)).toEqual([
    { target, root: undefined, current: true },
  ])
  expect(chatCodePlaces([])).toEqual([])
  const places = chatCodePlaces([
    { kind: 'project', node_id: 'node', project_id: 'project', access: 'read' },
  ])
  expect(places[1].root).toBe('/sample/root')
  expect(places.every((place) => !place.current)).toBe(true)
})
