import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('inventories the 33000-file seed-42 folder shape including hidden physical siblings', async () => {
  const files = 33000,
    attachments = Math.floor(files * 0.04)
  const rows = Array.from({ length: files }, (_, i) => {
    const folder = Math.floor(i / 32)
    let path = `Notes/Section ${folder % 31}/层 ${folder % 7}/Nested ${folder % 13}/Sample ${i}.md`
    if (i === 0) path = 'Notes/Case.md'
    if (i === 1) path = 'Notes/case.md'
    if (i === 2) path = '.obsidian/scale-sample.json'
    if (i === 3) path = '.obsidian/plugins/sample-disabled/data.json'
    if (i >= files - attachments)
      path = `Attachments/Batch ${i % 9}/Sample ${i}.${i % 2 ? 'pdf' : 'png'}`
    // Contents and sizes cannot affect directory scope admission.
    return { path: 'Shared/' + path, content: 'sample', mtime: 1000 }
  })
  const app = buildFakeVault(rows, { sensitiveNames: true })
  // Model constant-time directory lookup rather than the fake's whole-disk search.
  const children = new Map<string, { files: Set<string>; folders: Set<string> }>()
  for (const { path } of rows) {
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/')
      const one = children.get(parent) ?? { files: new Set<string>(), folders: new Set<string>() }
      one[i === parts.length - 1 ? 'files' : 'folders'].add(parts.slice(0, i + 1).join('/'))
      children.set(parent, one)
    }
  }
  app.vault.adapter.list = async (path) => ({
    files: [...(children.get(path)?.files ?? [])],
    folders: [...(children.get(path)?.folders ?? [])],
  })
  const fs = new ObsidianFileSystem(app as never, { fileScope: 'Shared' })
  expect(rows).toHaveLength(files)
  expect(app.vault.getFiles()).toHaveLength(files - 2)
  await expect(fs.listChildren('Shared')).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'Shared/Notes', kind: 'directory' }),
      expect.objectContaining({ path: 'Shared/Attachments', kind: 'directory' }),
    ])
  )
  expect((await fs.listChildren('Shared')).some((one) => one.path.includes('/.'))).toBe(false)
  const published = []
  for await (const entry of fs.listDirectories()) published.push(entry.path)
  expect(published).not.toContain('Shared/.obsidian')
  expect(published).toContain('Shared/Notes/Section 0/层 0/Nested 0')
})
