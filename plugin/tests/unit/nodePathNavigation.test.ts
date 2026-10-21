import { describe, expect, it, vi } from 'vitest'
import {
  NodePathTabSchema,
  closeNodePathDrawers,
  nodePathTabKey,
  openNodePathTab,
  revealNodeDrawer,
} from '@/node/nodePathNavigation'
const target = (id = 'tree-a') => ({
  nodeId: 'node-demo',
  registrationId: 'registration-demo',
  projectId: 'project-demo',
  kind: 'worktree' as const,
  id,
})
describe('main area node leaves', () => {
  it('prefers the same file opened from search over another file tab', async () => {
    const state = { kind: 'file', target: target(), path: 'sample.ts' }
    const first = {
      getViewState: () => ({ state: { ...state, path: 'other.ts' } }),
      setViewState: vi.fn(),
    }
    const same = { getViewState: () => ({ state: { ...state, line: 3 } }), setViewState: vi.fn() }
    const workspace = {
      getLeavesOfType: () => [first, same],
      revealLeaf: vi.fn(),
      getLeaf: vi.fn(),
    }
    await openNodePathTab(workspace as never, state as never, false)
    expect(same.setViewState).toHaveBeenCalled()
    expect(first.setViewState).not.toHaveBeenCalled()
  })
  it('restores a committed diff with its selected base', () => {
    const stage = { kind: 'committed', base: 'refs/heads/release' }
    const state = NodePathTabSchema.parse({
      kind: 'file',
      target: target(),
      path: 'sample.ts',
      stage,
    })
    expect(state.kind === 'file' && state.stage).toEqual(stage)
  })
  it('opens a catalogue target carrying selection recovery metadata without changing its binding', () => {
    const located = {
      ...target(),
      location: { root: '/sample/repo', path: '/sample/repo', kind: 'root' as const },
    }
    const state = NodePathTabSchema.parse({ kind: 'file', target: located, path: 'sample.ts' })
    expect(state.target).toEqual(located)
    expect(nodePathTabKey(state)).toBe(
      nodePathTabKey({ kind: 'file', target: target(), path: 'sample.ts' })
    )
  })
  it('uncovers a source on a phone by closing both drawers, leaving desktop panes alone', () => {
    const workspace = { leftSplit: { collapse: vi.fn() }, rightSplit: { collapse: vi.fn() } }
    closeNodePathDrawers(workspace as never, false)
    expect(workspace.leftSplit.collapse).not.toHaveBeenCalled()
    expect(workspace.rightSplit.collapse).not.toHaveBeenCalled()
    closeNodePathDrawers(workspace as never, true)
    expect(workspace.leftSplit.collapse).toHaveBeenCalledOnce()
    expect(workspace.rightSplit.collapse).toHaveBeenCalledOnce()
  })
  it('retains an explicit debug source line in the tab state', () => {
    const state = NodePathTabSchema.parse({
      kind: 'file',
      target: target(),
      path: 'sample.ts',
      debug: {
        conversationId: 'sample-chat',
        sourceId: 'sample-source',
        debugSessionId: 'sample-debug',
        incarnation: 'sample-incarnation',
        line: 12,
      },
    })
    expect(state.kind === 'file' && state.debug?.line).toBe(12)
  })
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
  it('reveals the Node drawer tab before expanding instead of opening a different sidebar', async () => {
    const leaf = { setViewState: vi.fn(async () => {}) }
    const workspace = {
      getLeavesOfType: vi.fn(() => [leaf]),
      revealLeaf: vi.fn(async () => {}),
      leftSplit: { expand: vi.fn() },
    }
    await revealNodeDrawer(workspace as never, 'sample-registration')
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf)
    expect(workspace.leftSplit.expand).toHaveBeenCalledOnce()
    expect(leaf.setViewState).toHaveBeenCalledWith(
      expect.objectContaining({ state: { registrationId: 'sample-registration' } })
    )
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
  it('opens what was the editor tab as the file’s own tab, editing', async () => {
    const leaf = { getViewState: () => ({ state: {} }), setViewState: vi.fn(async () => {}) }
    const workspace = {
      getLeavesOfType: vi.fn(() => [leaf]),
      getLeaf: vi.fn(() => leaf),
      revealLeaf: vi.fn(async () => {}),
      leftSplit: { collapse: vi.fn() },
    }
    await openNodePathTab(
      workspace as never,
      { kind: 'editor', target: target(), path: 'sample.ts' },
      false
    )
    expect(workspace.getLeavesOfType).toHaveBeenCalledWith('abele-node-file')
    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: 'abele-node-file',
      active: true,
      state: { kind: 'file', target: target(), path: 'sample.ts', edit: true },
    })
  })
})
