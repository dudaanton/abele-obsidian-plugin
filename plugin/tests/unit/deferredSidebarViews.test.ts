import { expect, it, vi } from 'vitest'
import { loadDeferredSidebarViews } from '@/views/revealSidebarView'
it('restores main tab titles too when explicitly requested', async () => {
  const leaf = { getRoot: () => ({}), loadIfDeferred: vi.fn(async () => {}), updateHeader: vi.fn() }
  const workspace = { getLeavesOfType: () => [leaf] }
  await loadDeferredSidebarViews(workspace as never, ['sample-run', 'sample-request'], true)
  expect(leaf.loadIfDeferred).toHaveBeenCalledOnce()
  expect(leaf.updateHeader).toHaveBeenCalledOnce()
})
it('loads restored sidebar labels without selecting or loading unrelated panes', async () => {
  const rightSplit = {},
    leftSplit = {},
    main = {}
  const sidebar = { getRoot: () => rightSplit, loadIfDeferred: vi.fn(async () => {}) }
  const mainLeaf = { getRoot: () => main, loadIfDeferred: vi.fn(async () => {}) }
  const workspace = { rightSplit, leftSplit, getLeavesOfType: vi.fn(() => [sidebar, mainLeaf]) }
  await loadDeferredSidebarViews(workspace as never, ['sample-timeline'])
  expect(sidebar.loadIfDeferred).toHaveBeenCalledOnce()
  expect(mainLeaf.loadIfDeferred).not.toHaveBeenCalled()
})
