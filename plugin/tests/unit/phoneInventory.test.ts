import { expect, it, vi } from 'vitest'
import { projectionEvidence, EXTERNAL_INSPECTION_KEY } from '@/sync/external/pluginSafety'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('uses indexed stats for a warm 12k-file inspection and local scan', async () => {
  const app = buildFakeVault(
    Array.from({ length: 12000 }, (_, i) => ({ path: `Notes/${i}.md`, content: 'note' }))
  )
  app.saveLocalStorage(EXTERNAL_INSPECTION_KEY, {
    schema: 1,
    entries: app.vault.getFiles().map((file) => ({
      path: file.path,
      size: file.stat.size,
      mtime: file.stat.mtime,
      marker: false,
    })),
  })
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const save = vi.spyOn(app, 'saveLocalStorage')
  await projectionEvidence(app as never)
  const fs = new ObsidianFileSystem(app as never)
  for (const file of app.vault.getFiles()) await fs.stat(file.path)
  expect(stat.mock.calls.filter(([path]) => path.startsWith('Notes/'))).toHaveLength(0)
  expect(read).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

it('reuses inspection inventory for the first and fallback local listings', async () => {
  const app = buildFakeVault([
    ...Array.from({ length: 12000 }, (_, i) => ({ path: `Notes/${i}.md`, content: 'note' })),
    { path: '.obsidian/app.json', content: '{}' },
  ])
  let inventory: ReadonlyMap<string, { path: string; size: number; mtime: number }> | undefined
  await projectionEvidence(app as never, () => {}, true, new Set(), {
    inventory: (files) => {
      inventory = files
    },
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const fs = new ObsidianFileSystem(app as never, { startupInventory: () => inventory })
  for (let scan = 0; scan < 3; scan++) {
    const files = []
    for await (const file of fs.list()) files.push(file)
    expect(files).toHaveLength(12001)
  }
  expect(list).not.toHaveBeenCalled()
  expect(stat).not.toHaveBeenCalled()
})
