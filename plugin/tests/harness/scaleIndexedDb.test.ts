// @vitest-environment node
import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { exportDatabase } from '../scale/indexeddb.cjs'

it('exports all persisted rows including pending journals without changing the ledger', async () => {
  const factory = new IDBFactory()
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('sample-ledger', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('entries')
      request.result.createObjectStore('meta')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const journal = { pending: [{ path: 'Sample/file.bin', stage: '.sync-private/sample.part' }] }
  const tx = db.transaction(['entries', 'meta'], 'readwrite')
  tx.objectStore('entries').put({ path: 'Sample/file.bin', bytes: new Uint8Array([3, 7]) }, 'file')
  tx.objectStore('meta').put(journal, 'journal')
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error)
  })
  db.close()
  const rows: unknown[] = []
  const summary = await exportDatabase(factory, 'sample-ledger', (row) => rows.push(row))
  expect(summary).toMatchObject({ name: 'sample-ledger', counts: { entries: 1, meta: 1 } })
  expect(rows).toContainEqual({ store: 'meta', key: 'journal', value: journal })
  expect(rows).toContainEqual({
    store: 'entries',
    key: 'file',
    value: { path: 'Sample/file.bin', bytes: new Uint8Array([3, 7]) },
  })
  const again: unknown[] = []
  await exportDatabase(factory, 'sample-ledger', (row) => again.push(row))
  expect(again).toEqual(rows)
  await expect(exportDatabase(factory, 'missing-ledger', () => {})).rejects.toThrow(
    'does not exist'
  )
  expect((await factory.databases()).map((one) => one.name)).toEqual(['sample-ledger'])
  await expect(
    exportDatabase(factory, 'sample-ledger', () => {
      throw new Error('sample output failure')
    })
  ).rejects.toThrow('sample output failure')
})
