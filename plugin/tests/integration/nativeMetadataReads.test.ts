// @vitest-environment node
import '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DataAdapter } from 'obsidian'
import { expect, it } from 'vitest'
import { guardedVaultAdapter } from '@/sync/vaultPathLinks'

it('reads native metadata with one checked ancestor walk and no cached evidence', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-metadata-')))
  let calls = 0
  const adapter = guardedVaultAdapter({
    getFullPath: (path: string) => join(root, path),
    fsPromises: {
      ...disk,
      lstat: async (...args: Parameters<typeof disk.lstat>) => {
        calls++
        return disk.lstat(...args)
      },
    },
    stat: async () => {
      throw new Error('native metadata should not use adapter stat')
    },
    exists: async () => {
      throw new Error('native metadata should not use adapter exists')
    },
  } as unknown as DataAdapter)
  try {
    await disk.mkdir(join(root, 'Notes/Nested'), { recursive: true })
    await disk.writeFile(join(root, 'Notes/Nested/sample.md'), 'first')
    expect(await adapter.stat('')).toMatchObject({ type: 'folder' })
    await adapter.stat('Notes/Nested/sample.md')
    calls = 0
    expect(await adapter.stat('Notes/Nested/sample.md')).toMatchObject({ type: 'file', size: 5 })
    expect(calls).toBeLessThanOrEqual(5)
    await disk.writeFile(join(root, 'Notes/Nested/sample.md'), 'second version')
    expect(await adapter.stat('Notes/Nested/sample.md')).toMatchObject({ size: 14 })
    await disk.unlink(join(root, 'Notes/Nested/sample.md'))
    expect(await adapter.stat('Notes/Nested/sample.md')).toBeNull()
    expect(await adapter.exists('Notes/Nested/sample.md')).toBe(false)
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
})

it.each(['ancestor', 'leaf', 'traversal', 'root-during-read', 'queued-parent'] as const)(
  'refuses unsafe metadata after %s changes',
  async (mode) => {
    const scratch = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-metadata-')))
    const root = join(scratch, 'vault')
    await disk.mkdir(join(root, 'Notes'), { recursive: true })
    await disk.writeFile(join(root, 'Notes/sample.md'), 'kept')
    let armed = false
    const changeParent = async () => {
      await disk.rename(join(root, 'Notes'), join(root, 'Saved'))
      await disk.symlink(join(root, 'Saved'), join(root, 'Notes'))
    }
    const adapter = guardedVaultAdapter({
      getFullPath: (path: string) => join(root, path),
      fsPromises: {
        ...disk,
        lstat: async (...args: Parameters<typeof disk.lstat>) => {
          const stat = await disk.lstat(...args)
          if (armed && mode === 'root-during-read' && args[0] === join(root, 'Notes/sample.md')) {
            armed = false
            await disk.rename(root, join(scratch, 'retained'))
            await disk.mkdir(root)
          }
          return stat
        },
      },
      stat: async () => null,
      exists: async () => false,
      queue: async (work: () => Promise<unknown>) => {
        if (armed && mode === 'queued-parent') {
          armed = false
          await changeParent()
        }
        return work()
      },
    } as unknown as DataAdapter)
    try {
      await adapter.stat('Notes/sample.md')
      armed = true
      if (mode === 'ancestor') await changeParent()
      if (mode === 'leaf') {
        await disk.rename(join(root, 'Notes/sample.md'), join(root, 'Notes/saved.md'))
        await disk.symlink(join(root, 'Notes/saved.md'), join(root, 'Notes/sample.md'))
      }
      await expect(
        adapter.stat(mode === 'traversal' ? '../sample.md' : 'Notes/sample.md')
      ).rejects.toThrow()
      await expect(
        adapter.exists(mode === 'traversal' ? '../sample.md' : 'Notes/sample.md')
      ).rejects.toThrow()
      const kept =
        mode === 'root-during-read'
          ? join(scratch, 'retained/Notes/sample.md')
          : mode === 'leaf'
            ? join(root, 'Notes/saved.md')
            : mode === 'ancestor' || mode === 'queued-parent'
              ? join(root, 'Saved/sample.md')
              : join(root, 'Notes/sample.md')
      expect(await disk.readFile(kept, 'utf8')).toBe('kept')
    } finally {
      await disk.rm(scratch, { recursive: true, force: true })
    }
  }
)
