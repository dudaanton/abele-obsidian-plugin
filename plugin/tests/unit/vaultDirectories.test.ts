import { expect, it, vi } from 'vitest'
import { VaultDirectories } from '@/sync/vaultDirectories'

it('starts directory discovery at the scoped root rather than filtering a vault-wide walk', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
  const app = buildFakeVault([
    { path: 'Shared/sub/sample.md', content: 'sample' },
    { path: 'Private/secret.md', content: 'private' },
  ])
  const list = vi.spyOn(app.vault.adapter, 'list')
  const fs = new ObsidianFileSystem(app as never, {
    fileScope: 'Shared',
    preserveEmptyDirectories: true,
  })
  const paths = []
  for await (const entry of fs.listDirectories()) paths.push(entry.path)
  expect(paths).toEqual(['Shared', 'Shared/sub'])
  expect(list.mock.calls.map(([path]) => path)).toEqual(['Shared', 'Shared/sub'])
})

it('does not inspect foreign configuration folders while watching a scoped folder', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
  const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'sample' }])
  await app.vault.adapter.write('.abele-sync-ignore', 'Shared/first.md\n')
  const list = vi.spyOn(app.vault.adapter, 'list'),
    stat = vi.spyOn(app.vault.adapter, 'stat')
  const fs = new ObsidianFileSystem(app as never, { fileScope: 'Shared' })
  const notify = vi.fn()
  const stop = fs.watch(notify)
  try {
    fs.kick()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(list).not.toHaveBeenCalled()
    expect(stat).toHaveBeenCalled()
    expect(new Set(stat.mock.calls.map(([path]) => path))).toEqual(new Set(['.abele-sync-ignore']))
    await app.vault.adapter.write('.abele-sync-ignore', 'Shared/another-file.md\n')
    fs.kick()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(['.abele-sync-ignore']))
    expect(list).not.toHaveBeenCalled()
    expect(new Set(stat.mock.calls.map(([path]) => path))).toEqual(new Set(['.abele-sync-ignore']))
  } finally {
    stop()
  }
})

it('stops scoped recovery before touching a foreign write journal entry', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
  const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'sample' }])
  app.saveLocalStorage('abele-sync-writes', [
    { target: 'Private/secret.md', temp: 'Private/temp.md' },
  ])
  const stat = vi.spyOn(app.vault.adapter, 'stat'),
    remove = vi.spyOn(app.vault.adapter, 'remove')
  const fs = new ObsidianFileSystem(app as never, { fileScope: 'Shared' })
  await expect(fs.recover()).rejects.toThrow(/outside this connection/)
  expect(stat).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})

it('scopes the directory walk and retains foreign pending removals without touching them', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
  const app = buildFakeVault([{ path: 'Shared/sample.md', content: 'sample' }])
  await app.vault.createFolder('Private')
  const birth = (await app.vault.adapter.stat('Private'))!.ctime
  const pending = [{ path: 'Private', birth, files: [] }]
  app.saveLocalStorage('abele-sync-empty-directory-removals-v1', pending)
  const list = vi.spyOn(app.vault.adapter, 'list'),
    stat = vi.spyOn(app.vault.adapter, 'stat')
  const remove = vi.spyOn(app.vault.adapter, 'rmdir')
  const fs = new ObsidianFileSystem(app as never, {
    fileScope: 'Shared',
    preserveEmptyDirectories: true,
  })
  const paths = []
  for await (const entry of fs.listDirectories()) paths.push(entry.path)
  expect(paths).toEqual(['Shared'])
  expect(list.mock.calls.every(([path]) => path === 'Shared' || path.startsWith('Shared/'))).toBe(
    true
  )
  expect(stat.mock.calls.some(([path]) => path === 'Private')).toBe(false)
  expect(remove).not.toHaveBeenCalled()
  expect(app.loadLocalStorage('abele-sync-empty-directory-removals-v1')).toEqual(pending)
})

it.each(['local delete', 'empty child', 'missing', 'recreated', 'new content'])(
  'reconciles pending directory removal on a scan: %s',
  async (change) => {
    const dirs = new Map([
      ['A', 1],
      ['A/child', 2],
    ])
    const files = new Set(['A/child/file.md'])
    const saved = new Map<string, unknown>()
    const children = (path: string) => ({
      files: [...files].filter((p) => p.slice(0, p.lastIndexOf('/')) === path),
      folders: [...dirs.keys()].filter((p) =>
        p.includes('/') ? p.slice(0, p.lastIndexOf('/')) === path : path === ''
      ),
    })
    const removed: string[] = []
    const port = {
      stat: async (path: string) =>
        dirs.has(path) ? { type: 'folder', ctime: dirs.get(path)!, mtime: 1, size: 0 } : null,
      list: async (path: string) => children(path),
      mkdir: async () => {},
      rename: async () => {},
      rmdir: async (path: string, recursive: boolean) => {
        expect(recursive).toBe(false)
        expect(children(path)).toEqual({ files: [], folders: [] })
        removed.push(path)
        dirs.delete(path)
      },
    }
    const storage = {
      loadLocalStorage: (key: string) => saved.get(key),
      saveLocalStorage: (key: string, value: unknown) => {
        saved.set(key, value)
      },
    }
    const folders = new VaultDirectories(port, storage)
    await expect(folders.remove('A')).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    if (change !== 'new content') files.clear()
    if (change === 'empty child') await folders.remove('A/child')
    if (change === 'missing') dirs.clear()
    if (change === 'recreated') dirs.set('A', 3)
    if (change === 'new content') files.add('A/new.md')
    const reloaded = new VaultDirectories(port, storage)
    const published = []
    for await (const dir of reloaded.list()) published.push(dir.path)
    expect(saved.get('abele-sync-empty-directory-removals-v1')).toEqual([])
    if (change === 'recreated' || change === 'new content') {
      expect(dirs.has('A')).toBe(true)
      expect(published).toContain('A')
      expect(removed).not.toContain('A')
    } else {
      expect(dirs.has('A')).toBe(false)
      expect(published).not.toContain('A')
      if (change === 'local delete') expect(removed).toEqual(['A/child', 'A'])
    }
    if (change === 'new content') expect(files.has('A/new.md')).toBe(true)
  }
)

it.each(['delete', 'move'])(
  'finishes a deferred remote folder removal after a later child %s',
  async (operation) => {
    const { buildFakeVault } = await import('../helpers/fakeVault')
    const { ObsidianFileSystem } = await import('@/sync/ObsidianFileSystem')
    const app = buildFakeVault([{ path: 'Shared/from/sample.md', content: 'sample' }])
    const rmdir = app.vault.adapter.rmdir.bind(app.vault.adapter)
    app.vault.adapter.rmdir = async (path, recursive) => {
      expect(recursive).toBe(false)
      expect(await app.vault.adapter.list(path)).toEqual({ files: [], folders: [] })
      await rmdir(path, true) // Fake adapter models desktop rmdir(false) as EISDIR.
    }
    const fs = new ObsidianFileSystem(app as never, { preserveEmptyDirectories: true })
    await app.vault.rename(app.vault.getAbstractFileByPath('Shared/from')!, 'Shared/to')
    // A directory departure may be processed while its tracked child is still held.
    await expect(fs.removeDirectory('Shared/to')).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    const reloaded = new ObsidianFileSystem(app as never, { preserveEmptyDirectories: true })
    const advertised = []
    for await (const dir of reloaded.listDirectories()) advertised.push(dir.path)
    expect(advertised).not.toContain('Shared/to')
    expect(await app.vault.adapter.read('Shared/to/sample.md')).toBe('sample')
    if (operation === 'delete') await reloaded.remove('Shared/to/sample.md')
    else await reloaded.move('Shared/to/sample.md', 'Shared/kept.md')
    expect(await app.vault.adapter.exists('Shared/to')).toBe(false)
    expect(await app.vault.adapter.exists('Shared')).toBe(true)
  }
)

it('uses native nonrecursive directory removal instead of Obsidian rmdir(false), which raises EISDIR', async () => {
  const removeEmpty = vi.fn(async (_path: string) => {})
  const adapter = {
    stat: async () => ({ type: 'folder', ctime: 1, mtime: 1, size: 0 }),
    list: async () => ({ files: [], folders: [] }),
    mkdir: async () => {},
    rename: async () => {},
    rmdir: async () => {
      throw new Error('EISDIR')
    },
  }
  const storage = { loadLocalStorage: () => [], saveLocalStorage: () => {} }
  const folders = new VaultDirectories(adapter, storage, async () => false, removeEmpty)
  await folders.remove('moved')
  expect(removeEmpty).toHaveBeenCalledWith('moved')
})

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
  await expect(b.remove('Moved')).rejects.toMatchObject({ code: 'ENOTEMPTY' })
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
