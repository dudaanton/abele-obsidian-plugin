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
} from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'

it('shares advisory ancestor checks per directory, keeps leaf checks fresh and fences replaced parents', async () => {
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
      await withMetadataInventory({ adapter: disk }, async () => {
        for (let i = 0; i < 100; i++) await disk.stat('Shared/sub/sample.md')
        expect(lstat.mock.calls.filter(([path]) => path === join(root, 'Shared/sub'))).toHaveLength(
          1
        )
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
})
