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
          await expect(verifyMetadataInventory({ adapter: disk })).rejects.toThrow()
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
