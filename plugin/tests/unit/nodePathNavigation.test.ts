import { describe, expect, it, vi } from 'vitest'
import { nodePathTabKey, openNodePathTab } from '@/node/nodePathNavigation'
const target = (id = 'tree-a') => ({
  nodeId: 'node-demo',
  registrationId: 'registration-demo',
  projectId: 'project-demo',
  kind: 'worktree' as const,
  id,
})
describe('main area node leaves', () => {
  it('keys history and editors by node and target, never filename alone', () => {
    expect(nodePathTabKey({ kind: 'editor', target: target(), path: 'sample.ts' })).not.toBe(
      nodePathTabKey({ kind: 'editor', target: target('tree-b'), path: 'sample.ts' })
    )
    expect(nodePathTabKey({ kind: 'history', target: target() })).not.toBe(
      nodePathTabKey({
        kind: 'history',
        target: { ...target(), registrationId: 'other-registration' },
      })
    )
  })
  it('keeps one node chat leaf when its backend worktree binding changes', () => {
    const a = { kind: 'chat' as const, target: target(), sessionId: 'sample-chat', title: 'Sample' }
    expect(nodePathTabKey(a)).toBe(nodePathTabKey({ ...a, target: target('tree-b') }))
  })
  it('replaces the one file tab, reveals it and closes only the mobile left drawer', async () => {
    const leaf = {
      getViewState: () => ({ state: { kind: 'file', target: target(), path: 'old.ts' } }),
      setViewState: vi.fn(async () => {}),
    }
    const workspace = {
      getLeavesOfType: vi.fn(() => [leaf]),
      getLeaf: vi.fn(),
      revealLeaf: vi.fn(async () => {}),
      leftSplit: { collapse: vi.fn() },
    }
    await openNodePathTab(
      workspace as never,
      { kind: 'file', target: target('tree-b'), path: 'sample.ts' },
      true
    )
    expect(workspace.getLeaf).not.toHaveBeenCalled()
    expect(leaf.setViewState).toHaveBeenCalledWith(
      expect.objectContaining({ state: expect.objectContaining({ target: target('tree-b') }) })
    )
    expect(workspace.leftSplit.collapse).toHaveBeenCalledOnce()
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf)
  })
})
