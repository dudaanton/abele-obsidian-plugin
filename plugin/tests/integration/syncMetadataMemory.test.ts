// @vitest-environment node
import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { HostScanCache } from '@/sync/hostScanCache'
import { openHostDatabase, STORE } from '@/sync/hostSyncSchema'
import { completion } from '@/sync/idbRequests'
import { collectHeap } from '../helpers/collectHeap'

const count = 33000
const pathOf = (i: number) =>
  `Shared/Section ${i % 64}/` + 'Nested sample/'.repeat(6) + `File ${i}.md`

it('keeps 33000 ledger rows and scan fingerprints within the metadata heap budget', async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  const factory = new IDBFactory()
  const state = await IndexedDbStateStore.open(factory, 'sample-memory-ledger')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('sample-memory-ledger', 3)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const host = await openHostDatabase(factory)
  try {
    // Seed durable storage before measuring: fake-indexeddb's backing tree is a fixture,
    // not renderer-side ledger retention. Unique flattened strings model native clones.
    const ledgerTx = db.transaction('entries', 'readwrite')
    const hostTx = host.transaction(STORE, 'readwrite')
    const done = Promise.all([completion(ledgerTx, 'seed ledger'), completion(hostTx, 'seed host')])
    for (let i = 0; i < count; i++) {
      const path = pathOf(i)
      const sha = createHash('sha256').update(String(i)).digest('hex')
      ledgerTx.objectStore('entries').put({
        path,
        wirePath: path,
        fileId: `sample-file-${i}`,
        versionId: `sample-version-${i}`,
        sha,
        size: 4096,
        mtime: 1000,
        ctime: 900,
      })
      hostTx.objectStore(STORE).put({
        namespace: 'sample',
        key: '!scan-fingerprint-v1:' + path,
        value: { identity: `sample-device:${i}`, sha, size: 4096, mtime: 1000, ctime: 900 },
      })
    }
    await done
    const cache = new HostScanCache(host, 'sample')
    await collectHeap()
    const before = process.memoryUsage().heapUsed
    let ledgerBytes = 0,
      fingerprintBytes = 0
    await Reflect.get(state, Symbol.for('abele.sync.normalization-pass-v1')).call(
      state,
      async () => {
        let rows = 0
        for await (const _entry of state.all()) rows++
        expect(rows).toBe(count)
        // Materialize the production pass index, including its path lookup map.
        expect((await state.get(pathOf(count - 1)))?.fileId).toBe(`sample-file-${count - 1}`)
        await collectHeap()
        ledgerBytes = process.memoryUsage().heapUsed - before
        const snapshot = await cache.readScanFingerprints()
        await collectHeap()
        fingerprintBytes = process.memoryUsage().heapUsed - before - ledgerBytes
        expect(snapshot.rows.size).toBe(count)
        expect(cache.scanFingerprintFromSnapshot(pathOf(0), snapshot)?.size).toBe(4096)
        expect(ledgerBytes + fingerprintBytes).toBeLessThan(64 * 1024 * 1024)
      }
    )
    await collectHeap()
    const settledBytes = process.memoryUsage().heapUsed - before
    console.info('sync metadata memory model', {
      count,
      ledgerBytes,
      fingerprintBytes,
      bytesPerFile: (ledgerBytes + fingerprintBytes) / count,
      settledBytes,
    })
    expect(settledBytes).toBeLessThan(4 * 1024 * 1024)
  } finally {
    state.close()
    db.close()
    host.close()
    vi.unstubAllGlobals()
  }
}, 60000)
