// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { detachExternalFileLeaves } from '../e2e/helpers/externalFileLeaves'

it('fails teardown if the root query still finds a card after detach', async () => {
  const leaf = {
    view: { getViewType: () => 'abele-external-file' },
    getViewState: () => ({}),
    detach: vi.fn(),
  }
  const workspace = { iterateRootLeaves: (visit: (value: typeof leaf) => void) => visit(leaf) }
  await expect(detachExternalFileLeaves(workspace)).rejects.toThrow('remain after teardown: 1')
})

it('uses root-view enumeration to detach deferred and pathless cards before asserting zero remain', async () => {
  const leaves = new Set<any>()
  const make = (type: string) => {
    const leaf = {
      view: { getViewType: () => type },
      getViewState: () => ({ state: {} }),
      detach: vi.fn(() => {
        leaves.delete(leaf)
      }),
    }
    leaves.add(leaf)
    return leaf
  }
  const deferred = make('abele-external-file'),
    pathless = make('abele-external-file')
  const ordinary = make('markdown')
  const workspace = {
    getLeavesOfType: vi.fn(() => []),
    iterateRootLeaves: vi.fn((visit: (leaf: any) => void) => {
      for (const leaf of leaves) visit(leaf)
    }),
  }
  const serialized = new Function(
    `return (${detachExternalFileLeaves.toString()})`
  )() as typeof detachExternalFileLeaves
  await serialized(workspace)
  expect(deferred.detach).toHaveBeenCalledOnce()
  expect(pathless.detach).toHaveBeenCalledOnce()
  expect(ordinary.detach).not.toHaveBeenCalled()
  expect([...leaves]).toEqual([ordinary])
  expect(workspace.iterateRootLeaves).toHaveBeenCalledTimes(2)
})

it('closes initialized and deferred owned cards using the leaf state, preserving unrelated cards', async () => {
  const leaf = (path: string) => ({
    getViewState: () => ({ state: { path } }),
    // An inactive deferred view need not expose the saved path through view.getState().
    view: { getState: () => ({}), getViewType: () => 'abele-external-file' },
    detach: vi.fn(),
  })
  const owned = leaf('Sample fixtures/image.png')
  const initialized = leaf('Sample fixtures/video.mp4')
  initialized.view.getState = () => ({ path: 'Sample fixtures/video.mp4' })
  const other = leaf('Other fixtures/image.png')
  const neighbor = leaf('Sample fixtures-copy/image.png')
  const leaves = new Set([owned, initialized, other, neighbor])
  owned.detach.mockImplementation(() => {
    leaves.delete(owned)
  })
  initialized.detach.mockImplementation(() => {
    leaves.delete(initialized)
  })
  const workspace = {
    iterateRootLeaves: vi.fn((visit: (leaf: typeof owned) => void) => {
      for (const leaf of leaves) visit(leaf)
    }),
  }
  const serialized = new Function(
    `return (${detachExternalFileLeaves.toString()})`
  )() as typeof detachExternalFileLeaves
  await serialized(workspace, 'Sample fixtures')
  expect(owned.detach).toHaveBeenCalledOnce()
  expect(initialized.detach).toHaveBeenCalledOnce()
  expect(other.detach).not.toHaveBeenCalled()
  expect(neighbor.detach).not.toHaveBeenCalled()
  expect(workspace.iterateRootLeaves).toHaveBeenCalledTimes(2)
})
