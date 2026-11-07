import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { countTransactions } from '../helpers/nativeRestartVault'
import { completion, wait } from '@/sync/idbRequests'

it.each([32, 2048])(
  'does not reload a %i-folder document per file during a pull',
  async (folders) => {
    const factory = new IDBFactory()
    countTransactions(factory)
    const state = await IndexedDbStateStore.open(factory, 'sample-directory-cost')
    const value = JSON.stringify({
      directories: Array.from({ length: folders }, (_, n) => ({ path: `Sample/Folder ${n}` })),
    })
    await state.setMeta('v2-directories', value)
    let largeReads = 0
    const get = IDBObjectStore.prototype.get
    const probe = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (
      this: IDBObjectStore,
      key
    ) {
      if (this.name === 'meta' && key === 'plugin:v2-directories') largeReads++
      return get.call(this, key)
    })
    try {
      for (let file = 0; file < 64; file++) {
        await state.transaction(async (tx) => {
          for (let check = 0; check < 12; check++)
            expect(await tx.getMeta('v2-directories')).toBe(value)
          await tx.setMeta(`sample-file:${file}`, 'verified')
          await tx.setCursor(file + 1)
          await tx.put({
            path: `Sample/file-${file}.md`,
            wirePath: `Sample/file-${file}.md`,
            fileId: `sample-${file}`,
            versionId: `version-${file}`,
            sha: 'a'.repeat(64),
            size: 4,
            mtime: 1,
          })
        })
        for (let check = 0; check < 4; check++)
          expect(await state.getMeta('v2-directories')).toBe(value)
      }
      expect(
        largeReads,
        'unchanged document bytes are loaded once, independently of file count'
      ).toBe(1)
    } finally {
      probe.mockRestore()
      state.close()
    }
  }
)

it('observes foreign commits, overlay writes, deletion and rollback without stale directory data', async () => {
  const factory = new IDBFactory()
  const first = await IndexedDbStateStore.open(factory, 'sample-directory-coherence')
  const second = await IndexedDbStateStore.open(factory, 'sample-directory-coherence')
  try {
    await first.setMeta('v2-directories', 'first')
    expect(await first.getMeta('v2-directories')).toBe('first')
    await second.setMeta('v2-directories', 'second')
    await first.setMeta('sample-unrelated', 'own write after a foreign commit')
    expect(await first.getMeta('v2-directories')).toBe('second')
    const updating = second.setMeta('v2-directories', 'queued')
    const reading = first.getMeta('v2-directories')
    await updating
    expect(await reading).toBe('queued')
    await expect(
      first.transaction(async (tx) => {
        await tx.setMeta('v2-directories', 'aborted')
        expect(await tx.getMeta('v2-directories')).toBe('aborted')
        throw new Error('sample rollback')
      })
    ).rejects.toThrow('sample rollback')
    expect(await first.getMeta('v2-directories')).toBe('queued')
    await first.transaction(async (tx) => {
      await tx.setMeta('v2-directories', 'third')
      expect(await tx.getMeta('v2-directories')).toBe('third')
    })
    expect(await first.getMeta('v2-directories')).toBe('third')
    await second.setMeta('v2-directories', null)
    expect(await first.getMeta('v2-directories')).toBeNull()
  } finally {
    first.close()
    second.close()
  }
})

it('validates directory values after an unknown writer advances the durable revision', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-directory-invalid')
  try {
    await state.setMeta('v2-directories', 'verified')
    expect(await state.getMeta('v2-directories')).toBe('verified')
    const db = Reflect.get(state, 'db') as IDBDatabase
    const tx = db.transaction('meta', 'readwrite')
    const done = completion(tx, 'sample external writer')
    const meta = tx.objectStore('meta')
    const row = await wait<{ value: number }>(meta.get('revision'))
    await wait(meta.put({ key: 'plugin:v2-directories', value: 42 }))
    await wait(meta.put({ key: 'revision', value: row.value + 1 }))
    await done
    await expect(state.getMeta('v2-directories')).rejects.toThrow('not a string')
  } finally {
    state.close()
  }
})
