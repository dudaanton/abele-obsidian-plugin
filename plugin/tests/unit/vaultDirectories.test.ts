import { expect, it } from 'vitest'
import { VaultDirectories } from '@/sync/vaultDirectories'

it('preserves directory identity across rename/reload and removes only empty directories', async () => {
  const records = new Map<string, unknown>(),
    directories = new Map([['Shared', { type: 'folder' as const, ctime: 1, mtime: 2, size: 0 }]])
  const files = new Set(['Shared/sample.md'])
  const port = {
    stat: async (path: string) => directories.get(path) ?? null,
    list: async (path: string) => ({
      files: [...files].filter((one) => one.startsWith(path + '/')),
      folders: [...directories.keys()].filter((one) =>
        path === '' ? !one.includes('/') : one.startsWith(path + '/')
      ),
    }),
    mkdir: async (path: string) => {
      directories.set(path, { type: 'folder', ctime: 3, mtime: 4, size: 0 })
    },
    rename: async (from: string, to: string) => {
      directories.set(to, directories.get(from)!)
      directories.delete(from)
      for (const p of [...files])
        if (p.startsWith(from + '/')) {
          files.delete(p)
          files.add(to + p.slice(from.length))
        }
    },
    rmdir: async (path: string) => {
      directories.delete(path)
    },
  }
  const storage = {
    loadLocalStorage: (key: string) => records.get(key),
    saveLocalStorage: (key: string, value: unknown) => {
      records.set(key, value)
    },
  }
  const a = new VaultDirectories(port, storage)
  const list = async (one: VaultDirectories) => {
    const result = []
    for await (const dir of one.list()) result.push(dir)
    return result
  }
  const [before] = await list(a)
  await a.move('Shared', 'Moved')
  const b = new VaultDirectories(port, storage)
  expect((await list(b))[0].identity).toBe(before.identity)
  await expect(b.remove('Moved')).rejects.toThrow(/empty/)
  expect(files.has('Moved/sample.md')).toBe(true)
  files.clear()
  await b.remove('Moved')
  expect(await list(b)).toEqual([])
})

it('keeps native folder rename identity even when sibling birth times are equal', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
  const app = buildFakeVault([
    { path: 'Shared/a.md', content: 'a' },
    { path: 'Other/b.md', content: 'b' },
  ])
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  app.vault.adapter.stat = async (path) => {
    const value = await stat(path)
    return value?.type === 'folder' ? { ...value, ctime: 7 } : value
  }
  const fs = new ObsidianFileSystem(app as unknown as import('obsidian').App)
  const list = async () => {
    const result = []
    for await (const one of fs.listDirectories()) result.push(one)
    return result
  }
  const before = (await list()).find((one) => one.path === 'Shared')!
  const stop = fs.watch(() => {})
  try {
    const folder = app.vault.getAbstractFileByPath('Shared')!
    await app.vault.rename(folder, 'Moved')
    app.emit('vault', 'rename', folder, 'Shared')
    expect((await list()).find((one) => one.path === 'Moved')?.identity).toBe(before.identity)
  } finally {
    stop()
  }
})
