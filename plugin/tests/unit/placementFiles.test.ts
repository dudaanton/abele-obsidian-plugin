import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('captures only the affected subtree without walking unrelated installed plugin code', async () => {
  const app = buildFakeVault([
    { path: 'note.md', content: 'local edit' },
    { path: 'Moved/child.md', content: 'child edit' },
    { path: '.obsidian/plugins/unrelated/main.js', content: 'large installed code' },
  ])
  const fs = new ObsidianFileSystem(app as unknown as App)
  const list = vi.spyOn(app.vault.adapter, 'list')
  const paths = []
  for await (const file of fs.placementFiles(['note.md', 'Moved', 'missing.md']))
    paths.push(file.path)
  expect(paths.sort()).toEqual(['Moved/child.md', 'note.md'])
  expect(list.mock.calls.map(([path]) => path)).not.toContain('.obsidian')
})
