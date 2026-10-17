import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { sha256 } from '@noble/hashes/sha2'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { SerialQueue } from '@/sync/queue'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['streamed', 'whole'] as const)(
  'uses %s mobile download receipts across reconciliation and keeps edited files',
  async (mode) => {
    const app = buildFakeVault([])
    const files = new Map<string, { size: number; mtime: number; ctime: number }>()
    const folders = new Set<string>()
    const readBinary = vi.fn(async () => {
      throw new Error('whole read forbidden')
    })
    Object.assign(app.vault.adapter, {
      exists: async (path: string) => files.has(path) || folders.has(path),
      mkdir: async (path: string) => {
        folders.add(path)
      },
      stat: async (path: string) =>
        files.has(path) ? { type: 'file', ...files.get(path)! } : null,
      writeBinary: async (path: string, bytes: ArrayBuffer) => {
        files.set(path, { size: bytes.byteLength, mtime: 10, ctime: 1 })
      },
      appendBinary: async (path: string, bytes: ArrayBuffer) => {
        files.get(path)!.size += bytes.byteLength
      },
      rename: async (from: string, to: string) => {
        files.set(to, { ...files.get(from)!, ctime: 2 })
        files.delete(from)
      },
      remove: async (path: string) => {
        files.delete(path)
      },
      readBinary,
    })
    app.workspace.iterateAllLeaves = () => {}
    const host = new ExternalFileHost(app as unknown as App, {
      platform: 'mobile',
      assertOwned: () => {},
    })
    const chunk = new Uint8Array(1024 * 1024).fill(17)
    const hash = sha256.create()
    for (let i = 0; i < 51; i++) hash.update(chunk)
    const sha = Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const target = 'sample.bin'
    const artifact = {
      operationId: 'sample',
      path: host.artifactPath('.abele-external-sample.incoming'),
      role: 'incoming' as const,
      size: 51 * chunk.length,
      sha,
    }
    try {
      await host.run(
        new SerialQueue(),
        {
          operationId: 'sample',
          fileId: 'sample-file',
          paths: [artifact.path, target],
          assertIntent: () => {},
        },
        async (effects) => {
          const staged =
            mode === 'whole'
              ? await effects.stage(artifact, new Uint8Array(artifact.size).fill(17))
              : await effects.stageSource(artifact, {
                  size: artifact.size,
                  read: async (_offset, length) => chunk.slice(0, length),
                  assertUnchanged: async () => {},
                  close: async () => {},
                })
          expect(staged).toEqual({ status: 'staged' })
          expect((await effects.install(artifact, target)).status).toBe('installed')
          files.get(target)!.ctime++
          expect(await host.fingerprint(target)).toEqual({ size: artifact.size, sha })
          files.get(target)!.mtime++
          await expect(effects.deleteOriginal({ ...artifact, path: target })).rejects.toThrow()
          expect(files.has(target)).toBe(true)
        }
      )
      expect(readBinary).not.toHaveBeenCalled()
    } finally {
      host.close()
    }
  },
  30_000
)
