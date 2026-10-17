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
    { owner: 'sample', target: 'Private/secret.md', temp: 'Private/temp.md' },
  ])
  const stat = vi.spyOn(app.vault.adapter, 'stat'),
    remove = vi.spyOn(app.vault.adapter, 'remove')
  const fs = new ObsidianFileSystem(app as never, { fileScope: 'Shared', journalOwner: 'sample' })
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

it('refuses directory cleanup when the retained spelling now has a different identity', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const app = buildFakeVault([], { sensitiveNames: true })
  const path = 'й-empty'.normalize('NFD')
  await app.vault.adapter.mkdir(path)
  const dirs = new VaultDirectories(app.vault.adapter, app)
  const identity = await dirs.identity(path)
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  app.vault.adapter.stat = async (path) => {
    const value = await stat(path)
    return value ? { ...value, ctime: value.ctime + 1 } : null
  }
  const remove = vi.spyOn(app.vault.adapter, 'rmdir')
  await expect(dirs.remove(path, identity)).rejects.toMatchObject({ code: 'conflict' })
  expect(remove).not.toHaveBeenCalled()
  expect(await app.vault.adapter.exists(path)).toBe(true)
})

it('matches normalized child notifications while removing only the retained physical folder', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const path = 'й-folder/ё-note.md'.normalize('NFD')
  const folder = path.slice(0, path.lastIndexOf('/'))
  const app = buildFakeVault([{ path, content: 'retained' }], { sensitiveNames: true })
  const rmdir = app.vault.adapter.rmdir.bind(app.vault.adapter)
  app.vault.adapter.rmdir = async (path, recursive) => {
    expect(recursive).toBe(false)
    expect(await app.vault.adapter.list(path)).toEqual({ files: [], folders: [] })
    await rmdir(path, true)
  }
  const dirs = new VaultDirectories(app.vault.adapter, app)
  await expect(dirs.remove(folder)).rejects.toMatchObject({ code: 'ENOTEMPTY' })
  await app.vault.adapter.remove(path)
  await dirs.removedChild(path.normalize('NFC'))
  expect(await app.vault.adapter.exists(folder)).toBe(false)
})

it('recovers an offline normalization rename with equal sibling birth times without conflating twins', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const original = 'й-folder'.normalize('NFD')
  const app = buildFakeVault(
    [
      { path: original + '/one.md', content: 'one' },
      { path: 'Other/two.md', content: 'two' },
    ],
    { sensitiveNames: true }
  )
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  app.vault.adapter.stat = async (path) => {
    const value = await stat(path)
    return value?.type === 'folder' ? { ...value, ctime: 7 } : value
  }
  const list = async () => {
    const result = []
    for await (const dir of new VaultDirectories(app.vault.adapter, app).list()) result.push(dir)
    return result
  }
  const before = (await list()).find((one) => one.path === original)!
  await app.vault.rename(app.vault.getAbstractFileByPath(original)!, original.normalize('NFC'))
  expect((await list()).find((one) => one.path === original.normalize('NFC'))?.identity).toBe(
    before.identity
  )
  await app.vault.adapter.mkdir(original)
  const twins = (await list()).filter(
    (one) => one.path.normalize('NFC') === original.normalize('NFC')
  )
  expect(new Set(twins.map((one) => one.identity)).size).toBe(2)
})

it('scans only selected roots and preserves other roots identities and pending removals', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const app = buildFakeVault([
    { path: 'Shared/child/note.md', content: 'shared' },
    { path: 'Private/child/note.md', content: 'private' },
  ])
  const all = new VaultDirectories(app.vault.adapter, app)
  for await (const _directory of all.list()) {
    /* establish durable identities */
  }
  await expect(all.remove('Private')).rejects.toMatchObject({ code: 'ENOTEMPTY' })
  const before = app.loadLocalStorage('abele-sync-local-directories-v1') as { path: string }[]
  const pending = app.loadLocalStorage('abele-sync-empty-directory-removals-v1')
  const list = vi.spyOn(app.vault.adapter, 'list')
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const scoped = new VaultDirectories(app.vault.adapter, app, undefined, undefined, ['Shared'])
  const paths: string[] = []
  for await (const directory of scoped.list()) paths.push(directory.path)
  expect(paths).toEqual(['Shared', 'Shared/child'])
  expect(list.mock.calls.map(([path]) => path)).toEqual(['Shared', 'Shared/child'])
  expect(stat.mock.calls.every(([path]) => path === 'Shared' || path.startsWith('Shared/'))).toBe(
    true
  )
  const after = app.loadLocalStorage('abele-sync-local-directories-v1') as { path: string }[]
  expect(after.filter((record) => record.path.startsWith('Private'))).toEqual(
    before.filter((record) => record.path.startsWith('Private'))
  )
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

it('keeps folders under a symlinked ancestor out of the inventory and refuses effects there', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const app = buildFakeVault([{ path: 'Plain/note.md', content: 'sample' }])
  await app.vault.adapter.mkdir('Linked')
  await app.vault.adapter.mkdir('Linked/Empty')
  await app.vault.adapter.mkdir('Plain/Kept')
  // `Linked` points outside the vault: nothing below it is the vault's to publish or remove.
  const dirs = new VaultDirectories(app.vault.adapter, app, async (path) => path === 'Linked')
  const listed = []
  for await (const one of dirs.list(['Linked', 'Linked/Empty', 'Plain', 'Plain/Kept']))
    listed.push(one.path)
  expect(listed.sort()).toEqual(['Plain', 'Plain/Kept'])
  const rmdir = vi.spyOn(app.vault.adapter, 'rmdir')
  const mkdir = vi.spyOn(app.vault.adapter, 'mkdir')
  const rename = vi.spyOn(app.vault.adapter, 'rename')
  await expect(dirs.remove('Linked/Empty')).rejects.toMatchObject({ code: 'conflict' })
  await expect(dirs.identity('Linked/Empty')).rejects.toMatchObject({ code: 'io' })
  await expect(dirs.mkdir('Linked/New')).rejects.toMatchObject({ code: 'conflict' })
  await expect(dirs.mkdir('Linked/Empty')).rejects.toMatchObject({ code: 'conflict' })
  await expect(dirs.move('Linked/Empty', 'Plain/Moved')).rejects.toMatchObject({
    code: 'conflict',
  })
  await expect(dirs.move('Plain/Kept', 'Linked/Moved')).rejects.toMatchObject({
    code: 'conflict',
  })
  expect(rmdir).not.toHaveBeenCalled()
  expect(mkdir).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
  expect(await app.vault.adapter.exists('Linked/Empty')).toBe(true)
})

it('keeps a received folder Obsidian has not indexed yet in the inventory and removes it by identity', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const app = buildFakeVault([{ path: 'Plain/note.md', content: 'sample' }])
  await app.vault.adapter.mkdir('Received')
  // The fake adapter's rmdir is recursive-only; the folder is empty, as the real removal requires.
  const dirs = new VaultDirectories(
    app.vault.adapter,
    app,
    async () => false,
    (path) => app.vault.adapter.rmdir(path, true)
  )
  const identity = await dirs.identity('Received')
  // The index lags behind the pull that created the folder: the indexed inventory omits it.
  const listed = []
  for await (const one of dirs.list(['Plain'])) listed.push(one)
  expect(listed).toContainEqual(expect.objectContaining({ path: 'Received', identity }))
  await dirs.remove('Received', identity)
  expect(await app.vault.adapter.exists('Received')).toBe(false)
})

it('a folder connection inventory leaves other connections’ folder identities alone without reading them', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const app = buildFakeVault([{ path: 'Shared/note.md', content: 'sample' }])
  await app.vault.adapter.mkdir('Elsewhere')
  const dirs = new VaultDirectories(app.vault.adapter, app)
  const elsewhere = await dirs.identity('Elsewhere')
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  const listed = []
  for await (const one of dirs.list(
    ['Shared'],
    (path) => path === 'Shared' || path.startsWith('Shared/')
  ))
    listed.push(one.path)
  expect(listed).toEqual(['Shared'])
  expect(stat.mock.calls.some(([path]) => path === 'Elsewhere')).toBe(false)
  stat.mockRestore()
  expect(await dirs.identity('Elsewhere')).toBe(elsewhere)
})

it('never brings a remembered folder back from a hidden place such as the trash', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const app = buildFakeVault([{ path: 'Plain/note.md', content: 'sample' }])
  const dirs = new VaultDirectories(app.vault.adapter, app)
  // Obsidian's own trash moves a deleted folder under a hidden folder, and the rename record
  // follows it there: the remembered identity now names a hidden path that still exists.
  await app.vault.adapter.mkdir('.trash')
  await app.vault.adapter.mkdir('.trash/Gone')
  await dirs.identity('.trash/Gone')
  const listed = []
  for await (const one of dirs.list(['Plain'])) listed.push(one.path)
  expect(listed).toEqual(['Plain'])
})
it.each(['list', 'mkdir', 'move-source', 'move-target', 'remove'])(
  'refuses a linked ancestor before directory %s',
  async (action) => {
    const { buildFakeVault } = await import('../helpers/fakeVault')
    const app = buildFakeVault([
      { path: 'Alias/Shared/sample.md', content: 'external' },
      { path: 'Safe/sample.md', content: 'local' },
    ])
    const port = app.vault.adapter
    const list = vi.spyOn(port, 'list')
    const rename = vi.spyOn(port, 'rename')
    const mkdir = vi.spyOn(port, 'mkdir')
    const remove = vi.spyOn(port, 'rmdir')
    const dirs = new VaultDirectories(port, app, async (path) => path === 'Alias', undefined, [
      'Alias/Shared',
    ])
    const operation =
      action === 'list'
        ? Array.fromAsync(dirs.list())
        : action === 'mkdir'
          ? dirs.mkdir('Alias/New')
          : action === 'move-source'
            ? dirs.move('Alias/Shared', 'New')
            : action === 'move-target'
              ? dirs.move('Safe', 'Alias/New')
              : dirs.remove('Alias/Shared')
    await expect(operation).rejects.toThrow(/symbolic link/i)
    expect(list).not.toHaveBeenCalled()
    expect(rename).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  }
)

it.each([{ roots: ['Shared'] }, { roots: [] }])(
  'preserves an empty pending removal owned by another scope (%j)',
  async ({ roots }) => {
    const { buildFakeVault } = await import('../helpers/fakeVault')
    const app = buildFakeVault([
      { path: 'Shared/sample.md', content: 'in scope' },
      { path: 'Outside/Empty/held.md', content: 'held' },
    ])
    const { withDesktopFs } = await import('../helpers/fakeDesktopFs')
    withDesktopFs(app)
    const native = Reflect.get(app.vault.adapter, 'fsPromises')
    const removeEmpty = (path: string) => native.rmdir('/vault/' + path)
    const owner = new VaultDirectories(app.vault.adapter, app, undefined, removeEmpty)
    await expect(owner.remove('Outside/Empty')).rejects.toMatchObject({ code: 'ENOTEMPTY' })
    await app.vault.adapter.remove('Outside/Empty/held.md')
    const key = 'abele-sync-empty-directory-removals-v1'
    const pending = app.loadLocalStorage(key)
    const before = await app.vault.adapter.stat('Outside/Empty')
    const stat = vi.spyOn(app.vault.adapter, 'stat')
    const list = vi.spyOn(app.vault.adapter, 'list')
    const remove = vi.spyOn(app.vault.adapter, 'rmdir')
    const scoped = new VaultDirectories(app.vault.adapter, app, undefined, removeEmpty, roots)
    await Array.fromAsync(scoped.list())
    await scoped.removedChild('Outside/Empty/held.md')
    expect(remove).not.toHaveBeenCalled()
    expect(
      [...stat.mock.calls, ...list.mock.calls].every(
        ([path]) => path === 'Shared' || path.startsWith('Shared/')
      )
    ).toBe(true)
    expect(app.loadLocalStorage(key)).toEqual(pending)
    expect(await app.vault.adapter.stat('Outside/Empty')).toEqual(before)
    // Only a scan including the owning path may complete this request.
    await Array.fromAsync(owner.list())
    expect(await app.vault.adapter.stat('Outside/Empty')).toBeNull()
  }
)
