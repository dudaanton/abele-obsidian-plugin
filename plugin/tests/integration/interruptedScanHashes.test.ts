import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  MemoryStateStore,
  scan,
  SyncEngine,
  type EngineClient,
  type ChunkSource,
} from '@abele/sync-sdk/core'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { selectiveFrom } from '@/sync/connection'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

afterEach(() => vi.restoreAllMocks())

it('replaces cached evidence when forced verification detects changed bytes with identical metadata', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000, ctime: 1000 }])
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  withDesktopFs(app)
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
  try {
    const fs = new ObsidianFileSystem(app as never)
    const first = await fs.fingerprint('sample.bin')
    const before = await app.vault.adapter.stat('sample.bin')
    const identity = await fs.fileIdentity!('sample.bin')
    await app.vault.adapter.writeBinary('sample.bin', new TextEncoder().encode('edited').buffer, {
      mtime: 1000,
      ctime: 1000,
    })
    expect(await app.vault.adapter.stat('sample.bin')).toEqual(before)
    expect(await fs.fileIdentity!('sample.bin')).toBe(identity)
    const fresh = await Reflect.get(fs, Symbol.for('abele.sync.fingerprint-fresh-v1')).call(
      fs,
      'sample.bin'
    )
    expect(fresh.sha).not.toBe(first.sha)
    read.mockClear()
    expect((await fs.fingerprint('sample.bin')).sha).toBe(fresh.sha)
    expect(read).not.toHaveBeenCalled()
  } finally {
    host.close()
  }
})

it('does not persist a partially hashed file after cancellation', async () => {
  const app = buildFakeVault([
    { path: 'sample.bin', content: 'x'.repeat(2 * 1024 * 1024), mtime: 1000 },
  ])
  const controller = new AbortController()
  const original = app.vault.adapter.readBinary.bind(app.vault.adapter)
  const read = vi.spyOn(app.vault.adapter, 'readBinary').mockImplementationOnce(async (path) => {
    const bytes = await original(path)
    controller.abort(new Error('sample cancelled hash'))
    return bytes
  })
  withDesktopFs(app)
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
  try {
    const fs = new ObsidianFileSystem(app as never)
    await expect(fs.fingerprint('sample.bin', controller.signal)).rejects.toThrow(
      'sample cancelled hash'
    )
    expect(await host.readScanFingerprint('sample.bin')).toBeUndefined()
    read.mockClear()
    await fs.fingerprint('sample.bin')
    expect(read).toHaveBeenCalled()
    expect(await host.readScanFingerprint('sample.bin')).toBeDefined()
  } finally {
    host.close()
  }
})

it.each([false, 'stat', 'object'] as const)(
  'reuses completed unsynced hashes after interruption and host reopen, changed=%s',
  async (changed) => {
    const content = 'x'.repeat(2 * 1024 * 1024 + 7)
    const app = buildFakeVault(
      Array.from({ length: 4 }, (_, n) => ({
        path: `sample-${n}.bin`,
        content,
        mtime: 1000,
        ctime: 1000,
      }))
    )
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    withDesktopFs(app)
    const factory = new IDBFactory()
    let host = await HostSyncStorage.open(factory, 'sample-vault', app)
    try {
      const state = new MemoryStateStore()
      const first = await scan(new ObsidianFileSystem(app as never), state, {
        excluded: () => false,
      })
      expect(first.ops).toHaveLength(4)
      // Interrupted before publication: no server heads were committed to the ledger.
      expect(await state.get('sample-0.bin')).toBeNull()
      host.close()
      host = await HostSyncStorage.open(factory, 'sample-vault', app)
      if (changed === 'object') await app.vault.adapter.remove('sample-0.bin')
      if (changed)
        await app.vault.adapter.writeBinary(
          'sample-0.bin',
          new TextEncoder().encode('y' + content.slice(1)).buffer,
          {
            mtime: changed === 'object' ? 1000 : 2000,
            ctime: 1000,
          }
        )
      read.mockClear()
      const fs = new ObsidianFileSystem(app as never)
      const resumed = await scan(fs, state, { excluded: () => false })
      expect(resumed.ops).toHaveLength(4)
      expect(
        read.mock.calls.map(([path]) => path).filter((path) => path !== 'sample-0.bin')
      ).toEqual([])
      expect(read.mock.calls.some(([path]) => path === 'sample-0.bin')).toBe(!!changed)
      if (changed)
        expect(resumed.hashes.get('sample-0.bin')).not.toBe(first.hashes.get('sample-0.bin'))
      else expect(resumed.hashes).toEqual(first.hashes)
      read.mockClear()
      await Reflect.get(fs, Symbol.for('abele.sync.fingerprint-fresh-v1')).call(fs, 'sample-1.bin')
      expect(read).toHaveBeenCalled()
    } finally {
      host.close()
    }
  }
)

it('does not repeat completed whole-file hashing after a mid-upload network loss and plugin reload', async () => {
  const app = buildFakeVault([
    { path: 'sample-large.bin', content: 'x'.repeat(4 * 1024 * 1024 + 1), mtime: 1000 },
  ])
  withDesktopFs(app)
  const factory = new IDBFactory()
  let host = await HostSyncStorage.open(factory, 'sample-vault', app)
  const state = new MemoryStateStore()
  await state.setCursor(1)
  const upload = vi.fn(async (_expected: unknown, source: ChunkSource) => {
    expect((await source.read(0, 1024)).length).toBe(1024)
    throw new Error('sample network interrupted mid-upload')
  })
  const client = {
    state: async () => ({
      head_seq: 1,
      settings: {
        conflict: 'merge',
        max_file_bytes: 100000000,
        quota_bytes: null,
        retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
      },
    }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    hasBlob: async () => false,
    putBlobSource: upload,
  } as unknown as EngineClient
  let engine = new SyncEngine({
    fs: new ObsidianFileSystem(app as never),
    state,
    client,
    selective: selectiveFrom(undefined),
  })
  const hash = vi.spyOn(BoundedVaultIo.prototype, 'fingerprint')
  try {
    await engine.sync().catch(() => {})
    expect(upload).toHaveBeenCalled()
    expect(hash).toHaveBeenCalled()
    await engine.stop()
    host.close()
    host = await HostSyncStorage.open(factory, 'sample-vault', app)
    engine = new SyncEngine({
      fs: new ObsidianFileSystem(app as never),
      state,
      client,
      selective: selectiveFrom(undefined),
    })
    upload.mockClear()
    hash.mockClear()
    await engine.sync().catch(() => {})
    expect(upload).toHaveBeenCalled()
    expect(hash).not.toHaveBeenCalled()
  } finally {
    await engine.stop()
    host.close()
  }
})
