import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { deferred } from '../helpers/deferred'

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
