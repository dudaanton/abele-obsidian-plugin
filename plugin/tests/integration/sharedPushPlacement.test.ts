import { expect, it } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  ExpectedWrites,
  resumeJournal,
  sha256,
} from '@abele/sync-sdk/core'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { deferred } from '../helpers/deferred'

it('keeps the personal push verdict lease until the journal-clearing transaction commits', async () => {
  const disk = new MemoryFileSystem(),
    state = new MemoryStateStore(),
    locks = new PathCoordinator()
  const bytes = new TextEncoder().encode('sample'),
    sha = await sha256(bytes)
  await disk.writeAtomic('sample.md', bytes, 10)
  await state.put({
    path: 'sample.md',
    wirePath: 'sample.md',
    fileId: 'sample-file',
    versionId: 'base',
    sha,
    size: bytes.length,
    mtime: 10,
  })
  await state.setJournal({
    batchId: 'sample-batch',
    idempotencyKey: 'sample-request',
    startedAt: new Date().toISOString(),
    ops: [
      {
        op: 'modify',
        file_id: 'sample-file',
        base_version_id: 'base',
        sha,
        size: bytes.length,
        mtime: 10,
      },
    ],
  })
  const committing = deferred<void>(),
    commit = deferred<void>(),
    transaction = state.transaction.bind(state)
  state.transaction = async (work) => {
    const result = await transaction(work)
    committing.resolve()
    await commit.promise
    return result
  }
  const client = {
    hasBlob: async () => true,
    commitRaw: async () => ({
      replayed: true,
      body: {
        head_seq: 1,
        results: [
          {
            status: 'applied',
            file_id: 'sample-file',
            version_id: 'settled',
            path: 'sample.md',
            sha,
            size: bytes.length,
            mtime: 10,
          },
        ],
      },
    }),
  }
  const pending = resumeJournal(client as never, coordinatedFileSystem(disk, locks), state, {
    expected: new ExpectedWrites(),
  })
  const result = pending.catch((error) => {
    committing.reject(error)
    throw error
  })
  void result.catch(() => {})
  await committing.promise
  let entered = false
  const competing = locks.run(['sample.md'], async () => {
    entered = true
  })
  await Promise.resolve()
  expect(entered).toBe(false)
  commit.resolve()
  expect((await result)?.applied).toBe(1)
  await competing
  expect(await state.getJournal()).toBeNull()
})
