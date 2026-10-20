import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { EditCopies } from '@/sync/editCopies'
import { registerDurableEditCopies, registerConnectionEditCopies } from '@/sync/editCopyStore'

it('persists independently of engine transactions and reopens only the destination-bound outbox', async () => {
  const factory = new IDBFactory(),
    copies = new EditCopies(),
    base = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  copies.expect(['sample-connection'])
  await fs.writeAtomic('sample.md', new Uint8Array([1, 2, 3]), 10)
  let opened = await registerDurableEditCopies(
    factory,
    copies,
    'sample-connection',
    'sample-ledger',
    base,
    () => true
  )
  await copies.capture(fs, ['sample.md'])
  opened.close()
  opened = await registerDurableEditCopies(
    factory,
    copies,
    'sample-connection',
    'sample-ledger',
    base,
    () => true
  )
  try {
    expect((await copies.list(opened.store))[0].bytes).toEqual([1, 2, 3])
  } finally {
    opened.close()
  }
  await expect(
    registerDurableEditCopies(
      factory,
      copies,
      'sample-connection',
      'another-ledger',
      base,
      () => true
    )
  ).rejects.toThrow(/identity|binding|recovery/i)
})

it('keeps predecessor copies isolated when the same local record is explicitly re-enrolled', async () => {
  const factory = new IDBFactory(),
    copies = new EditCopies(),
    base = new MemoryStateStore(),
    fs = new MemoryFileSystem()
  copies.expect(['sample-connection'])
  await fs.writeAtomic('sample.md', new Uint8Array([1]), 10)
  const old = await registerConnectionEditCopies(
    factory,
    copies,
    'sample-connection',
    'old-binding',
    base,
    () => true
  )
  await copies.capture(fs, ['sample.md'])
  old.close()
  const next = await registerConnectionEditCopies(
    factory,
    copies,
    'sample-connection',
    'new-binding',
    base,
    () => true
  )
  expect(await copies.list(next.store)).toEqual([])
  next.close()
  const retained = await registerConnectionEditCopies(
    factory,
    copies,
    'sample-connection',
    'old-binding',
    base,
    () => true
  )
  try {
    expect((await copies.list(retained.store))[0].bytes).toEqual([1])
  } finally {
    retained.close()
  }
})
