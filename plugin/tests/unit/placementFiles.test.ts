import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { JOURNAL_KEY } from '@/sync/writeJournal'

it('keeps a journal and local bytes intact if placement finds unrecovered work on its own path', async () => {
  const app = buildFakeVault([{ path: 'note.md', content: 'local edit' }])
  const journal = [{ target: 'note.md' }]
  app.saveLocalStorage(JOURNAL_KEY, journal)
  const fs = new ObsidianFileSystem(app as unknown as App)
  await expect(
    (async () => {
      for await (const _info of fs.placementFiles(['note.md'])) {
        /* Must refuse before yielding. */
      }
    })()
  ).rejects.toThrow('write recovery')
  expect(app.loadLocalStorage(JOURNAL_KEY)).toEqual(journal)
  expect(await app.vault.adapter.read('note.md')).toBe('local edit')
})

it('does not request whole-vault recovery from inside a placement lease when another path has a journal', async () => {
  const app = buildFakeVault([{ path: 'note.md', content: 'local edit' }])
  app.saveLocalStorage(JOURNAL_KEY, [{ target: 'other.md' }])
  const fs = new ObsidianFileSystem(app as unknown as App)
  const locks = pathCoordinatorOf(app.vault)
  let reading: Promise<string[]> | undefined
  await locks.run(['note.md'], async () => {
    reading = (async () => {
      const paths: string[] = []
      for await (const info of fs.placementFiles(['note.md'])) paths.push(info.path)
      return paths
    })()
    const result = await Promise.race([
      reading,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ])
    expect(result, 'capture requested the global lease while holding note.md').toEqual(['note.md'])
  })
  await reading
})

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
