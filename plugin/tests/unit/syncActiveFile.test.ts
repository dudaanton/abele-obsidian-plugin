// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { restoreSyncActiveFile } from '../e2e/helpers/syncActiveFile'

it.each(['bin', 'pdf', 'png'])(
  'does not reopen a saved %s file on the phone',
  async (extension) => {
    const file = { path: 'Sample/archive.' + extension, extension }
    const openFile = vi.fn(),
      getLeaf = vi.fn(() => ({ openFile }))
    const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf } }
    await restoreSyncActiveFile(app as never, file.path, true)
    expect(getLeaf).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  }
)

it.each([true, false])('restores a saved Markdown note with phone=%s', async (phone) => {
  const file = { path: 'Sample/note.md', extension: 'md' },
    openFile = vi.fn()
  const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf: () => ({ openFile }) } }
  await restoreSyncActiveFile(app as never, file.path, phone)
  expect(openFile).toHaveBeenCalledExactlyOnceWith(file)
})

it('keeps desktop restoration of a binary view', async () => {
  const file = { path: 'Sample/archive.bin', extension: 'bin' },
    openFile = vi.fn()
  const app = { vault: { getFileByPath: () => file }, workspace: { getLeaf: () => ({ openFile }) } }
  await restoreSyncActiveFile(app as never, file.path, false)
  expect(openFile).toHaveBeenCalledExactlyOnceWith(file)
})

it.each([null, 'Sample/missing.md'])('does not open an absent saved file %s', async (path) => {
  const getLeaf = vi.fn(),
    app = { vault: { getFileByPath: () => null }, workspace: { getLeaf } }
  await restoreSyncActiveFile(app as never, path, true)
  expect(getLeaf).not.toHaveBeenCalled()
})
