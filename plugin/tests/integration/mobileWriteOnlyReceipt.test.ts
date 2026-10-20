import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { downloadToStage, TransferBudget } from '@abele/sync-sdk/core'
import { sha256 as incremental } from '@noble/hashes/sha2'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { SerialQueue } from '@/sync/queue'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([50, 200])(
  'receives and hydrates %s MiB with append-only storage and no local read-back',
  async (mib) => {
    const app = buildFakeVault([]),
      records = new Map<string, { size: number; mtime: number; ctime: number }>()
    let clock = 1
    const chunk = new Uint8Array(1024 * 1024).fill(73),
      size = mib * chunk.length
    const hash = incremental.create()
    for (let i = 0; i < mib; i++) hash.update(chunk)
    const identity = {
      size,
      sha: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    }
    const readBinary = vi.fn(async (path: string) => {
      if (records.get(path)!.size > 50 * 1024 * 1024) throw new Error('oversized whole-file read')
      throw new Error('Receipt must not read back')
    })
    Object.assign(app.vault.adapter, {
      exists: async (path: string) => records.has(path),
      stat: async (path: string) =>
        records.has(path) ? { type: 'file', ...records.get(path) } : null,
      writeBinary: async (path: string, bytes: ArrayBuffer) => {
        expect(bytes.byteLength).toBeLessThanOrEqual(chunk.length)
        records.set(path, { size: bytes.byteLength, mtime: ++clock, ctime: clock })
      },
      appendBinary: async (path: string, bytes: ArrayBuffer) => {
        expect(bytes.byteLength).toBeLessThanOrEqual(chunk.length)
        const old = records.get(path)!
        records.set(path, { size: old.size + bytes.byteLength, mtime: ++clock, ctime: old.ctime })
      },
      rename: async (from: string, to: string) => {
        if (records.has(to)) throw new Error('occupied')
        records.set(to, { ...records.get(from)!, ctime: ++clock })
        records.delete(from)
      },
      remove: async (path: string) => {
        records.delete(path)
      },
      readBinary,
    })
    app.workspace.iterateAllLeaves = () => {}
    const source = () => ({
      size,
      read: async (_offset: number, length: number) => chunk.slice(0, length),
      assertUnchanged: async () => {},
      close: async () => {},
    })
    const fs = new ObsidianFileSystem(app as unknown as App)
    await downloadToStage(
      source(),
      await fs.beginAtomicWrite('sample.bin', 1, null),
      identity,
      new TransferBudget()
    )
    const host = new ExternalFileHost(app as unknown as App, {
      platform: 'mobile',
      assertOwned: () => {},
    })
    try {
      await host.requireTransfer(size)
      if (mib > 50) {
        // An ordinary fresh scan cannot read this file; it must not erase the download proof.
        await expect(fs.fingerprint('sample.bin')).rejects.toThrow('50 MiB')
      }
      expect(await host.fingerprint('sample.bin')).toMatchObject(identity)
      await app.vault.adapter.remove('sample.bin')
      const artifact = {
        operationId: 'sample',
        path: '.abele-external-sample.incoming',
        role: 'incoming' as const,
        ...identity,
      }
      await host.run(
        new SerialQueue(),
        {
          operationId: 'sample',
          fileId: 'sample-file',
          paths: [artifact.path, 'sample.bin'],
          assertIntent: () => {},
        },
        async (effects) => {
          expect(await effects.stageSource(artifact, source())).toEqual({ status: 'staged' })
          expect(await effects.install(artifact, 'sample.bin')).toMatchObject({
            status: 'installed',
          })
        }
      )
      expect(await host.fingerprint('sample.bin')).toMatchObject(identity)
      expect(readBinary).not.toHaveBeenCalled()
      records.set('sample.bin', { size, mtime: ++clock, ctime: clock })
      if (mib > 50) {
        await expect(host.fingerprint('sample.bin')).rejects.toThrow(
          'Recorded file changed; file kept'
        )
        await expect(fs.openRead('sample.bin')).rejects.toThrow('50 MiB')
        expect(records.has('sample.bin')).toBe(true)
        expect(readBinary).not.toHaveBeenCalled()
      }
    } finally {
      host.close()
    }
  },
  // Hashing 200 MiB three times is bounded CPU work; a loaded shard needs more than the default.
  60_000
)
