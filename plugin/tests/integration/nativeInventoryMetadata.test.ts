// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  guardedVaultAdapter,
  withMetadataInventory,
  verifyMetadataInventory,
  connectionAdapter,
  nativeOf,
} from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'

it.each(['create', 'rename'] as const)(
  'keeps the pinned vault usable after an ordinary directory %s during inventory',
  async (change) => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'sample-directory-change-')))
    const app = buildFakeVault([])
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: fs,
    })
    try {
      await fs.mkdir(join(root, 'Shared'))
      await fs.mkdir(join(root, 'Shared/Old'))
      await fs.writeFile(join(root, 'Shared/Old/sample.md'), 'sample')
      const adapter = guardedVaultAdapter(app.vault.adapter)
      const native = nativeOf(adapter)!
      await withMetadataInventory({ adapter }, async () => {
        if (change === 'create') {
          expect(await adapter.stat('Shared/New/sample.md')).toBeNull()
          await fs.mkdir(join(root, 'Shared/New'))
          await fs.writeFile(join(root, 'Shared/New/sample.md'), 'new sample')
        } else {
          expect(await native.fileIdentity!('Shared/Old/sample.md')).toBeTruthy()
          await fs.rename(join(root, 'Shared/Old'), join(root, 'Shared/Renamed'))
        }
        await expect(verifyMetadataInventory({ adapter })).resolves.toBeUndefined()
        expect(await native.fileIdentity!(
          change === 'create' ? 'Shared/New/sample.md' : 'Shared/Renamed/sample.md'
        )).toBeTruthy()
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

it.each(['inventory', 'operation'] as const)(
  'shares advisory ancestor checks per directory, keeps leaf checks fresh and fences replaced parents (%s)',
  async (mode) => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'sample-inventory-')))
    const app = buildFakeVault([])
    const lstat = vi.fn((path: string) => fs.lstat(path))
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: { ...fs, lstat },
    })
    try {
      await fs.mkdir(join(root, 'Shared/sub'), { recursive: true })
      await fs.writeFile(join(root, 'Shared/sub/sample.md'), 'first')
      const disk = guardedVaultAdapter(app.vault.adapter)
      let fenced = false
      try {
        const filesystem = new ObsidianFileSystem(app as never)
        const run =
          mode === 'inventory'
            ? (work: () => Promise<void>) => withMetadataInventory({ adapter: disk }, work)
            : (work: () => Promise<void>) =>
                Reflect.get(filesystem, Symbol.for('abele.sync.operation-pass-v1')).call(
                  filesystem,
                  work
                )
        await run(async () => {
          for (let i = 0; i < 100; i++) await disk.stat('Shared/sub/sample.md')
          expect(
            lstat.mock.calls.filter(([path]) => path === join(root, 'Shared/sub'))
          ).toHaveLength(1)
          expect(
            lstat.mock.calls.filter(([path]) => path === join(root, 'Shared/sub/sample.md'))
          ).toHaveLength(100)
          await fs.writeFile(join(root, 'Shared/sub/sample.md'), 'changed bytes')
          expect((await disk.stat('Shared/sub/sample.md'))?.size).toBe(13)
          await verifyMetadataInventory({ adapter: disk })
          await fs.rename(join(root, 'Shared/sub'), join(root, 'Shared/retained'))
          await fs.mkdir(join(root, 'Shared/sub'))
          const verification = verifyMetadataInventory({ adapter: disk })
          await expect(verification).rejects.toThrow()
          await expect(verification).rejects.toMatchObject({
            code: 'vault-root-changed',
            cause: { message: 'Advisory ancestor identity changed: Shared/sub' },
          })
          fenced = true
        })
      } catch (error) {
        if (!fenced) throw error
      }
      expect(fenced).toBe(true)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

it('shares advisory ancestor checks for connection-scoped native identities', async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'sample-scoped-inventory-')))
  const app = buildFakeVault([])
  const lstat = vi.fn((...args: Parameters<typeof fs.lstat>) => fs.lstat(...args))
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => join(root, path),
    fsPromises: { ...fs, lstat },
  })
  try {
    await fs.mkdir(join(root, 'Shared/sub'), { recursive: true })
    await fs.writeFile(join(root, 'Shared/sub/sample.md'), 'first')
    const adapter = connectionAdapter(app.vault.adapter, 'Shared', '.obsidian/sample-private')
    await expect(
      withMetadataInventory(app.vault, async () => {
        for (let i = 0; i < 100; i++)
          expect(await nativeOf(adapter)!.fileIdentity!('Shared/sub/sample.md')).toBeTruthy()
        expect(lstat.mock.calls.filter(([path]) => path === join(root, 'Shared/sub'))).toHaveLength(
          1
        )
        await fs.rename(join(root, 'Shared/sub'), join(root, 'Shared/saved'))
        await fs.symlink(join(root, 'Shared/saved'), join(root, 'Shared/sub'))
        await expect(verifyMetadataInventory(app.vault)).rejects.toThrow()
        await expect(adapter.read('Shared/sub/sample.md')).rejects.toThrow()
      })
    ).rejects.toThrow(/root changed|symbolic link/i)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it('keeps trusted indexed rows unchanged while native identity is read during inventory', async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'sample-read-inventory-')))
  const app = buildFakeVault([{ path: 'Shared/sample.md' }])
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  Object.assign(app.workspace, { layoutReady: true })
  Object.assign(app.vault.adapter, {
    getFullPath: (path: string) => join(root, path),
    fsPromises: fs,
  })
  try {
    await fs.mkdir(join(root, 'Shared'))
    await fs.writeFile(join(root, 'Shared/sample.md'), 'sample')
    const filesystem = new ObsidianFileSystem(app as never, {
      fileScope: 'Shared', prepareStartupInventory: async () => {},
    })
    const inventory = Reflect.get(filesystem, Symbol.for('abele.sync.inventory-pass-v1')) as
      (work: () => Promise<void>) => Promise<void>
    await inventory.call(filesystem, async () => {
      const native = Reflect.get(filesystem, 'native') as ReturnType<typeof nativeOf>
      const reason = Reflect.get(filesystem, Symbol.for('abele.sync.unchanged-index-reason-v1')) as
        (path: string) => string
      expect(reason.call(filesystem, 'Shared/sample.md')).toBe('hit')
      expect(await native!.fileIdentity!('Shared/sample.md')).toBeTruthy()
      expect(await native!.fileContentRevision!('Shared/sample.md')).toBeTruthy()
      expect((Reflect.get(filesystem, 'inventory') as { mutations: Set<string> }).mutations.size).toBe(0)
      expect(reason.call(filesystem, 'Shared/sample.md')).toBe('hit')
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
