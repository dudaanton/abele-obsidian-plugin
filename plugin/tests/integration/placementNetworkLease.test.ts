import { expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  ExpectedWrites,
  sha256,
  resumeJournal,
  EngineError,
} from '@abele/sync-core'
import { PullPlacer } from '../../node_modules/@abele/sync-core/dist/pullPlace.js'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
import { deferred } from '../helpers/deferred'
import type { ChangeItem } from '@abele/sync-protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { JOURNAL_KEY } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['complete', 'edited', 'offline'])(
  'streams once outside the path lease and settles a slow pull: %s',
  async (outcome) => {
    const app = buildFakeVault([]),
      disk = new ObsidianFileSystem(app as never),
      state = new MemoryStateStore(),
      locks = new PathCoordinator(),
      bytes = new TextEncoder().encode('incoming sample'),
      sha = await sha256(bytes),
      downloading = deferred<void>(),
      release = deferred<void>()
    const source = {
      size: bytes.length,
      read: vi.fn(async () => {
        downloading.resolve()
        await release.promise
        if (outcome === 'offline') throw new EngineError('offline', 'Sample source unavailable')
        return bytes
      }),
      assertUnchanged: async () => {},
      close: vi.fn(async () => {}),
    }
    const getBlob = vi.fn(async () => bytes)
    const openVersion = vi.fn(async () => source)
    const placer = new PullPlacer(
      { getBlob, openVersion },
      coordinatedFileSystem(disk, locks),
      state,
      { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
      sha256
    )
    const change: ChangeItem = {
      seq: 1,
      file_id: 'sample-file',
      version_id: 'sample-version',
      path: 'Shared/sample.md',
      prev_path: null,
      op: 'create',
      kind: 'note',
      sha,
      size: bytes.length,
      mtime: 10,
      at: '2025-01-01T00:00:00Z',
      actor: { kind: 'system', id: 'sample', name: 'Sample' },
    }
    const placement = placer.place(change, sha, null, new Map(), new Map()).then(
      (result) => result,
      (error: unknown) => error
    )
    await downloading.promise
    let entered = false
    const other = locks.run([change.path], async () => {
      entered = true
      if (outcome === 'edited') {
        await app.vault.adapter.mkdir('Shared')
        await app.vault.adapter.write(change.path, 'local sample')
      }
    })
    try {
      await vi.waitFor(() => expect(entered).toBe(true), { timeout: 100 })
    } finally {
      release.resolve()
      await other
    }
    const result = await placement
    expect(getBlob).not.toHaveBeenCalled()
    expect(openVersion).toHaveBeenCalledTimes(1)
    expect(source.read).toHaveBeenCalledTimes(1)
    expect(source.close).toHaveBeenCalled()
    expect(app.loadLocalStorage(JOURNAL_KEY) ?? []).toEqual([])
    if (outcome === 'complete') {
      expect(result).toBe(true)
      expect(await disk.read(change.path)).toEqual(bytes)
      expect((await state.get(change.path))?.sha).toBe(sha)
    } else {
      expect(await state.get(change.path)).toBeNull()
      if (outcome === 'edited') {
        expect(result).toBe(false)
        expect(await app.vault.adapter.read(change.path)).toBe('local sample')
      } else {
        expect(result).toMatchObject({ code: 'offline' })
        expect(await disk.stat(change.path)).toBeNull()
      }
    }
  }
)

it('downloads a same-hash move with a missing local baseline before acquiring either path', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore(),
    locks = new PathCoordinator(),
    bytes = new TextEncoder().encode('sample'),
    sha = await sha256(bytes)
  const entry = {
    path: 'old.md',
    wirePath: 'old.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha,
    size: bytes.length,
    mtime: 10,
  }
  await state.put(entry) // The ledger survived, but its local file did not.
  const downloading = deferred<void>(),
    release = deferred<void>()
  const placer = new PullPlacer(
    {
      getBlob: async () => {
        downloading.resolve()
        await release.promise
        return bytes
      },
    },
    coordinatedFileSystem(disk, locks),
    state,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    sha256
  )
  const change: ChangeItem = {
    seq: 1,
    file_id: entry.fileId,
    version_id: 'moved',
    path: 'new.md',
    prev_path: entry.path,
    op: 'move',
    kind: 'note',
    sha,
    size: bytes.length,
    mtime: 10,
    at: '2025-01-01T00:00:00Z',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }
  const placement = placer.place(change, sha, entry, new Map(), new Map())
  await downloading.promise
  let entered = false
  const other = locks.run(['old.md', 'new.md'], async () => {
    entered = true
  })
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 100 })
  } finally {
    release.resolve()
    await Promise.all([placement, other])
  }
  expect(await disk.read('new.md')).toEqual(bytes)
})

it('does not reserve any placement path during later bounded push download runs', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore(),
    locks = new PathCoordinator()
  const original = new TextEncoder().encode('original'),
    incoming = new TextEncoder().encode('incoming')
  const sha = await sha256(original),
    remoteSha = await sha256(incoming)
  for (const name of ['one', 'two']) {
    await disk.writeAtomic(name + '.md', original, 10)
    await state.put({
      path: name + '.md',
      wirePath: name + '.md',
      fileId: name,
      versionId: 'base',
      sha,
      size: original.length,
      mtime: 10,
    })
  }
  await state.setJournal({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: ['one', 'two'].map((name) => ({
      op: 'modify',
      file_id: name,
      base_version_id: 'base',
      sha,
      size: original.length,
      mtime: 10,
    })),
  })
  const downloading = deferred<void>(),
    release = deferred<void>()
  let calls = 0
  const client = {
    hasBlob: async () => true,
    getBlob: async () => {
      if (++calls === 2) {
        downloading.resolve()
        await release.promise
      }
      return incoming
    },
    commitRaw: async () => ({
      replayed: true,
      body: {
        head_seq: 2,
        results: ['one', 'two'].map((name) => ({
          status: 'merged',
          file_id: name,
          version_id: 'received-' + name,
          path: name + '.md',
          sha: remoteSha,
          size: incoming.length,
          mtime: 20,
        })),
      },
    }),
  }
  const pending = resumeJournal(client as never, coordinatedFileSystem(disk, locks), state, {
    expected: new ExpectedWrites(),
    prefetchBytes: 1,
  })
  await downloading.promise
  let entered = false
  const other = locks.run(['one.md'], async () => {
    entered = true
  })
  try {
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 100 })
  } finally {
    release.resolve()
    await Promise.all([pending, other])
  }
  expect(await state.getJournal()).toBeNull()
  expect(await disk.read('two.md')).toEqual(incoming)
})
