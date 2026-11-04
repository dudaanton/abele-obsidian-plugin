// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { RuntimeFence } from '@/sync/external/recovery'
import { nativeVault } from '../helpers/nativeRestartVault'
import { captureRemoval, MemoryStateStore, retentionSnapshot } from '@abele/sync-sdk/core'
import { InspectionDirectories } from '@/sync/inspectionDirectories'

it('captures a native removal once under the SDK decision', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-native-removal-')))
  try {
    await disk.writeFile(join(root, 'sample.md'), 'sample bytes')
    const fs = new ObsidianFileSystem(nativeVault(root, disk) as never, {
      journalOwner: 'sample-owner',
    })
    const state = new MemoryStateStore()
    const have = await fs.fingerprint('sample.md')
    const base = {
      path: 'sample.md',
      wirePath: 'sample.md',
      fileId: 'sample-file',
      versionId: 'sample-version',
      sha: have.sha,
      size: have.size,
      mtime: have.mtime,
    }
    await state.put(base)
    expect(await captureRemoval(fs, state, base, async () => true)).toBe(true)
    expect(await fs.stat('sample.md')).toBeNull()
    const rows = await retentionSnapshot(fs)
    expect(rows).toHaveLength(1)
    expect(rows[0].phase).toBe('held')
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
})

it.each([false, true])(
  'recovers native completed conditional receipts before activation (legacyAbsent=%s)',
  async (legacyAbsent) => {
    const root = await disk.realpath(
      await disk.mkdtemp(join(tmpdir(), 'sample-conditional-restart-'))
    )
    let cut = false
    const native = {
      ...disk,
      open: async (...args: Parameters<typeof disk.open>) => {
        const handle = await disk.open(...args)
        if (cut && String(args[0]).endsWith('/complete')) {
          const sync = handle.sync.bind(handle)
          handle.sync = async () => {
            await sync()
            cut = false
            throw new Error('Sample cut after complete marker')
          }
        }
        return handle
      },
    }
    desktopFsPort(native)
    const app = nativeVault(root, native)
    let fence = new RuntimeFence(app as never, 'sample-ledger', () => true)
    try {
      fence.activate()
      const first = new ObsidianFileSystem(app as never, {
        runtimeFence: fence,
        journalOwner: 'sample-owner',
      })
      await first.conditionalFile({
        path: 'Sample/note.md',
        expected: null,
        effect: {
          kind: 'write',
          bytes: new TextEncoder().encode('kept incoming bytes'),
          mtime: 1000,
          receipt: 'sample-receipt',
        },
      })
      cut = true
      await expect(
        first.conditionalFile({
          path: 'Sample/note.md',
          expected: await first.fingerprint('Sample/note.md'),
          effect: { kind: 'move', to: 'Sample/moved.md' },
        })
      ).rejects.toThrow('Sample cut')
      fence.release()
      fence = new RuntimeFence(app as never, 'sample-ledger', () => true)
      const inventory = new Map()
      if (legacyAbsent) {
        const directories = new InspectionDirectories(['.obsidian/plugins/abele/sync-conditional'])
        directories.observe(
          app.vault.adapter,
          '.obsidian/plugins/abele'
        )(['.obsidian/plugins/abele/sync-staging'])
        directories.attach(inventory)
      }
      const restarted = new ObsidianFileSystem(app as never, {
        runtimeFence: fence,
        journalOwner: 'sample-owner',
        ...(legacyAbsent ? { startupInventory: () => inventory } : {}),
      })
      await restarted.recover()
      expect(
        await disk
          .readdir(join(root, '.abele-sync/connections/sample-owner/conditional/active'))
          .catch((error: unknown) => {
            if ((error as { code?: string }).code === 'ENOENT') return []
            throw error
          })
      ).toEqual([])
      expect(await disk.readFile(join(root, 'Sample/moved.md'), 'utf8')).toBe('kept incoming bytes')
      await expect(restarted.fingerprint('Sample/moved.md')).rejects.toThrow('startup recovery')
      await expect(
        restarted.conditionalFile({
          path: 'Other/new.md',
          expected: null,
          effect: { kind: 'write', bytes: new Uint8Array([1]), mtime: 1000 },
        })
      ).rejects.toThrow('startup recovery')
      expect(await disk.stat(join(root, 'Other')).catch(() => null)).toBeNull()
      fence.activate()
      expect((await restarted.stat('Sample/moved.md'))?.size).toBe(19)
    } finally {
      fence.release()
      desktopFsPort(disk)
      await disk.rm(root, { recursive: true, force: true })
    }
  }
)
