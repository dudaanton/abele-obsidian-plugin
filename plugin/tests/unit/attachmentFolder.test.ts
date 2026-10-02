import { describe, expect, it, vi } from 'vitest'
import { ensureAttachmentFolder, resolveAttachmentFolder } from '@/media/attachmentFolder'
import { useVault } from '../helpers/testEnv'

describe('Obsidian attachment folder settings', () => {
  it.each([
    ['/', '', ''],
    ['.', '', ''],
    ['./', '', 'Notes'],
    ['./sub', 'sub', 'Notes/sub'],
    ['folder', 'folder', 'folder'],
  ])('resolves %s without a note and beside a note', (setting, withoutNote, besideNote) => {
    expect(resolveAttachmentFolder(setting)).toBe(withoutNote)
    expect(resolveAttachmentFolder(setting, 'Notes/sample-note.md')).toBe(besideNote)
  })

  it('creates nested same-folder paths from the source note, not at the vault root', async () => {
    const app = useVault([{ path: 'Notes/sample-note.md', content: '' }])
    Object.assign(app.vault, { getConfig: () => './media/generated' })
    const createFolder = vi.spyOn(app.vault, 'createFolder')
    const folder = await ensureAttachmentFolder(app as never, 'Notes/sample-note.md')
    expect(folder).toBe('Notes/media/generated')
    expect(createFolder.mock.calls.map(([path]) => path)).toEqual([
      'Notes/media',
      'Notes/media/generated',
    ])
  })
})
