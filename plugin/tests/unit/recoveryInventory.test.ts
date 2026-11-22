import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

it('does not follow a linked ancestor of connection-private recovery storage', async () => {
  const privateRoot = connectionPrivateRoot('sample')
  const app = buildFakeVault([
    { path: 'Local/safe.bin', content: 'safe' },
    { path: privateRoot + '/outside.bin', content: 'outside' },
  ])
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => '/sample/' + path,
    fsPromises: {
      lstat: async (path: string) => ({ isSymbolicLink: () => path === '/sample/.abele-sync' }),
    },
  })
  const listing = vi.spyOn(app.vault.adapter, 'list')
  const fs = new ObsidianFileSystem(app as never, {
    adapter: connectionAdapter(app.vault.adapter, 'Local', privateRoot),
    fileScope: 'Local',
    connectionId: 'sample',
  })
  expect((await Array.fromAsync(fs.listRecoveryFiles())).map((row) => row.path)).toEqual([
    'Local/safe.bin',
  ])
  expect(listing).not.toHaveBeenCalledWith(privateRoot)
})

it.each([false, true])(
  'inventories a connection root and its private storage through capabilities (native=%s)',
  async (native) => {
    const root = 'Container/Local'
    const privateRoot = connectionPrivateRoot('sample')
    const expected = [
      root + '/.hidden/copy.bin',
      root + '/ignored/copy.bin',
      privateRoot + '/saved.bin',
    ]
    const app = buildFakeVault(
      [...expected, 'Elsewhere/secret.bin', connectionPrivateRoot('other') + '/secret.bin'].map(
        (path) => ({ path, content: 'saved' })
      )
    )
    if (native)
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => '/sample/' + path,
        fsPromises: { lstat: async () => ({ isSymbolicLink: () => false }) },
      })
    const listing = vi.spyOn(app.vault.adapter, 'list')
    const raw = new ObsidianFileSystem(app as never, {
      adapter: connectionAdapter(app.vault.adapter as never, root, privateRoot),
      fileScope: root,
      connectionId: 'sample',
    })
    const includes = (path: string) => path === root || path.startsWith(root + '/')
    const scoped = scopedFileSystem(
      raw,
      (path) => {
        if (!includes(path)) throw new Error('outside scope')
      },
      includes,
      privateRoot,
      root
    )
    const fs = new LocalFolderPlacement('Shared', root).fileSystem(scoped)
    const rows = await Array.fromAsync(fs.listRecoveryFiles!())
    expect(rows.map((row) => row.path).sort()).toEqual(
      expected.map((path) => path.replace(root + '/', 'Shared/')).sort()
    )
    for (const row of rows) {
      expect(new TextDecoder().decode(await fs.read(row.path))).toBe('saved')
      expect((await fs.stat(row.path))?.path).toBe(row.path)
      const source = await fs.openRead!(row.path)
      try {
        expect(new TextDecoder().decode(await source.read(0, source.size))).toBe('saved')
      } finally {
        await source.close()
      }
    }
    await expect(fs.writeAtomic(privateRoot + '/saved.bin', new Uint8Array(), 1)).rejects.toThrow()
    await expect(fs.read(connectionPrivateRoot('other') + '/secret.bin')).rejects.toThrow()
    expect(listing).not.toHaveBeenCalledWith('')
    expect(listing).not.toHaveBeenCalledWith('Elsewhere')
  }
)

it.each([false, true])(
  'inventories a connection through its capability wrappers (native=%s)',
  async (native) => {
    const root = 'Container/Local'
    const privateRoot = connectionPrivateRoot('sample')
    const paths = [
      root + '/.hidden/copy.bin',
      root + '/ignored/copy.bin',
      privateRoot + '/saved.bin',
    ]
    const app = buildFakeVault(
      [...paths, 'Other/secret.bin', connectionPrivateRoot('other') + '/secret.bin'].map(
        (path) => ({ path, content: 'saved' })
      )
    )
    if (native)
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => '/sample/' + path,
        fsPromises: { lstat: async () => ({ isSymbolicLink: () => false }) },
      })
    const adapter = connectionAdapter(app.vault.adapter, root, privateRoot)
    const raw = new ObsidianFileSystem(app as never, {
      adapter,
      fileScope: root,
      connectionId: 'sample',
    })
    const includes = (path: string) => path === root || path.startsWith(root + '/')
    const scoped = scopedFileSystem(
      raw,
      (path) => {
        if (!includes(path)) throw new Error('outside scope')
      },
      includes,
      privateRoot,
      root
    )
    const fs = new LocalFolderPlacement('Remote', root).fileSystem(scoped)
    const rows = await Array.fromAsync(fs.listRecoveryFiles!())
    expect(rows.map((row) => row.path).sort()).toEqual(
      paths
        .map((path) => (path.startsWith(root + '/') ? 'Remote' + path.slice(root.length) : path))
        .sort()
    )
    for (const row of rows) expect(new TextDecoder().decode(await fs.read(row.path))).toBe('saved')
    await expect(fs.read(connectionPrivateRoot('other') + '/secret.bin')).rejects.toThrow()
    await expect(fs.writeAtomic(privateRoot + '/saved.bin', new Uint8Array(), 1)).rejects.toThrow()
  }
)

it.each([false, true])(
  'inventories hidden, ignored and private recovery bytes (mobile=%s)',
  async (mobile) => {
    const paths = [
      'visible.md',
      '.hidden/copy.bin',
      'ignored/copy.bin',
      '.abele-sync/private/copy.bin',
    ]
    const app = buildFakeVault(paths.map((path) => ({ path, content: 'saved' })))
    if (!mobile)
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => '/sample/' + path,
        fsPromises: { lstat: async () => ({ isSymbolicLink: () => false }) },
      })
    const fs = new ObsidianFileSystem(app as never)
    vi.spyOn(fs, 'list').mockImplementation(() => {
      throw new Error('filtered listing used')
    })
    expect((await Array.fromAsync(fs.listRecoveryFiles())).map((row) => row.path).sort()).toEqual(
      paths.sort()
    )
  }
)

it('does not follow linked files or directories during recovery inventory', async () => {
  const app = buildFakeVault([
    { path: 'safe.md', content: 'safe' },
    { path: 'linked/secret.md', content: 'outside' },
    { path: 'alias.md', content: 'outside' },
  ])
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => '/sample/' + path,
    fsPromises: {
      lstat: async (path: string) => ({
        isSymbolicLink: () => ['/sample/linked', '/sample/alias.md'].includes(path),
      }),
    },
  })
  const list = vi.spyOn(app.vault.adapter, 'list')
  const fs = new ObsidianFileSystem(app as never)
  expect((await Array.fromAsync(fs.listRecoveryFiles())).map((row) => row.path)).toEqual([
    'safe.md',
  ])
  expect(list).not.toHaveBeenCalledWith('linked')
})

it('fails rather than proving absence from an incomplete recovery inventory', async () => {
  const app = buildFakeVault([{ path: '.hidden/copy.bin', content: 'saved' }])
  const list = app.vault.adapter.list.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'list').mockImplementation(async (path) => {
    if (path === '.hidden') throw new Error('unreadable')
    return list(path)
  })
  const fs = new ObsidianFileSystem(app as never)
  await expect(Array.fromAsync(fs.listRecoveryFiles())).rejects.toThrow('unreadable')
})

it('rejects an adapter listing that escapes its directory', async () => {
  const app = buildFakeVault([])
  vi.spyOn(app.vault.adapter, 'list').mockResolvedValue({ files: ['../outside.bin'], folders: [] })
  const fs = new ObsidianFileSystem(app as never)
  await expect(Array.fromAsync(fs.listRecoveryFiles())).rejects.toThrow()
})
