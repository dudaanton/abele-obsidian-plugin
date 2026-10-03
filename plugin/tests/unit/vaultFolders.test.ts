import { describe, expect, it, vi } from 'vitest'
import { ensureFolder, ensureVaultFolder } from '@/helpers/vaultFolders'
import { attachmentPath, ensureAttachmentFolder } from '@/media/attachmentFolder'
import { useVault } from '../helpers/testEnv'

describe('shared folder and attachment contracts', () => {
  it.each([
    ['', undefined, 'sample.png'],
    ['/', 'Notes/sample.md', 'sample.png'],
    ['./', 'Notes/sample.md', 'Notes/sample.png'],
    ['./media', 'Notes/sample.md', 'Notes/media/sample.png'],
    ['./media', undefined, 'media/sample.png'],
    ['Assets', 'Notes/sample.md', 'Assets/sample.png'],
  ])('joins the %s attachment setting without changing the filename', (setting, note, path) => {
    expect(attachmentPath(setting, 'sample.png', note)).toBe(path)
  })

  it('creates missing parents in order, with no work for root or existing folders', async () => {
    const folders = new Set(['Notes'])
    const createFolder = vi.fn(async (path: string) => {
      folders.add(path)
    })
    const host = { folderExists: (path: string) => folders.has(path), createFolder }
    await ensureFolder(host, '')
    await ensureFolder(host, 'Notes/media/nested')
    await ensureFolder(host, 'Notes/media/nested')
    expect(createFolder.mock.calls).toEqual([['Notes/media'], ['Notes/media/nested']])
  })

  it('tolerates a concurrent creator, but does not swallow a storage failure', async () => {
    let exists = false
    await ensureFolder(
      {
        folderExists: () => exists,
        createFolder: async () => {
          exists = true
          throw new Error('already exists')
        },
      },
      'Assets'
    )
    const failure = new Error('storage unavailable')
    await expect(
      ensureFolder(
        {
          folderExists: () => false,
          createFolder: async () => {
            throw failure
          },
        },
        'Assets'
      )
    ).rejects.toBe(failure)
  })

  it('does not treat a file as a folder and checks cancellation before creating', async () => {
    const app = useVault([{ path: 'Assets', content: 'sample' }])
    await expect(ensureVaultFolder(app.vault as never, 'Assets')).rejects.toThrow()
    const create = vi.spyOn(app.vault, 'createFolder')
    const controller = new AbortController()
    controller.abort()
    await expect(ensureVaultFolder(app.vault as never, 'New', controller.signal)).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('uses the same race-safe creation for attachment folders', async () => {
    const app = useVault([])
    Object.assign(app.vault, { getConfig: () => 'Assets' })
    const create = app.vault.createFolder.bind(app.vault)
    vi.spyOn(app.vault, 'createFolder').mockImplementationOnce(async (path) => {
      await create(path)
      throw new Error('created by a concurrent writer')
    })
    await expect(ensureAttachmentFolder(app as never)).resolves.toBe('Assets')
  })
})
