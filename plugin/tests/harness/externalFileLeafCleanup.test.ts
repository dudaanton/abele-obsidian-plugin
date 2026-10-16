// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { detachExternalFileLeaves } from '../e2e/helpers/externalFileLeaves'

it('closes initialized and deferred owned cards using the leaf state, preserving unrelated cards', async () => {
  const leaf = (path: string) => ({
    getViewState: () => ({ state: { path } }),
    // An inactive deferred view need not expose the saved path through view.getState().
    view: { getState: () => ({}) },
    detach: vi.fn(),
  })
  const owned = leaf('Sample fixtures/image.png')
  const initialized = leaf('Sample fixtures/video.mp4')
  initialized.view.getState = () => ({ path: 'Sample fixtures/video.mp4' })
  const other = leaf('Other fixtures/image.png')
  const neighbor = leaf('Sample fixtures-copy/image.png')
  const workspace = { getLeavesOfType: vi.fn(() => [owned, initialized, other, neighbor]) }
  const serialized = new Function(
    `return (${detachExternalFileLeaves.toString()})`
  )() as typeof detachExternalFileLeaves
  await serialized(workspace, 'Sample fixtures')
  expect(owned.detach).toHaveBeenCalledOnce()
  expect(initialized.detach).toHaveBeenCalledOnce()
  expect(other.detach).not.toHaveBeenCalled()
  expect(neighbor.detach).not.toHaveBeenCalled()
  expect(workspace.getLeavesOfType).toHaveBeenCalledWith('abele-external-file')
})
