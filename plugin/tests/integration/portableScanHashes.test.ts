import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, reconcileGeneration, scan, sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { buildFakeVault } from '../helpers/fakeVault'

it('reuses portable hashes across reopen for a large indexed vault', async () => {
  const app = buildFakeVault(
    Array.from({ length: 12000 }, (_, n) => ({
      path: `notes/sample-${n}.bin`,
      content: 'sample',
      mtime: 1000,
      ctime: 1000,
    }))
  )
  const factory = new IDBFactory()
  let host = await HostSyncStorage.open(factory, 'portable-sample', app)
  try {
    const first = await new ObsidianFileSystem(app as never).fingerprint('notes/sample-0.bin')
    expect(await host.readScanFingerprint('notes/sample-0.bin')).toMatchObject({ sha: first.sha })
    const sha = await sha256(new TextEncoder().encode('sample'))
    await host.writeScanFingerprints(
      app.vault.getFiles().map((file) => ({
        path: file.path,
        revision: host.scanFingerprintRevision(file.path),
        value: { identity: 'host-index', size: 6, mtime: 1000, ctime: 1000, sha },
      }))
    )
    host.close()
    host = await HostSyncStorage.open(factory, 'portable-sample', app)
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const stat = vi.spyOn(app.vault.adapter, 'stat')
    const fs = new ObsidianFileSystem(app as never)
    const state = new MemoryStateStore()
    await reconcileGeneration(state, 'sample-generation')
    const result = await scan(fs, state, { excluded: () => false, revalidate: 'all' })
    expect(result.hashes.size).toBe(12000)
    expect(new Set(result.hashes.values())).toEqual(new Set([sha]))
    expect(read).not.toHaveBeenCalled()
    // Inventory validates a bounded sample of the host index, never all 12k paths.
    expect(stat.mock.calls.filter(([path]) => path.startsWith('notes/'))).toHaveLength(32)
    await app.vault.adapter.writeBinary(
      'notes/sample-0.bin',
      new TextEncoder().encode('edited').buffer,
      { mtime: 2000 }
    )
    expect((await fs.fingerprint('notes/sample-0.bin')).sha).not.toBe(sha)
    expect(read.mock.calls.map(([path]) => path)).toEqual(['notes/sample-0.bin'])
    read.mockClear()
    await fs.fingerprint('notes/sample-1.bin', undefined, true)
    expect(read.mock.calls.map(([path]) => path)).toEqual(['notes/sample-1.bin'])
  } finally {
    host.close()
    vi.restoreAllMocks()
  }
}, 30000)

it('does not reuse portable hints for hidden files, invalidated rows or cancelled scans', async () => {
  const app = buildFakeVault([
    { path: 'sample.bin', content: 'sample', mtime: 1000 },
    { path: '.config/sample.bin', content: 'sample', mtime: 1000 },
  ])
  const host = await HostSyncStorage.open(new IDBFactory(), 'portable-safety', app)
  try {
    const fs = new ObsidianFileSystem(app as never)
    await fs.fingerprint('sample.bin')
    await fs.fingerprint('.config/sample.bin')
    expect(await host.readScanFingerprint('.config/sample.bin')).toBeUndefined()
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    await host.withScanMutation(['sample.bin'], async () => {})
    await fs.fingerprint('sample.bin')
    await fs.fingerprint('.config/sample.bin')
    expect(read.mock.calls.map(([path]) => path)).toEqual(['sample.bin', '.config/sample.bin'])
    read.mockClear()
    const controller = new AbortController()
    controller.abort()
    await expect(fs.fingerprint('sample.bin', controller.signal)).rejects.toBeDefined()
    expect(read).not.toHaveBeenCalled()
  } finally {
    host.close()
    vi.restoreAllMocks()
  }
})
