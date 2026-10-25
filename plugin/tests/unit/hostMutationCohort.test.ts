import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { deferred } from '../helpers/deferred'

it.each([
  { paths: ['Notes'] },
  { paths: ['Notes/Sample.md'] },
  { paths: ['Notes/Sample.md', 'Other/Sample.md'] },
])(
  'durably invalidates $paths after an overlapping covering invalidation aborts',
  async ({ paths }) => {
    const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-pending-invalidation', local)
    const fingerprint = {
      identity: 'sample-inode',
      size: 1,
      mtime: 1,
      ctime: 1,
      sha: 'a'.repeat(64),
    }
    const path = 'Notes/Sample.md'
    await host.writeScanFingerprint(path, fingerprint)
    const db = Reflect.get(host, 'db') as IDBDatabase
    const transaction = db.transaction.bind(db)
    const writes: IDBTransaction[] = []
    let commits = 0
    const spy = vi.spyOn(db, 'transaction').mockImplementation((...args) => {
      const tx = transaction(...args)
      if (args[1] === 'readwrite') {
        writes.push(tx)
        tx.addEventListener('complete', () => commits++)
      }
      return tx
    })
    const outerWork = vi.fn(async () => {})
    const commitsAtWork: number[] = []
    const outer = host.withScanMutation(['Notes'], outerWork)
    void outer.catch(() => {})
    const inner = host.withScanMutation(paths, async () => {
      commitsAtWork.push(commits)
    })
    void inner.catch(() => {})
    try {
      // Both callers are registered before the first native invalidation can commit.
      // Abort the covering transaction, not a timer or a mocked persistence promise.
      writes[0]!.abort()
      await expect(outer).rejects.toThrow('invalidate scan fingerprints')
      await inner
      expect(outerWork).not.toHaveBeenCalled()
      expect(commitsAtWork).toEqual([1])
      expect(await host.readScanFingerprint(path)).toBeUndefined()
      expect((Reflect.get(host, 'scanMutations') as Map<string, number>).size).toBe(0)
    } finally {
      await Promise.allSettled([outer, inner])
      spy.mockRestore()
      host.close()
    }
  }
)

it('runs neither mutation when both overlapping invalidations abort', async () => {
  const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-aborted-invalidations', local)
  const path = 'Notes/Sample.md'
  const fingerprint = { identity: 'sample-inode', size: 1, mtime: 1, ctime: 1, sha: 'a'.repeat(64) }
  await host.writeScanFingerprint(path, fingerprint)
  const db = Reflect.get(host, 'db') as IDBDatabase
  const transaction = db.transaction.bind(db)
  const writes: IDBTransaction[] = []
  const spy = vi.spyOn(db, 'transaction').mockImplementation((...args) => {
    const tx = transaction(...args)
    if (args[1] === 'readwrite') writes.push(tx)
    return tx
  })
  const work = vi.fn(async () => {})
  const outer = host.withScanMutation(['Notes'], work)
  const inner = host.withScanMutation([path], work)
  const settled = Promise.allSettled([outer, inner])
  try {
    for (const tx of writes) tx.abort()
    expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(work).not.toHaveBeenCalled()
    expect(await host.readScanFingerprint(path)).toEqual(fingerprint)
  } finally {
    await settled
    spy.mockRestore()
    host.close()
  }
})

it('shares a durable invalidation without ending an overlapping writer fence early', async () => {
  const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-mutation', local)
  const db = Reflect.get(host, 'db') as IDBDatabase
  const transaction = db.transaction.bind(db)
  let commits = 0
  db.transaction = ((...args: Parameters<typeof db.transaction>) => {
    const tx = transaction(...args)
    if (args[1] === 'readwrite') tx.addEventListener('complete', () => commits++)
    return tx
  }) as typeof db.transaction
  const path = 'Notes/Sample.md',
    entered = deferred<void>(),
    finish = deferred<void>()
  const fingerprint = { identity: 'sample-inode', size: 1, mtime: 1, ctime: 1, sha: 'a'.repeat(64) }
  let inner: Promise<void> | undefined
  try {
    await host.withScanMutation(['Notes'], async () => {
      inner = host.withScanMutation([path], async () => {
        entered.resolve()
        await finish.promise
      })
      await entered.promise
    })
    expect(commits).toBe(1)
    // The inner writer outlives the outer cohort. No cache may revive yet.
    await host.writeScanFingerprint(path, fingerprint)
    expect(await host.readScanFingerprint(path)).toBeUndefined()
    finish.resolve()
    await inner
    await host.writeScanFingerprint(path, fingerprint)
    expect(await host.readScanFingerprint(path)).toEqual(fingerprint)
    expect(commits).toBe(2)
  } finally {
    finish.resolve()
    await inner
    host.close()
  }
})

it('bounds mutation revisions without reviving a fingerprint captured before eviction', async () => {
  const local = { loadLocalStorage: () => null, saveLocalStorage: () => {} }
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-revisions', local)
  try {
    const revision = host.scanFingerprintRevision('Anchor.md')
    await host.withScanMutation(['Notes'], async () => {
      for (let i = 0; i < 5000; i++)
        await host.withScanMutation([`Notes/Sample ${i}.md`], async () => {})
    })
    expect((Reflect.get(host, 'scanRevisions') as Map<string, number>).size).toBeLessThanOrEqual(
      4096
    )
    const fingerprint = {
      identity: 'sample-inode',
      size: 1,
      mtime: 1,
      ctime: 1,
      sha: 'a'.repeat(64),
    }
    await host.writeScanFingerprint('Anchor.md', fingerprint, revision)
    expect(await host.readScanFingerprint('Anchor.md')).toBeUndefined()
    await host.writeScanFingerprint('Anchor.md', fingerprint)
    expect(await host.readScanFingerprint('Anchor.md')).toEqual(fingerprint)
  } finally {
    host.close()
  }
})
