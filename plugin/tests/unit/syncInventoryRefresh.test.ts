import { expect, it, vi } from 'vitest'
import type { TFolder } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it('reuses startup inventory once and observes later config edits without waiting for the poll', async () => {
  const app = buildFakeVault([{ path: '.obsidian/app.json', content: '{}', mtime: 1 }])
  const initial = new Map([
    ['.obsidian/app.json', { path: '.obsidian/app.json', size: 2, mtime: 1 }],
  ])
  const fs = new ObsidianFileSystem(app as never, { startupInventory: () => initial })
  const collect = async () => {
    const files = []
    for await (const info of fs.list()) files.push(info)
    return files
  }
  expect(await collect()).toContainEqual(initial.get('.obsidian/app.json'))
  await app.vault.adapter.writeBinary(
    '.obsidian/app.json',
    new TextEncoder().encode('{"changed":true}').buffer as ArrayBuffer,
    { mtime: 2 }
  )
  expect(await collect()).toContainEqual({ path: '.obsidian/app.json', size: 16, mtime: 2 })
})

it('does not stat published siblings again after the index observes them during a pull', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never, { fileScope: 'Container/Shared' })
  const bytes = new TextEncoder().encode('sample')
  const paths = Array.from({ length: 4 }, (_, i) => `Container/Shared/Notes/sample-${i}.md`)
  for (const path of paths) {
    await fs.writeAtomic(path, bytes, 1000)
    await app.vault.createBinary(path, bytes.buffer)
  }
  const lagging = 'Container/Shared/Notes/lagging.md'
  await fs.writeAtomic(lagging, bytes, 1000)
  // The fake adapter indexes synchronously; hide this last child to model watcher lag.
  const parent = app.vault.getAbstractFileByPath('Container/Shared/Notes') as TFolder
  parent.children = parent.children.filter((child) => child.path !== lagging)
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
    const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
      'Container/Shared/Notes',
      'Container/Shared/Notes/next.md'
    )
    expect(children.filter((one) => one.kind === 'file').map((one) => one.path)).toEqual([
      ...paths,
      lagging,
    ])
    expect(stat.mock.calls.filter(([path]) => paths.includes(path))).toEqual([])
    expect(stat.mock.calls.filter(([path]) => path === lagging)).toHaveLength(1)
  })
})
