import { expect, it, vi } from 'vitest'
import { updateNodeFileTabs } from '@/node/nodePathNavigation'

it('moves descendant tabs and closes deleted files only in the affected node folder', async () => {
  const target = {
    registrationId: 'sample-registration',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  const leaf = (id: string, path: string) => ({
    getViewState: () => ({
      type: 'abele-node-file',
      state: { kind: 'file', target: { ...target, id }, path },
    }),
    setViewState: vi.fn(async () => {}),
    detach: vi.fn(),
  })
  const moved = leaf(target.id, 'src/sample.ts')
  const sibling = leaf(target.id, 'src-other/sample.ts')
  const other = leaf('other-tree', 'src/sample.ts')
  const historical = leaf(target.id, 'src/sample.ts')
  const unsaved = {
    ...leaf(target.id, 'src/draft.ts'),
    view: { hasUnsentNodeFileEdit: () => true },
  }
  const historicalView = historical.getViewState()
  historical.getViewState = () => ({
    ...historicalView,
    state: { ...historicalView.state, stage: { kind: 'committed', base: 'sample-base' } },
  })
  const workspace = { getLeavesOfType: () => [moved, sibling, other, historical, unsaved] }
  await updateNodeFileTabs(workspace as never, target, 'src', 'lib')
  expect(moved.setViewState).toHaveBeenCalledWith(
    expect.objectContaining({ state: expect.objectContaining({ path: 'lib/sample.ts' }) })
  )
  expect(sibling.setViewState).not.toHaveBeenCalled()
  expect(other.setViewState).not.toHaveBeenCalled()
  expect(historical.setViewState).not.toHaveBeenCalled()
  expect(unsaved.setViewState).not.toHaveBeenCalled()
  await updateNodeFileTabs(workspace as never, target, 'src')
  expect(moved.detach).toHaveBeenCalledOnce()
  expect(sibling.detach).not.toHaveBeenCalled()
  expect(other.detach).not.toHaveBeenCalled()
  expect(historical.detach).not.toHaveBeenCalled()
  expect(unsaved.detach).not.toHaveBeenCalled()
})
