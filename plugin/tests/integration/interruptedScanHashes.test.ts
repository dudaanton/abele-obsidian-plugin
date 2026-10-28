import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  MemoryStateStore,
  scan,
  SyncEngine,
  sha256,
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

it('trusts a settled unchanged host stat without disk identity or stat calls', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000, ctime: 1000 }])
  withDesktopFs(app)
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
  try {
    await new ObsidianFileSystem(app as never).fingerprint('sample.bin')
    const fs = new ObsidianFileSystem(app as never)
    const stat = vi.spyOn(app.vault.adapter, 'stat')
    const identity = vi.spyOn(fs, 'fileIdentity')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const result = await fs.fingerprint('sample.bin')
    expect(result.sha).toBe(await sha256(new TextEncoder().encode('before')))
    expect(stat).not.toHaveBeenCalled()
    expect(identity).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  } finally {
    host.close()
  }
})

it.each(['size', 'mtime', 'ctime', 'hidden'] as const)(
  'uses disk verification when the host stat differs or the path is %s',
  async (change) => {
    const path = change === 'hidden' ? '.obsidian/sample.json' : 'sample.bin'
    const app = buildFakeVault([{ path, content: 'before', mtime: 1000, ctime: 1000 }])
    withDesktopFs(app)
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
    try {
      await new ObsidianFileSystem(app as never).fingerprint(path)
      const indexed = app.vault.getFileByPath(path)
      if (indexed && change !== 'hidden')
        indexed.stat = { ...indexed.stat, [change]: indexed.stat[change] + 1 }
      const fs = new ObsidianFileSystem(app as never)
      const stat = vi.spyOn(app.vault.adapter, 'stat')
      const identity = vi.spyOn(fs, 'fileIdentity')
      await fs.fingerprint(path)
      expect(stat).toHaveBeenCalled()
      expect(identity).toHaveBeenCalled()
    } finally {
      host.close()
    }
  }
)

it('migrates an unchanged pre-normalization scan record without reading content', async () => {
  const app = buildFakeVault([{ path: 'Sample.bin', content: 'before', mtime: 1000, ctime: 1000 }])
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  withDesktopFs(app)
  const factory = new IDBFactory()
  let host = await HostSyncStorage.open(factory, 'sample-vault', app)
  try {
    const fs = new ObsidianFileSystem(app as never)
    await host.writeScanFingerprint('Sample.bin', {
      identity: (await fs.fileIdentity!('Sample.bin'))!,
      size: 6,
      mtime: 1000,
      ctime: 1000,
      sha: await sha256(new TextEncoder().encode('before')),
    })
    host.close()
    host = await HostSyncStorage.open(factory, 'sample-vault', app)
    read.mockClear()
    await new ObsidianFileSystem(app as never).fingerprint('Sample.bin')
    expect(read).not.toHaveBeenCalled()
    expect(await host.readScanFingerprint(fs.pathKey('Sample.bin'))).toBeDefined()
    expect(await host.readScanFingerprint('Sample.bin')).toBeUndefined()
  } finally {
    host.close()
  }
})

it('invalidates descendant scan records when sync moves a directory', async () => {
  const app = buildFakeVault([{ path: 'Notes/sample.bin', content: 'before', mtime: 1000 }])
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  app.vault.adapter.rename = (from, to) =>
    from === 'Notes'
      ? app.vault.rename(app.vault.getAbstractFileByPath(from)!, to)
      : rename(from, to)
  withDesktopFs(app)
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
  try {
    const fs = new ObsidianFileSystem(app as never)
    await fs.fingerprint('Notes/sample.bin')
    expect(await host.readScanFingerprint(fs.pathKey('Notes/sample.bin'))).toBeDefined()
    await fs.moveDirectory('Notes', 'Moved')
    expect(await host.readScanFingerprint(fs.pathKey('Notes/sample.bin'))).toBeUndefined()
  } finally {
    host.close()
  }
})

it.each(['write', 'move', 'remove'] as const)(
  'does not promote a persisted scan hint into the base for %s',
  async (action) => {
    const app = buildFakeVault([
      { path: 'sample.bin', content: 'before', mtime: 1000, ctime: 1000 },
    ])
    withDesktopFs(app)
    const factory = new IDBFactory()
    let host = await HostSyncStorage.open(factory, 'sample-vault', app)
    try {
      await new ObsidianFileSystem(app as never).fingerprint('sample.bin')
      host.close()
      host = await HostSyncStorage.open(factory, 'sample-vault', app)
      const fs = new ObsidianFileSystem(app as never)
      const before = await app.vault.adapter.stat('sample.bin')
      const identity = await fs.fileIdentity!('sample.bin')
      await app.vault.adapter.writeBinary('sample.bin', new TextEncoder().encode('edited').buffer, {
        mtime: 1000,
        ctime: 1000,
      })
      expect(await app.vault.adapter.stat('sample.bin')).toEqual(before)
      expect(await fs.fileIdentity!('sample.bin')).toBe(identity)
      await fs.fingerprint('sample.bin') // Scan is permitted to reuse the metadata hint.
      const publish = vi.spyOn(fs, 'conditionalFile')
      const mutation =
        action === 'write'
          ? fs.writeAtomic('sample.bin', new TextEncoder().encode('remote'), 2000)
          : action === 'move'
            ? fs.move('sample.bin', 'moved.bin')
            : fs.remove('sample.bin')
      await expect(mutation).rejects.toMatchObject({ code: 'conflict' })
      // Retrying the same byte decision must not silently adopt the changed local base.
      const retry =
        action === 'write'
          ? fs.writeAtomic('sample.bin', new TextEncoder().encode('remote'), 2000)
          : action === 'move'
            ? fs.move('sample.bin', 'moved.bin')
            : fs.remove('sample.bin')
      await expect(retry).rejects.toMatchObject({ code: 'conflict' })
      expect(publish).not.toHaveBeenCalled()
      expect(await app.vault.adapter.read('sample.bin')).toBe('edited')
    } finally {
      host.close()
    }
  }
)

it('does not repopulate a record from a hash that overlapped a sync move', async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
  withDesktopFs(app)
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const original = BoundedVaultIo.prototype.fingerprint
  vi.spyOn(BoundedVaultIo.prototype, 'fingerprint').mockImplementationOnce(async function (
    ...args
  ) {
    const result = await original.apply(this, args)
    entered()
    await gate
    return result
  })
  const hashing = new ObsidianFileSystem(app as never).fingerprint('sample.bin')
  try {
    await started
    await new ObsidianFileSystem(app as never).move('sample.bin', 'moved.bin')
    release()
    await hashing
    expect(await host.readScanFingerprint('sample.bin')).toBeUndefined()
    expect(await host.readScanFingerprint('moved.bin')).toBeUndefined()
  } finally {
    release()
    await hashing.catch(() => {})
    host.close()
  }
})

it.each(['write', 'move', 'remove'] as const)(
  'drops the persisted scan record before sync %s',
  async (action) => {
    const app = buildFakeVault([{ path: 'Sample.bin', content: 'before', mtime: 1000 }])
    withDesktopFs(app)
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-vault', app)
    try {
      const fs = new ObsidianFileSystem(app as never)
      await fs.fingerprint('Sample.bin')
      expect(await host.readScanFingerprint(fs.pathKey('Sample.bin'))).toBeDefined()
      const native = Reflect.get(app.vault.adapter, 'fsPromises')
      const rename = native.rename.bind(native)
      const capture = vi.spyOn(native, 'rename').mockImplementation(async (...args: unknown[]) => {
        if (String(args[0]).endsWith('/Sample.bin')) {
          expect(await host.readScanFingerprint(fs.pathKey('Sample.bin'))).toBeUndefined()
          // A concurrent hash during the mutation cannot recreate the deleted record.
          await new ObsidianFileSystem(app as never).fingerprint('Sample.bin')
          expect(await host.readScanFingerprint(fs.pathKey('Sample.bin'))).toBeUndefined()
        }
        return rename(...args)
      })
      if (action === 'write')
        await fs.writeAtomic('Sample.bin', new TextEncoder().encode('remote'), 2000)
      else if (action === 'move') await fs.move('Sample.bin', 'Moved.bin')
      else await fs.remove('Sample.bin')
      expect(await host.readScanFingerprint(fs.pathKey('Sample.bin'))).toBeUndefined()
      expect(await host.readScanFingerprint(fs.pathKey('Moved.bin'))).toBeUndefined()
      expect(capture).toHaveBeenCalled()
    } finally {
      host.close()
    }
  }
)

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
      // A replacement with identical indexed size, mtime and ctime is accepted as unchanged.
      const indexedChange = changed === 'stat'
      expect(read.mock.calls.some(([path]) => path === 'sample-0.bin')).toBe(indexedChange)
      if (indexedChange)
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
