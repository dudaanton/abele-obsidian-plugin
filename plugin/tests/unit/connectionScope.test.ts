import { expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { connectionAdapter, connectionInspectionApp } from '@/sync/connectionScope'
import { connectionPrivateRoot, CONNECTION_ROOT_SYMLINK } from '@/sync/connectionPaths'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { transferBudgetOf } from '@/sync/transferBudget'
import { externalCoordinationOf } from '@/sync/external/ObsidianExternalFileHost'
import { buildFakeVault } from '../helpers/fakeVault'
import { nativeOf } from '@/sync/nativeVaultFs'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

it.each(['../Private', 'Container/../Private', 'Container\\Private'])(
  'refuses a malformed bound root before the native symlink probe: %s',
  async (root) => {
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }))
    const raw = { getFullPath: (path: string) => '/sample-vault/' + path, fsPromises: { lstat } }
    const adapter = connectionAdapter(
      raw as unknown as DataAdapter,
      root,
      connectionPrivateRoot('sample')
    )
    await expect(Reflect.get(adapter, CONNECTION_ROOT_SYMLINK)()).rejects.toMatchObject({
      code: 'protocol',
    })
    expect(lstat).not.toHaveBeenCalled()
  }
)

it.each([
  { root: 'Container/Shared', existing: true },
  { root: 'Container/Shared', existing: false },
  { root: 'Container/é-folder'.normalize('NFD'), existing: true },
])(
  'receives a valid native folder root without widening its scope: $root, existing=$existing',
  async ({ root, existing }) => {
    const app = buildFakeVault(
      [
        { path: 'Private/secret.md', content: 'private' },
        ...(existing ? [{ path: root + '/kept.md', content: 'kept' }] : []),
      ],
      { sensitiveNames: true }
    )
    const raw = app.vault.adapter
    const lstat = vi.fn(async (full: string) => {
      const stat = await raw.stat(full.slice('/sample-vault/'.length))
      if (!stat) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return { isSymbolicLink: () => false, isDirectory: () => stat.type === 'folder' }
    })
    Object.assign(raw, {
      getFullPath: (path: string) => '/sample-vault/' + path,
      fsPromises: { lstat },
    })
    const adapter = connectionAdapter(raw, root, connectionPrivateRoot('sample'))
    const fs = new ObsidianFileSystem(app as never, {
      adapter,
      fileScope: root,
      connectionId: 'sample',
    })
    await expect(fs.mkdir(root)).resolves.toBeUndefined()
    await fs.mkdir(root + '/Empty')
    const paths = []
    for await (const directory of fs.listDirectories()) paths.push(directory.path)
    expect(paths).toEqual([root, root + '/Empty'])
    const files = []
    for await (const file of fs.list()) files.push(file.path)
    expect(files).toEqual(existing ? [root + '/kept.md'] : [])
    expect(() => Reflect.get(adapter, 'getFullPath')('Container')).toThrow(
      'outside this connection'
    )
    await expect(async () =>
      Reflect.get(adapter, 'fsPromises').lstat('/sample-vault/Container')
    ).rejects.toThrow('outside this connection')
    await expect(async () => adapter.readBinary('Private/secret.md')).rejects.toThrow(
      'outside this connection'
    )
    expect(await raw.read('Private/secret.md')).toBe('private')
  }
)

it.each(['Container', 'Container/Shared', 'Container/Shared/Linked'])(
  'still refuses a native folder reached through symlink %s',
  async (linked) => {
    const root = 'Container/Shared'
    const app = buildFakeVault([{ path: root + '/Linked/kept.md', content: 'kept' }])
    const raw = app.vault.adapter
    Object.assign(raw, {
      getFullPath: (path: string) => '/sample-vault/' + path,
      fsPromises: {
        lstat: async (full: string) => ({
          isSymbolicLink: () => full === '/sample-vault/' + linked,
        }),
      },
    })
    const read = vi.spyOn(raw, 'readBinary')
    const adapter = connectionAdapter(raw, root, connectionPrivateRoot('sample'))
    const fs = new ObsidianFileSystem(app as never, { adapter, fileScope: root })
    await expect(fs.mkdir(root + '/Linked/Empty')).rejects.toMatchObject({ code: 'conflict' })
    const paths = []
    for await (const directory of fs.listDirectories()) paths.push(directory.path)
    expect(paths).toEqual(linked === root + '/Linked' ? [root] : [])
    expect(read).not.toHaveBeenCalled()
    expect(await raw.exists(root + '/Linked/Empty')).toBe(false)
  }
)

it('allows only exact read-only control-file access outside the folder', async () => {
  const app = buildFakeVault([])
  await app.vault.adapter.write('.abele-sync-ignore', 'Shared/excluded.md\n')
  const adapter = connectionAdapter(app.vault.adapter, 'Shared', connectionPrivateRoot('sample'))
  expect(await adapter.exists('.abele-sync-ignore')).toBe(true)
  expect(new TextDecoder().decode(await adapter.readBinary('.abele-sync-ignore'))).toBe(
    'Shared/excluded.md\n'
  )
  for (const path of ['.abele-sync-ignore-other', '.ABELE-SYNC-IGNORE', './.abele-sync-ignore'])
    expect(() => adapter.readBinary(path)).toThrow()
  expect(() => adapter.list('.abele-sync-ignore')).toThrow('outside')
  expect(() => adapter.list('')).toThrow('outside')
  expect(() => adapter.write('.abele-sync-ignore', '')).toThrow('outside')
  expect(() => adapter.remove('.abele-sync-ignore')).toThrow('outside')
  expect(() => adapter.rename('.abele-sync-ignore', 'Shared/settings.md')).toThrow('outside')
  expect(() => adapter.rename('Shared/settings.md', '.abele-sync-ignore')).toThrow('outside')
  expect(await app.vault.adapter.read('.abele-sync-ignore')).toBe('Shared/excluded.md\n')
})

it('keeps native backup recovery inside the connection namespace and preserves adapter queueing', async () => {
  const privateRoot = connectionPrivateRoot('sample')
  const mkdir = vi.fn(async () => {}),
    link = vi.fn(async () => {}),
    unlink = vi.fn(async () => {})
  const queue = vi.fn(async (work: () => Promise<void>) => work())
  const raw = {
    getFullPath: (path: string) => '/sample-vault/' + path,
    queue,
    fsPromises: { mkdir, link, unlink, stat: vi.fn(), rename: vi.fn(), rmdir: vi.fn() },
  }
  const adapter = connectionAdapter(raw as unknown as DataAdapter, 'Shared', privateRoot)
  const native = nativeOf(adapter, () => {}, privateRoot + '/recovery')!
  const archived = await native.archiveBackup!(privateRoot + '/writes/sample.old')
  expect(archived.startsWith('/sample-vault/' + privateRoot + '/recovery/')).toBe(true)
  expect(mkdir.mock.calls[0][0]).toBe('/sample-vault/' + privateRoot + '/recovery')
  expect(link).toHaveBeenCalledOnce()
  expect(unlink).toHaveBeenCalledOnce()
  await Reflect.get(adapter, 'queue')(async () => {})
  expect(queue).toHaveBeenCalledOnce()
})

it('keeps per-connection adapter instrumentation off the shared adapter', () => {
  const read = vi.fn(),
    replacement = vi.fn()
  const raw = { readBinary: read } as unknown as DataAdapter
  const scoped = connectionAdapter(raw, 'Shared', connectionPrivateRoot('sample'))
  Object.defineProperty(scoped, 'readBinary', { value: replacement, configurable: true })
  expect(raw.readBinary).toBe(read)
  expect(() => scoped.readBinary('Private/secret.md')).toThrow('outside')
  expect(replacement).not.toHaveBeenCalled()
})

it.each([
  'Private/secret.md',
  'Shared2/secret.md',
  'Shared/../Private/secret.md',
  '.abele-sync/connections/other/placement-inbox/sample',
])('refuses a direct adapter bypass before reading %s', async (path) => {
  const read = vi.fn(),
    futureRead = vi.fn()
  const adapter = connectionAdapter(
    { readBinary: read, futureRead } as unknown as DataAdapter,
    'Shared',
    connectionPrivateRoot('sample')
  )
  await expect(async () => adapter.readBinary(path)).rejects.toMatchObject({ code: 'protocol' })
  expect(() => Reflect.get(adapter, 'futureRead')('Shared/sample.md')).toThrow('no scope policy')
  expect(read).not.toHaveBeenCalled()
  expect(futureRead).not.toHaveBeenCalled()
})

it('checks both native operands and retains shared coordination through the inspection facade', async () => {
  const rename = vi.fn(async () => {}),
    readFile = vi.fn(async () => new Uint8Array())
  const raw = {
    getFullPath: (path: string) => '/sample-vault/' + path,
    fsPromises: { rename, readFile },
  }
  const adapter = connectionAdapter(
    raw as unknown as DataAdapter,
    'Shared',
    connectionPrivateRoot('sample')
  )
  const native = Reflect.get(adapter, 'fsPromises')
  await expect(async () =>
    native.rename('/sample-vault/Shared/sample.md', '/sample-vault/Private/secret.md')
  ).rejects.toThrow('outside')
  await expect(async () => native.readFile('/sample-vault/Private/secret.md')).rejects.toThrow(
    'outside'
  )
  expect(rename).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
  const app = buildFakeVault([])
  const scoped = connectionInspectionApp(
    app as never,
    adapter,
    'Shared',
    connectionPrivateRoot('sample')
  )
  expect(pathCoordinatorOf(scoped.vault)).toBe(pathCoordinatorOf(app.vault))
  expect(transferBudgetOf(scoped.vault)).toBe(transferBudgetOf(app.vault))
  expect(externalCoordinationOf(scoped.vault)).toBe(externalCoordinationOf(app.vault))
})

it.each([
  { event: 'rename', changed: 'Container/Shared' },
  { event: 'delete', changed: 'Container/Shared' },
  { event: 'rename', changed: 'Container' },
  { event: 'delete', changed: 'Container' },
] as const)(
  'reuses the bound root chain until $event of $changed invalidates it',
  async ({ event, changed }) => {
    const root = 'Container/Shared'
    const app = buildFakeVault([{ path: root + '/kept.md', content: 'kept' }])
    let linked = false
    const lstat = vi.fn(async (full: string) => ({
      isSymbolicLink: () => linked && full === '/sample-vault/' + root,
      isDirectory: () => true,
    }))
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => '/sample-vault/' + path,
      fsPromises: { lstat },
    })
    const adapter = connectionAdapter(app.vault.adapter, root, connectionPrivateRoot('sample'))
    const probe = vi.fn(Reflect.get(adapter, CONNECTION_ROOT_SYMLINK) as () => Promise<boolean>)
    const observed = new Proxy(adapter, {
      get(target, key) {
        return key === CONNECTION_ROOT_SYMLINK ? probe : Reflect.get(target, key)
      },
    })
    const fs = new ObsidianFileSystem(app as never, { adapter: observed, fileScope: root })
    const stop = fs.watch(() => {})
    try {
      await fs.mkdir(root + '/One')
      await fs.mkdir(root + '/Two')
      // Per-effect native chain guards remain active; only this bound metadata proof is cached.
      expect(probe).toHaveBeenCalledTimes(1)
      app.emit(
        'vault',
        event,
        { path: event === 'rename' ? 'Container/Moved' : changed, children: [] },
        changed
      )
      linked = true
      await expect(fs.mkdir(root + '/Three')).rejects.toMatchObject({ code: 'conflict' })
    } finally {
      stop()
    }
  }
)

it.each(['Moved/Shared', 'Cafe\u0301/Shared'])(
  'revalidates the new root chain after explicitly rebinding placement to %s',
  async (destination) => {
    let root = 'Container/Shared'
    const app = buildFakeVault([{ path: root + '/kept.md', content: 'kept' }])
    const lstat = vi.fn(async (full: string) => ({
      isSymbolicLink: () => full === '/sample-vault/' + destination.split('/')[0],
      isDirectory: () => true,
    }))
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => '/sample-vault/' + path,
      fsPromises: { lstat },
    })
    const adapter = connectionAdapter(
      app.vault.adapter,
      () => root,
      connectionPrivateRoot('sample')
    )
    const probe = vi.fn(Reflect.get(adapter, CONNECTION_ROOT_SYMLINK) as () => Promise<boolean>)
    const observed = new Proxy(adapter, {
      get(target, key) {
        return key === CONNECTION_ROOT_SYMLINK ? probe : Reflect.get(target, key)
      },
    })
    const fs = new ObsidianFileSystem(app as never, { adapter: observed, fileScope: () => root })
    expect((await Array.fromAsync(fs.listDirectories())).map((item) => item.path)).toEqual([root])
    expect(probe).toHaveBeenCalledTimes(1)
    root = destination
    lstat.mockClear()
    expect(await Array.fromAsync(fs.listDirectories())).toEqual([])
    expect(probe).toHaveBeenCalledTimes(2)
    expect(lstat).toHaveBeenCalledWith('/sample-vault/' + destination.split('/')[0])
    await expect(fs.mkdir(destination + '/Blocked')).rejects.toMatchObject({ code: 'conflict' })
    expect(() => Reflect.get(adapter, 'getFullPath')('Container/Shared')).toThrow(
      'outside this connection'
    )
  }
)
