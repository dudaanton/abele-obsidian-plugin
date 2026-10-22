import { expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { WriteJournal } from '@/sync/writeJournal'
import { EditCopies } from '@/sync/editCopies'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { JOURNAL_KEY, RECOVERED_WRITES_KEY } from '@/sync/writeJournal'
import { deferred } from '../helpers/deferred'
import { isDroppableTemp } from '@/sync/vaultWrites'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { privatePlacementStages } from '@/sync/privatePlacementStages'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage, hostStorageOf } from '@/sync/hostSyncStorage'

const bytes = new TextEncoder().encode('sample streamed replacement')
const setup = async () => {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'original' }])
  const data = new Map<string, unknown>()
  const storage = {
    loadLocalStorage: (key: string) => data.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, structuredClone(value))
    },
  }
  await HostSyncStorage.open(new IDBFactory(), 'sample-vault', storage)
  const fs = () => new ObsidianFileSystem(app as unknown as App, { storage })
  return { app, fs, storage }
}
it('reopens a durable stage when the last localStorage update was lost at quit', async () => {
  const { fs, storage } = await setup()
  const stage = await fs().beginAtomicWrite('sample-new.bin', 0, null)
  await stage.append(0, new TextEncoder().encode('sample bytes'))
  storage.saveLocalStorage(JOURNAL_KEY, null)
  expect((await fs().reopenStage(stage.id)).offset).toBe(12)
})
it('finishes stage discard after a crash between file removal and journal retirement', async () => {
  const { app, fs, storage } = await setup()
  const stage = await fs().beginAtomicWrite('sample-new.bin', 0, null)
  // The remove reached disk, but the process quit before the next journal write.
  await app.vault.adapter.remove(stage.id)
  const restarted = fs()
  await expect(restarted.reopenStage(stage.id)).rejects.toMatchObject({ code: 'ENOENT' })
  await restarted.discardStage(stage.id)
  await restarted.discardStage(stage.id)
  expect(new WriteJournal(storage).entries()).toEqual([])
  expect(await app.vault.adapter.read('sample.bin')).toBe('original')
})
it('excludes appends while idempotent discard awaits its disk check', async () => {
  const { app, fs } = await setup(),
    disk = fs()
  const stage = await disk.beginAtomicWrite('sample-new.bin', 0, null)
  const entered = deferred<void>(),
    resume = deferred<void>()
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  let waiting = true
  app.vault.adapter.stat = async (path) => {
    if (path === stage.id && waiting) {
      waiting = false
      entered.resolve()
      await resume.promise
    }
    return stat(path)
  }
  const pending = disk.discardStage(stage.id)
  await entered.promise
  try {
    await expect(stage.append(0, new Uint8Array([1]))).rejects.toThrow('stage is busy')
  } finally {
    resume.resolve()
    await pending
  }
})
it('awaits stage ownership before journalling or creating its private artifact', async () => {
  const { app, fs, storage } = await setup()
  const disk = fs(),
    owned = deferred<void>(),
    resume = deferred<void>()
  let id = ''
  const pending = disk.beginAtomicWrite('sample-new.bin', 0, null, async (stageId) => {
    id = stageId
    owned.resolve()
    await resume.promise
  })
  await owned.promise
  try {
    expect(id).not.toBe('')
    expect(await app.vault.adapter.exists(id)).toBe(false)
    expect(new WriteJournal(storage).entries()).toEqual([])
  } finally {
    resume.resolve()
  }
  const stage = await pending
  expect(stage.id).toBe(id)
  await stage.discard()
})
it.each([false, true])(
  'protects a disposable source while creation awaits acknowledgement (owned=%s)',
  async (owned) => {
    const { app, fs } = await setup()
    const privateRoot = connectionPrivateRoot('sample')
    const make = () =>
      owned
        ? new ObsidianFileSystem(app as never, {
            adapter: connectionAdapter(app.vault.adapter, 'Shared', privateRoot),
            connectionId: 'sample',
            fileScope: 'Shared',
          })
        : fs()
    const disk = make(),
      created = deferred<void>(),
      resume = deferred<void>()
    const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
    let temp = ''
    app.vault.adapter.writeBinary = async (path, data, options) => {
      await write(path, data, options)
      temp = path
      created.resolve()
      await resume.promise
    }
    const pending = privatePlacementStages(disk, owned ? privateRoot : undefined)
      .beginAtomicWrite('.abele-sync/placement-inbox/' + crypto.randomUUID(), 0, null)
      .then(
        (stage) => stage,
        (error) => error as Error
      )
    await Promise.race([
      created.promise,
      pending.then((result) => {
        if (result instanceof Error) throw result
      }),
    ])
    try {
      await make().recover()
      expect(await app.vault.adapter.exists(temp)).toBe(true)
      expect(isDroppableTemp(temp)).toBe(false)
    } finally {
      resume.resolve()
      const result = await pending
      if (!(result instanceof Error)) await result.discard()
    }
  }
)
it('does not borrow a live receipt from a different exact spelling on a case-sensitive host', async () => {
  const { app, fs } = await setup(),
    disk = fs()
  const data = new Uint8Array(2 * 1024 * 1024).fill(17)
  const stage = await disk.beginAtomicWrite('Shared/sample.bin', 123, null)
  await stage.append(0, data.slice(0, 1024 * 1024))
  await stage.append(1024 * 1024, data.slice(1024 * 1024))
  await stage.seal({ size: data.length, sha: await sha256(data) })
  await stage.commit()
  // Model a case-sensitive listing with two independent directory entries.
  vi.spyOn(app.vault.adapter, 'list').mockResolvedValue({
    files: ['Shared/sample.bin', 'Shared/SAMPLE.bin'],
    folders: [],
  })
  const read = vi
    .spyOn(app.vault.adapter, 'readBinary')
    .mockRejectedValue(new Error('Whole local read forbidden'))
  await expect(
    disk[Symbol.for('abele.sync.fingerprint-pull-v1')]('Shared/SAMPLE.bin')
  ).rejects.toThrow('bounded')
  expect(read).not.toHaveBeenCalled()
})
it('releases a source reservation when creation fails after writing its temp', async () => {
  const { app, fs, storage } = await setup()
  const disk = fs(),
    write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  let temp = ''
  app.vault.adapter.writeBinary = async (path, data, options) => {
    await write(path, data, options)
    temp = path
    throw new Error('Sample creation failed after write')
  }
  await expect(
    disk.beginAtomicWrite('.abele-sync/placement-inbox/sample', 0, null)
  ).rejects.toThrow('creation failed')
  await fs().recover()
  expect(await app.vault.adapter.exists(temp)).toBe(false)
  expect(new WriteJournal(storage).entries()).toEqual([])
})
it('retires an interrupted disposable placement source and its journal on restart', async () => {
  const { app, fs, storage } = await setup()
  await app.vault.adapter.write('source.tmp', 'incomplete network source')
  hostStorageOf(storage).saveLocalStorage(JOURNAL_KEY, [
    {
      target: '.abele-sync/placement-inbox/sample',
      temp: 'source.tmp',
      streaming: { mtime: 0, base: null },
    },
  ])
  await fs().recover()
  expect(await app.vault.adapter.exists('source.tmp')).toBe(false)
  expect(new WriteJournal(storage).entries()).toEqual([])
  expect(await app.vault.adapter.read('sample.bin')).toBe('original')
})
it('does not retire a live private network source or an ordinary retained stage', async () => {
  const { fs } = await setup()
  const disk = fs()
  const source = await disk.beginAtomicWrite('.abele-sync/placement-inbox/sample', 0, null)
  const retained = await disk.beginAtomicWrite('local-copy.bin', 0, null)
  await disk[Symbol.for('abele.sync.live-source-stage-v1')](source.id, async () => {
    await disk.recover()
    expect((await disk.reopenStage(source.id)).offset).toBe(0)
    expect((await disk.reopenStage(retained.id)).offset).toBe(0)
  })
  await source.discard()
  await retained.discard()
})

it('never whole-reads a large existing file when the incoming atomic write fits one chunk', async () => {
  const { app, fs } = await setup()
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    const actual = await stat(path)
    return path === 'sample.bin' && actual ? { ...actual, size: 1024 * 1024 * 1024 } : actual
  })
  const read = vi
    .spyOn(app.vault.adapter, 'readBinary')
    .mockRejectedValue(new Error('Whole old-file read forbidden'))
  await expect(fs().writeAtomic('sample.bin', bytes, 123)).rejects.toThrow()
  expect(read).not.toHaveBeenCalled()
})
it('pull verification never falls back to reading an entire multi-chunk local file', async () => {
  const { app, fs } = await setup()
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    const actual = await stat(path)
    return path === 'sample.bin' && actual ? { ...actual, size: 2 * 1024 * 1024 } : actual
  })
  const read = vi
    .spyOn(app.vault.adapter, 'readBinary')
    .mockRejectedValue(new Error('Whole local read forbidden'))
  await expect(fs()[Symbol.for('abele.sync.fingerprint-pull-v1')]('sample.bin')).rejects.toThrow(
    'bounded'
  )
  expect(read).not.toHaveBeenCalled()
})
it('preserves an interrupted streaming backup without hashing the installed large file after restart', async () => {
  const { app, fs, storage } = await setup()
  await app.vault.adapter.write('saved.old', 'previous local bytes')
  const stat = app.vault.adapter.stat.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'stat').mockImplementation(async (path) => {
    const actual = await stat(path)
    return path === 'sample.bin' && actual ? { ...actual, size: 51 * 1024 * 1024 } : actual
  })
  const read = vi
    .spyOn(app.vault.adapter, 'readBinary')
    .mockRejectedValue(new Error('Whole local read forbidden'))
  hostStorageOf(storage).saveLocalStorage(JOURNAL_KEY, [
    {
      target: 'sample.bin',
      temp: 'sample.tmp',
      backup: 'saved.old',
      replacementSha: 'a'.repeat(64),
      streaming: {
        mtime: 123,
        base: { size: 20, sha: 'b'.repeat(64) },
        sealed: { size: 51 * 1024 * 1024, sha: 'a'.repeat(64) },
      },
    },
  ])
  await fs().recover()
  expect(read).not.toHaveBeenCalled()
  expect(await app.vault.adapter.exists('saved.old')).toBe(true)
  expect(new WriteJournal(storage).entries()).toEqual([])
  expect(storage.loadLocalStorage(RECOVERED_WRITES_KEY)).toMatchObject([{ backup: 'saved.old' }])
})
it('retains local edits as sealed source locators and verifies retained bytes on every read', async () => {
  const { app, fs } = await setup()
  const writer = fs(),
    copies = new EditCopies(),
    store = new MemoryStateStore()
  copies.expect(['destination'])
  copies.register('destination', store, () => true)
  const read = vi.spyOn(writer, 'read').mockRejectedValue(new Error('whole file read'))
  await copies.capture(writer, ['sample.bin'])
  const [copy] = await copies.list(store)
  expect(copy.bytes).toEqual([])
  expect(copy.source?.size).toBe(8)
  expect(read).not.toHaveBeenCalled()
  await app.vault.adapter.writeBinary(copy.source!.id, new Uint8Array([1]).buffer)
  await expect(copies.list(store)).rejects.toThrow('integrity')
})
it('reopens a partial stage after restart, verifies it, and publishes through the journal', async () => {
  const { app, fs, storage } = await setup()
  const first = fs()
  const base = await first.fingerprint('sample.bin')
  const stage = await first.beginAtomicWrite('sample.bin', 123, base)
  await stage.append(0, bytes.slice(0, 6))
  const restarted = fs()
  await restarted.recover()
  const resumed = await restarted.reopenStage(stage.id)
  expect(resumed.offset).toBe(6)
  await resumed.append(6, bytes.slice(6))
  await resumed.seal({ size: bytes.length, sha: await sha256(bytes) })
  await resumed.commit()
  expect(new Uint8Array(await app.vault.adapter.readBinary('sample.bin'))).toEqual(bytes)
  expect(new WriteJournal(storage).entries()).toEqual([])
})
it('retains the stage on cancellation and does not publish corrupt or stale bytes', async () => {
  const { app, fs } = await setup()
  const writer = fs()
  const base = await writer.fingerprint('sample.bin')
  const stage = await writer.beginAtomicWrite('sample.bin', 123, base)
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  await expect(stage.append(0, bytes, abort.signal)).rejects.toThrow('cancelled')
  expect(stage.offset).toBe(0)
  await stage.append(0, bytes)
  await expect(stage.seal({ size: bytes.length, sha: '0'.repeat(64) })).rejects.toThrow('integrity')
  await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
  await app.vault.adapter.writeBinary(
    'sample.bin',
    new TextEncoder().encode('independent edit').buffer
  )
  await expect(stage.commit()).rejects.toThrow('changed')
  expect(await app.vault.adapter.read('sample.bin')).toBe('independent edit')
  await stage.discard()
  expect(await app.vault.adapter.exists(stage.id)).toBe(false)
})
it('resumes from the actual appended length when cancellation arrives with the disk acknowledgement', async () => {
  const { app, fs } = await setup()
  const writer = fs(),
    abort = new AbortController()
  const stage = await writer.beginAtomicWrite('incoming.bin', 1000, null)
  const write = app.vault.adapter.writeBinary.bind(app.vault.adapter)
  app.vault.adapter.writeBinary = async (...args) => {
    await write(...args)
    abort.abort(new Error('cancelled'))
  }
  await expect(stage.append(0, bytes.slice(0, 5), abort.signal)).rejects.toThrow('cancelled')
  expect(stage.offset).toBe(5)
  app.vault.adapter.writeBinary = write
  const resumed = await writer.reopenStage(stage.id)
  await resumed.append(resumed.offset, bytes.slice(5))
  await resumed.seal({ size: bytes.length, sha: await sha256(bytes) })
  await resumed.commit()
  await resumed.discard()
  expect(new Uint8Array(await app.vault.adapter.readBinary('incoming.bin'))).toEqual(bytes)
})
it('rechecks ownership after awaited provenance, before stage publication', async () => {
  const { app, storage } = await setup()
  let held = true
  const fence = {
    assertReady: () => {
      if (!held) throw new Error('closed')
    },
    assertOwned: () => {
      if (!held) throw new Error('closed')
    },
    effect: <T>(work: () => T): T => work(),
  }
  const fs = new ObsidianFileSystem(app as unknown as App, {
    storage,
    runtimeFence: fence as never,
    beforeEngineMutation: async () => {
      held = false
    },
  })
  const stage = await fs.beginAtomicWrite('incoming.bin', 100, null)
  await stage.append(0, bytes)
  await stage.seal({ size: bytes.length, sha: await sha256(bytes) })
  const rename = vi.spyOn(app.vault.adapter, 'rename')
  await expect(stage.commit()).rejects.toThrow('closed')
  expect(rename).not.toHaveBeenCalled()
})
