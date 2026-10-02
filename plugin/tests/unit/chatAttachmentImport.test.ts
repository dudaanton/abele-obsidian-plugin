import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importExternalFile } from '@/ai/attachments'
import { useVault } from '../helpers/testEnv'

beforeEach(() => vi.restoreAllMocks())

describe('chat attachment import destinations', () => {
  it.each(['/', '.', './'])('imports into the vault root for %s', async (folder) => {
    const app = useVault([])
    Object.assign(app.vault, { getConfig: () => folder })
    const createFolder = vi
      .spyOn(app.vault, 'createFolder')
      .mockRejectedValue(new Error('Folder already exists.'))
    const imported = await importExternalFile(new File(['sample content'], 'sample-attachment.txt'))
    expect(imported.path).toBe('sample-attachment.txt')
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('creates the configured folder and keeps existing attachments', async () => {
    const app = useVault([
      { path: 'Sample attachments/sample-attachment.txt', content: 'original' },
    ])
    Object.assign(app.vault, { getConfig: () => 'Sample attachments' })
    const imported = await importExternalFile(new File(['new content'], 'sample-attachment.txt'))
    expect(imported.path).toBe('Sample attachments/sample-attachment 1.txt')
    expect(
      await app.vault.read(
        app.vault.getAbstractFileByPath('Sample attachments/sample-attachment.txt') as never
      )
    ).toBe('original')
  })
})
