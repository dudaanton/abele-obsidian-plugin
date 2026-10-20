import { expect, it, vi } from 'vitest'
import { openNodeFileDestination } from '@/node/nodePathNavigation'
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
const state = { kind: 'file' as const, target, path: 'sample.ts' }
const leaf = (saved = state) => ({
  getViewState: () => ({ state: saved }),
  setViewState: vi.fn(async () => {}),
})
it('prefers the current tab when two views of the same file are already open', async () => {
  const first = leaf(),
    active = leaf()
  const workspace = {
    getMostRecentLeaf: () => active,
    getLeavesOfType: () => [first, active],
    getLeaf: vi.fn(),
    revealLeaf: vi.fn(async () => {}),
  }
  await openNodeFileDestination(workspace as never, { ...state, line: 5 }, false)
  expect(first.setViewState).not.toHaveBeenCalled()
  expect(active.setViewState).toHaveBeenCalled()
})
it('does not replace an open historical file with a working-file destination', async () => {
  const historical = leaf({ ...state, stage: { kind: 'committed', base: 'sample-base' } } as never),
    working = leaf()
  const workspace = {
    getMostRecentLeaf: () => null,
    getLeavesOfType: () => [historical],
    getLeaf: vi.fn(() => working),
    revealLeaf: vi.fn(async () => {}),
  }
  await openNodeFileDestination(workspace as never, { ...state, line: 5 }, false)
  expect(historical.setViewState).not.toHaveBeenCalled()
  expect(working.setViewState).toHaveBeenCalledWith(
    expect.objectContaining({ state: expect.not.objectContaining({ stage: expect.anything() }) })
  )
})
it('jumps within the current file without losing its debug mapping or rereading a staged document', async () => {
  const debug = {
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    line: 1,
  }
  const current = leaf({ ...state, stage: 'unstaged', debug } as never)
  const workspace = {
    getMostRecentLeaf: () => null,
    getLeavesOfType: () => [current],
    getLeaf: vi.fn(),
    revealLeaf: vi.fn(async () => {}),
    leftSplit: { collapse: vi.fn() },
    rightSplit: { collapse: vi.fn() },
  }
  await openNodeFileDestination(workspace as never, { ...state, line: 8 }, false)
  expect(workspace.getLeaf).not.toHaveBeenCalled()
  expect(current.setViewState).toHaveBeenCalledWith(
    expect.objectContaining({
      state: expect.objectContaining({ line: 8, stage: 'unstaged', debug: { ...debug, line: 8 } }),
    })
  )
})
it('opens another file in its own tab and then reuses that tab', async () => {
  const current = leaf(),
    next = leaf({ ...state, path: 'other.ts' })
  const rows = [current]
  const workspace = {
    getMostRecentLeaf: () => null,
    getLeavesOfType: () => rows,
    getLeaf: vi.fn(() => next),
    revealLeaf: vi.fn(async () => {}),
    leftSplit: { collapse: vi.fn() },
    rightSplit: { collapse: vi.fn() },
  }
  await openNodeFileDestination(workspace as never, { ...state, path: 'other.ts', line: 3 }, true)
  expect(current.setViewState).not.toHaveBeenCalled()
  expect(workspace.getLeaf).toHaveBeenCalledWith('tab')
  rows.push(next)
  await openNodeFileDestination(workspace as never, { ...state, path: 'other.ts', line: 5 }, true)
  expect(workspace.getLeaf).toHaveBeenCalledOnce()
  expect(workspace.rightSplit.collapse).toHaveBeenCalled()
})
