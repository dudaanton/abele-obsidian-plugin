import { expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { createLsTool } from '@/ai/tools/LsTool'
import { namedBook } from '@/ai/tools/bookToolKit'

it('lists absent original paths in folder scope and reads content without exposing the stub', async () => {
  const app = useVault([{ path: 'Archive/sample.txt.abele-ref', content: 'projection' }])
  const scope = ScopeResolver.getInstance()
  scope.clear()
  scope.addFolder('Archive')
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember(
    'sample',
    [{ path: 'Archive/sample.txt', size: 12, mtime: 1 }],
    ['Archive/sample.txt.abele-ref']
  )
  const hydrate = vi.fn(async () => {
    await app.vault.create('Archive/sample.txt', 'real content')
  })
  manager.hydrator('sample', hydrate)
  expect(scope.getAccessiblePaths()).toContain('Archive/sample.txt')
  expect(scope.getAccessiblePaths()).not.toContain('Archive/sample.txt.abele-ref')
  const listing = await createLsTool().execute('ls', { path: 'Archive' })
  expect(listing.content[0]).toMatchObject({
    text: expect.stringContaining('sample.txt · 12 bytes · offloaded'),
  })
  const result = await createReadFileTool().execute('read', { path: 'Archive/sample.txt' })
  expect(result.content[0]).toMatchObject({ text: 'real content' })
  expect(hydrate).toHaveBeenCalledOnce()
})

it('authorizes absent books before downloading and retains the linked position', async () => {
  const app = useVault([{ path: 'Books/sample.epub.abele-ref', content: 'projection' }])
  const scope = ScopeResolver.getInstance()
  scope.clear()
  scope.addFolder('Books')
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  manager.remember(
    'sample',
    [
      { path: 'Books/sample.epub', size: 12, mtime: 1 },
      { path: 'Private/other.epub', size: 1, mtime: 1 },
    ],
    []
  )
  const hydrate = vi.fn(async (path: string) => {
    await app.vault.create(path, 'book content')
  })
  manager.hydrator('sample', hydrate)
  const book = await namedBook('Books/sample.epub#page=4')
  expect(book.file.path).toBe('Books/sample.epub')
  expect(book.place).toEqual({ page: 4 })
  await expect(namedBook('Private/other.epub')).rejects.toThrow(/Access denied/)
  expect(hydrate).toHaveBeenCalledOnce()
})
