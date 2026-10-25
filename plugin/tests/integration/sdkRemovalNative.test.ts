// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it } from 'vitest'
import { promises as disk } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retainRemoval, recoverRemovals, retentionSnapshot } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { buildFakeVault } from '../helpers/fakeVault'

// Retention and recovery await real file/directory durability barriers. A busy
// disk can exceed the default budget even for this deliberately tiny fixture.
const nativeIoTimeout = 30_000

it.each(['missing', 'symlink'] as const)(
  'restores changed native retained bytes at the connection root after a %s parent',
  async (mode) => {
    const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-retained-')))
    try {
      await disk.mkdir(join(root, 'Shared/Nested'), { recursive: true })
      await disk.writeFile(join(root, 'Shared/Nested/sample.md'), 'old')
      await disk.writeFile(join(root, 'Shared/keep.md'), 'kept')
      await disk.utimes(join(root, 'Shared/Nested/sample.md'), 1, 1)
      const app = buildFakeVault(
        [{ path: 'Shared/Nested/sample.md', content: 'old', mtime: 1000 }],
        { sensitiveNames: true }
      )
      Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => join(root, path),
        fsPromises: disk,
        stat: async (path: string) => {
          try {
            const info = await disk.stat(join(root, path))
            return {
              type: info.isDirectory() ? 'folder' : 'file',
              size: info.size,
              mtime: info.mtimeMs,
              ctime: info.birthtimeMs,
            }
          } catch (error) {
            if ((error as { code?: string }).code === 'ENOENT') return null
            throw error
          }
        },
        list: async (path: string) => {
          const rows = await disk.readdir(join(root, path), { withFileTypes: true })
          return {
            files: rows
              .filter((x) => x.isFile())
              .map((x) => [path, x.name].filter(Boolean).join('/')),
            folders: rows
              .filter((x) => x.isDirectory())
              .map((x) => [path, x.name].filter(Boolean).join('/')),
          }
        },
      })
      const raw = new ObsidianFileSystem(app as never, {
        connectionId: 'sample-retention',
        fileScope: 'Shared',
      })
      const fs = new LocalFolderPlacement('Remote', 'Shared').fileSystem(raw)
      const expected = await raw.fingerprint('Shared/Nested/sample.md')
      const now = Date.now()
      expect(
        await retainRemoval(
          fs,
          { path: 'Remote/Nested/sample.md', expected, effect: { kind: 'remove' } },
          { now, clock: () => now }
        )
      ).toBe(true)
      const rows = await retentionSnapshot(fs)
      expect(rows).toHaveLength(1)
      expect(
        await disk.readFile(
          join(
            root,
            '.abele-sync/connections/sample-retention/retained-removals',
            rows[0].id,
            'victim'
          ),
          'utf8'
        )
      ).toBe('old')
      await disk.writeFile(
        join(
          root,
          '.abele-sync/connections/sample-retention/retained-removals',
          rows[0].id,
          'victim'
        ),
        'changed retained bytes'
      )
      await disk.rm(join(root, 'Shared/Nested'), { recursive: true, force: true })
      if (mode === 'symlink') {
        await disk.mkdir(join(root, 'Other'))
        await disk.symlink(join(root, 'Other'), join(root, 'Shared/Nested'))
      }
      await recoverRemovals(fs, undefined, { now: () => now + 8 * 86400000, maxBytes: 0 })
      const restored = (await disk.readdir(join(root, 'Shared'))).filter(
        (name) => name !== 'Nested' && name !== 'keep.md'
      )
      expect(restored).toHaveLength(1)
      expect(await disk.readFile(join(root, 'Shared', restored[0]), 'utf8')).toBe(
        'changed retained bytes'
      )
      if (mode === 'symlink') expect(await disk.readdir(join(root, 'Other'))).toEqual([])
    } finally {
      await disk.rm(root, { recursive: true, force: true })
    }
  },
  nativeIoTimeout
)
