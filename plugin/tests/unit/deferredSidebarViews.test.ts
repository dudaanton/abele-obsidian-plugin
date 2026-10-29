import { expect, it, vi } from 'vitest'
import { loadDeferredSidebarViews, restoreRegisteredViewHeaders } from '@/views/revealSidebarView'
it('repairs leaves restored after the registry callback has temporarily emptied them', async () => {
  let changed!: () => void
  let ready!: () => void
  let leaves: unknown[] = []
  const plugin = {
    register: vi.fn(),
    registerEvent: vi.fn(),
    app: {
      workspace: {
        on: (_event: string, callback: () => void) => {
          changed = callback
        },
        onLayoutReady: (callback: () => void) => {
          ready = callback
        },
        getLeavesOfType: () => leaves,
      },
    },
  }
  restoreRegisteredViewHeaders(plugin as never, ['sample-run'])
  ready()
  const loadIfDeferred = vi.fn(async () => {})
  leaves = [{ getRoot: () => ({}), loadIfDeferred }]
  changed()
  await vi.waitFor(() => expect(loadIfDeferred).toHaveBeenCalledOnce())
})
it('recreates an unloaded plugin placeholder while preserving its retained state', async () => {
  let title = 'sample-run'
  let header = title
  const state = { type: 'sample-run', state: { runId: 'sample-run-id' } }
  const leaf = {
    getRoot: () => ({}),
    getViewState: () => state,
    view: { getViewType: () => 'sample-run', getDisplayText: () => title },
    loadIfDeferred: vi.fn(async () => {}),
    rebuildView: vi.fn(async () => {
      title = 'Sample run'
    }),
    updateHeader: () => {
      header = title
    },
  }
  await loadDeferredSidebarViews({ getLeavesOfType: () => [leaf] } as never, ['sample-run'], true)
  expect(header).toBe('Sample run')
  expect(leaf.getViewState()).toEqual(state)
})
it('leaves a working host reconstruction alone until the next layout change', async () => {
  const leaf = {
    working: true,
    getRoot: () => ({}),
    view: { getViewType: () => 'sample-run', getDisplayText: () => 'sample-run' },
    rebuildView: vi.fn(async () => {}),
  }
  const workspace = { getLeavesOfType: () => [leaf] }
  await loadDeferredSidebarViews(workspace as never, ['sample-run'], true)
  expect(leaf.rebuildView).not.toHaveBeenCalled()
  leaf.working = false
  await loadDeferredSidebarViews(workspace as never, ['sample-run'], true)
  expect(leaf.rebuildView).toHaveBeenCalledOnce()
})
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
