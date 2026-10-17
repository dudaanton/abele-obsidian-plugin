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

it.each([false, true])(
  'exposes published parents immediately and batches their identity reads (raw cache=%s)',
  async (rawCache) => {
    const root = 'Container/Shared'
    const app = buildFakeVault([])
    await app.vault.adapter.mkdir(root)
    const fs = new ObsidianFileSystem(app as never, { fileScope: root })
    const parents = [root + '/Fresh', root + '/Fresh/Sub']
    const stat = vi.spyOn(app.vault.adapter, 'stat')
    await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
      await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
      if (rawCache) await fs.listChildren(root)
      stat.mockClear()
      await fs.writeAtomic(parents[1] + '/sample.md', new TextEncoder().encode('sample'), 1000)
      expect(stat.mock.calls.filter(([path]) => parents.includes(path))).toEqual([])
      for (const [parent, child] of [
        [root, parents[0]],
        [parents[0], parents[1]],
      ]) {
        const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
          parent,
          parents[1] + '/next.md'
        )
        expect(children).toContainEqual(expect.objectContaining({ path: child, kind: 'directory' }))
      }
      // A directory consumer must get real birth identities, never just membership proofs.
      const directories = await fs[Symbol.for('abele.sync.inventory-directories-v1')](true)
      for (const path of parents)
        expect(directories).toContainEqual(
          expect.objectContaining({ path, identity: expect.any(String) })
        )
    })
    const records = app.loadLocalStorage('abele-sync-local-directories-v1') as {
      path: string
      identity: string
    }[]
    for (const path of parents)
      expect(records).toContainEqual(
        expect.objectContaining({ path, identity: expect.any(String) })
      )
  }
)

it.each(['delete', 'rename'] as const)(
  'retires published parent membership on a %s event',
  async (event) => {
    const root = 'Container/Shared'
    const path = root + '/Fresh'
    const app = buildFakeVault([])
    await app.vault.adapter.mkdir(root)
    const fs = new ObsidianFileSystem(app as never, { fileScope: root })
    await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
      await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
      await fs.writeAtomic(path + '/sample.md', new TextEncoder().encode('sample'), 1000)
      if (event === 'rename') {
        await app.vault.rename(app.vault.getAbstractFileByPath(path)!, root + '/Moved')
        app.emit('vault', event, { path: root + '/Moved', children: [] }, path)
      } else {
        await app.vault.adapter.rmdir(path, true)
        app.emit('vault', event, { path, children: [] })
      }
      const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
        root,
        root + '/next.md'
      )
      expect(children.some((one) => one.path === path)).toBe(false)
      const directories = await fs[Symbol.for('abele.sync.inventory-directories-v1')](true)
      expect(directories.some((one) => one.path === path)).toBe(false)
    })
  }
)

it('retires published parent membership after an engine directory move without a watcher echo', async () => {
  const root = 'Container/Shared'
  const path = root + '/Fresh'
  const app = buildFakeVault([])
  await app.vault.adapter.mkdir(root)
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  app.vault.adapter.rename = async (from, to) => {
    const entry = app.vault.getAbstractFileByPath(from)
    if (entry && 'children' in entry) await app.vault.rename(entry, to)
    else await rename(from, to)
  }
  const fs = new ObsidianFileSystem(app as never, { fileScope: root })
  await fs[Symbol.for('abele.sync.inventory-pass-v1')](async () => {
    await fs[Symbol.for('abele.sync.inventory-directories-v1')]()
    await fs.writeAtomic(path + '/sample.md', new TextEncoder().encode('sample'), 1000)
    await fs.moveDirectory(path, root + '/Moved')
    const children = await fs[Symbol.for('abele.sync.inventory-children-v1')](
      root,
      root + '/next.md'
    )
    expect(children.some((one) => one.path === path)).toBe(false)
    expect(children.some((one) => one.path === root + '/Moved')).toBe(true)
  })
})
