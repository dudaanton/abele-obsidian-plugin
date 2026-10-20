import { expect, it, vi } from 'vitest'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { createDeleteFileTool } from '@/ai/tools/DeleteFileTool'
import { useVault } from '../helpers/testEnv'

it('creates missing destination parents before moving a note', async () => {
  const app = useVault([{ path: 'sample.md', raw: 'Sample' }])
  const rename = vi.spyOn(app.fileManager, 'renameFile').mockImplementation(async (_file, to) => {
    expect(app.vault.getAbstractFileByPath(to.split('/').slice(0, -1).join('/'))).toBeTruthy()
  })
  await createMoveFileTool({ skipScope: true }).execute('move', {
    from: 'sample.md',
    to: 'New/Nested/sample.md',
  })
  expect(rename).toHaveBeenCalledOnce()
})

it('can delete an unindexed hidden file through the vault adapter', async () => {
  const app = useVault([])
  await app.vault.adapter.write('.sample.md', 'Sample')
  Object.assign(app.vault.adapter, {
    trashSystem: async () => false,
    trashLocal: async (path: string) => app.vault.adapter.remove(path),
  })
  expect(app.vault.getAbstractFileByPath('.sample.md')).toBeNull()
  await createDeleteFileTool({ skipScope: true }).execute('remove', { path: '.sample.md' })
  expect(await app.vault.adapter.exists('.sample.md')).toBe(false)
})
