// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBDatabase } from 'fake-indexeddb'
import {
  MemoryFileSystem,
  ExpectedWrites,
  pull,
  sha256,
  type EngineClient,
  type FileSystem,
} from '@abele/sync-sdk/core'
import { PendingPullWrites } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullWrite.js'
import { recoverPendingPullWrites } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullRecovery.js'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

const change = (i: number) => ({
  seq: i + 1,
  op: 'create' as const,
  file_id: `file-${i}`,
  version_id: `version-${i}`,
  path: `Notes/sample-${i}.md`,
  sha: 'a'.repeat(64),
  size: 1,
  mtime: 1,
})
const entry = (i: number) => ({
  path: change(i).path,
  wirePath: change(i).path,
  fileId: change(i).file_id,
  versionId: change(i).version_id,
  sha: change(i).sha,
  size: 1,
  mtime: 1,
})

it.each([false, true])(
  'retires an adopted stage before requiring replay ports (client=%s)',
  async (withClient) => {
    const state = await IndexedDbStateStore.open(new IDBFactory(), `sample-adoption-${withClient}`)
    const bytes = new TextEncoder().encode('sample installed payload')
    const adopted = { ...change(0), sha: await sha256(bytes), size: bytes.length }
    const discardStage = vi.fn(async () => {})
    const reopenStage = vi.fn(async () => ({ installed: async () => true }))
    const fs = Object.assign(new MemoryFileSystem(), { discardStage, reopenStage })
    const getBlob = vi.fn(async () => {
      throw new Error('unexpected replay')
    })
    try {
      await fs.writeAtomic(adopted.path, bytes, adopted.mtime)
      await new PendingPullWrites(state, fs as unknown as FileSystem).prepare(
        adopted,
        null,
        adopted.path,
        null,
        'sample-adopted-stage'
      )
      for (let attempt = 0; attempt < 2; attempt++) {
        await recoverPendingPullWrites(
          fs as unknown as FileSystem,
          state,
          [adopted.file_id],
          withClient ? { getBlob } : undefined
        )
        expect(await state.getMeta(`pull-write:${adopted.file_id}`)).toBeNull()
        expect(await state.getMeta('pull-cleanup-head')).toBeNull()
        expect(await state.byFileId(adopted.file_id)).toMatchObject({
          sha: adopted.sha,
          path: adopted.path,
        })
      }
      expect(discardStage).toHaveBeenCalledExactlyOnceWith('sample-adopted-stage')
      expect(getBlob).not.toHaveBeenCalled()
    } finally {
      state.close()
    }
  }
)

it('acknowledges 32 cleanup owners and retained aliases in one final IDB batch', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-pre2-batch')
  const discardStage = vi.fn(async () => {})
  const fs = Object.assign(new MemoryFileSystem(), { discardStage })
  const pending = new PendingPullWrites(state, fs)
  try {
    for (let i = 0; i < 32; i++)
      await pending.prepare(change(i), null, change(i).path, null, `stage-${i}`)
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction')
    try {
      await state.transaction(async (tx) => {
        for (let i = 0; i < 32; i++) {
          await tx.put(entry(i))
          await pending.publishCleanup(tx, change(i))
        }
        await pending.settled(change(0))
        expect(discardStage).not.toHaveBeenCalled()
      })
      expect(await state.getMeta('pull-cleanup-head')).not.toBeNull()
      for (let i = 0; i < 32; i++) {
        expect(JSON.parse((await state.getMeta(`pull-write:file-${i}`))!)).toMatchObject({
          retiring: true,
          stageId: `stage-${i}`,
        })
        await pending.settled(change(i))
      }
      expect(discardStage).toHaveBeenCalledTimes(32)
      await pending.flushCleanup()
      expect(await state.getMeta('pull-cleanup-head')).toBeNull()
      expect(await state.metadataKeys('pull-write:')).toEqual([])
      expect(await state.metadataKeys('pull-cleanup:')).toEqual([])
      expect(transactions.mock.calls.filter((call) => call[1] === 'readwrite')).toHaveLength(2)
    } finally {
      transactions.mockRestore()
    }
  } finally {
    state.close()
  }
})

it('keeps cleanup bytes after nested success and outer abort, then acknowledges the same owner once', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-pre2-rollback')
  const discardStage = vi.fn(async () => {})
  const fs = Object.assign(new MemoryFileSystem(), { discardStage })
  const pending = new PendingPullWrites(state, fs)
  try {
    await pending.prepare(change(0), null, change(0).path, null, 'sample-stage')
    await expect(
      state.transaction(async (outer) => {
        await outer.transaction(async (tx) => {
          await tx.put(entry(0))
          await pending.publishCleanup(tx, change(0))
        })
        await pending.settled(change(0))
        expect(discardStage).not.toHaveBeenCalled()
        throw new Error('sample outer abort')
      })
    ).rejects.toThrow('sample outer abort')
    expect(await state.getMeta('pull-cleanup-head')).toBeNull()
    await state.transaction(async (tx) => {
      await tx.put(entry(0))
      await pending.publishCleanup(tx, change(0))
    })
    await pending.settled(change(0))
    await pending.flushCleanup()
    expect(discardStage).toHaveBeenCalledExactlyOnceWith('sample-stage')
    expect(await state.getMeta('pull-write:file-0')).toBeNull()
  } finally {
    state.close()
  }
})

it('defers direct cleanup replay in a raw outer transaction until durable acknowledgement', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-pre2-direct')
  const discardStage = vi.fn(async () => {})
  const fs = Object.assign(new MemoryFileSystem(), { discardStage })
  const pending = new PendingPullWrites(state, fs)
  try {
    await state.setCursor(1)
    const client = {
      changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    } as unknown as EngineClient
    const options = {
      filter: { excluded: () => false },
      dirty: new Set<string>(),
      expected: new ExpectedWrites(),
      log: () => {},
    }
    await pending.prepare(change(0), null, change(0).path, null, 'sample-stage')
    await state.transaction(async (tx) => {
      await tx.put(entry(0))
      await pending.publishCleanup(tx, change(0))
    })
    await expect(
      state.transaction(async (tx) => {
        await pull(client, fs, tx, options)
        expect(discardStage).not.toHaveBeenCalled()
        throw new Error('sample replay abort')
      })
    ).rejects.toThrow('sample replay abort')
    await pull(client, fs, state, options)
    expect(discardStage).toHaveBeenCalledExactlyOnceWith('sample-stage')
    expect(await state.getMeta('pull-cleanup-head')).toBeNull()
  } finally {
    state.close()
  }
})
