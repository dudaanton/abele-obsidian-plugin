import { afterEach, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { sha256 } from '@noble/hashes/sha2'
import { ExternalFileHost, externalFileSnapshot } from '@/sync/external/ObsidianExternalFileHost'
import { MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'
import { connectionAdapter } from '@/sync/connectionScope'
import { CONNECTION_PRIVATE, connectionPrivateRoot } from '@/sync/connectionPaths'

afterEach(() => vi.unstubAllGlobals())
it.each([false, true])(
  'refuses unknown 200 MiB external mobile fingerprints without bounded verification (scoped=%s)',
  async (scoped) => {
    const f = mobileStreamFixture()
    const hash = sha256.create()
    const chunk = new Uint8Array(MAX_CHUNK_BYTES).fill(73)
    for (let at = 0; at < f.size; at += chunk.length) hash.update(chunk)
    const expected = {
      size: f.size,
      sha: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    }
    const root = scoped ? connectionPrivateRoot('sample-connection') : undefined
    const path = scoped ? 'Shared/sample.bin' : 'sample.bin'
    const writes = vi.spyOn(f.adapter, 'writeBinary')
    const app = {
      [CONNECTION_PRIVATE]: root,
      vault: {
        adapter: scoped ? connectionAdapter(f.adapter, 'Shared', root) : f.adapter,
        configDir: '.obsidian',
      },
      workspace: { on: () => ({}), offref: () => {}, iterateAllLeaves: () => {} },
    } as unknown as App
    const before = externalFileSnapshot().localReads
    const host = new ExternalFileHost(app, { platform: 'mobile', assertOwned: () => {} })
    try {
      await expect(host.fingerprint(path)).rejects.toThrow('50 MiB')
      await expect(host.matches({ path, ...expected })).rejects.toThrow('50 MiB')
      if (scoped) await expect(host.fingerprint('Private/other.bin')).rejects.toThrow()
    } finally {
      host.close()
    }
    const after = externalFileSnapshot().localReads
    expect(after.bytesRead - before.bytesRead).toBe(0)
    expect(after.chunks - before.chunks).toBe(0)
    expect(after.maxChunkBytes).toBe(0)
    expect(after.peakReaderBytes).toBeLessThanOrEqual(f.size + MAX_CHUNK_BYTES)
    expect(after.retainedBytes).toBe(0)
    expect(after.activeStreams).toBe(0)
    expect(f.counts).toMatchObject({
      largeFetches: 0,
      bytesProduced: 0,
      arrayBuffers: 0,
      blobs: 0,
    })
    expect(f.readBinary).not.toHaveBeenCalled()
    expect(f.probes.size).toBe(0)
    if (root)
      expect(writes.mock.calls.every(([path]) => path.startsWith(root + '/writes/'))).toBe(true)
  },
  30000
)
