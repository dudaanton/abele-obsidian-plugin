import { expect, it } from 'vitest'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { useVault } from '../helpers/testEnv'
import { TFile } from 'obsidian'

it('copies binary files without decoding them as note text', async () => {
  const app = useVault([])
  const bytes = new Uint8Array([0, 255, 254, 1, 128]).buffer
  await app.vault.createBinary('sample-image.png', bytes)
  await createCopyFileTool({ skipScope: true }).execute('sample-copy', {
    from: 'sample-image.png',
    to: 'sample-copy.png',
  })
  const copied = app.vault.getAbstractFileByPath('sample-copy.png') as TFile
  expect(new Uint8Array(await app.vault.readBinary(copied))).toEqual(new Uint8Array(bytes))
})

it('preserves text and frontmatter exactly when copying a note', async () => {
  const text = '---\nname: Sample\n---\n\nText with accents: é.\n'
  const app = useVault([{ path: 'sample.md', raw: text }])
  await createCopyFileTool({ skipScope: true }).execute('sample-copy', {
    from: 'sample.md',
    to: 'sample-copy.md',
  })
  const copied = app.vault.getAbstractFileByPath('sample-copy.md') as TFile
  expect(await app.vault.read(copied)).toBe(text)
})
