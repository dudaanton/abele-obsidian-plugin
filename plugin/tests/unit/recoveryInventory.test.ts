import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

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
    const fs = new ObsidianFileSystem(app as never, { fileScope: () => 'scoped' })
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
