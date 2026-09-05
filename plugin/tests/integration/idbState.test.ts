import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { Journal, StateEntry } from '@abele/sync-core'
import { IndexedDbStateStore, stateDatabaseName } from '@/sync/IndexedDbStateStore'

/**
 * The contract every `StateStore` is held to — the cases the memory store and the daemon's
 * SQLite store are held to, asked of the plugin's — plus what is particular to this one: the
 * overlay `transaction` is built on, and a database that outlives the object holding it.
 *
 * A fresh `IDBFactory` per test, so no two tests share a database and none has to clean up.
 */

const NAME = stateDatabaseName('vault-1')

const entry = (over: Partial<StateEntry> = {}): StateEntry => ({
  path: 'notes/a.md',
  wirePath: 'notes/a.md',
  fileId: 'file-1',
  versionId: 'ver-1',
  sha: 'a'.repeat(64),
  size: 5,
  mtime: 1000,
  ...over,
})

const journal = (over: Partial<Journal> = {}): Journal => ({
  batchId: 'batch-1',
  ops: [{ op: 'delete', file_id: 'file-1', base_version_id: 'ver-1' }],
  idempotencyKey: 'key-1',
  startedAt: '2026-09-05T00:00:00.000Z',
  ...over,
})

async function collect(store: IndexedDbStateStore): Promise<StateEntry[]> {
  const found: StateEntry[] = []
  for await (const e of store.all()) found.push(e)
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

let indexedDB: IDBFactory
let store: IndexedDbStateStore

beforeEach(async () => {
  indexedDB = new IDBFactory()
  store = await IndexedDbStateStore.open(indexedDB, NAME)
})

afterEach(() => {
  store.close()
})

describe('IndexedDbStateStore', () => {
  it('names one database per vault', () => {
    expect(stateDatabaseName('abc')).toBe('abele-sync-abc')
  })

  it('gets nothing before anything is put', async () => {
    expect(await store.get('notes/a.md')).toBeNull()
    expect(await store.byFileId('file-1')).toBeNull()
    expect(await collect(store)).toEqual([])
  })

  it('puts an entry and finds it by path and by fileId', async () => {
    const a = entry()
    await store.put(a)
    expect(await store.get('notes/a.md')).toEqual(a)
    expect(await store.byFileId('file-1')).toEqual(a)
    expect(await collect(store)).toEqual([a])
  })

  it('upserts by path rather than adding a second row', async () => {
    await store.put(entry())
    await store.put(entry({ versionId: 'ver-2', sha: 'b'.repeat(64), size: 9, mtime: 2000 }))
    expect(await collect(store)).toHaveLength(1)
    expect(await store.get('notes/a.md')).toMatchObject({ versionId: 'ver-2', size: 9 })
    expect(await store.byFileId('file-1')).toMatchObject({ versionId: 'ver-2' })
  })

  it('re-files a fileId under its new path and drops the row it left', async () => {
    await store.put(entry())
    const moved = entry({ path: 'notes/b.md', wirePath: 'notes/b.md', versionId: 'ver-2' })
    await store.put(moved)
    expect(await store.byFileId('file-1')).toEqual(moved)
    expect(await store.get('notes/a.md')).toBeNull()
    expect(await collect(store)).toEqual([moved])
  })

  it('keeps one row per wirePath, whatever fileId claims it', async () => {
    await store.put(entry({ path: 'Note.md', wirePath: 'Note.md' }))
    const other = entry({ path: 'nfd.md', wirePath: 'Note.md', fileId: 'file-2' })
    await store.put(other)
    expect(await collect(store)).toEqual([other])
    expect(await store.byFileId('file-1')).toBeNull()
  })

  it('clears the fileId index on delete, and deleting a missing path is not an error', async () => {
    await store.put(entry())
    await store.delete('notes/a.md')
    expect(await store.get('notes/a.md')).toBeNull()
    expect(await store.byFileId('file-1')).toBeNull()
    expect(await collect(store)).toEqual([])
    await expect(store.delete('notes/a.md')).resolves.toBeUndefined()
  })

  it('round-trips the cursor, starting at zero', async () => {
    expect(await store.getCursor()).toBe(0)
    await store.setCursor(42)
    expect(await store.getCursor()).toBe(42)
  })

  it('round-trips the journal and clears it with null', async () => {
    expect(await store.getJournal()).toBeNull()
    const j = journal()
    await store.setJournal(j)
    expect(await store.getJournal()).toEqual(j)
    await store.setJournal(null)
    expect(await store.getJournal()).toBeNull()
  })

  it("keeps the plugin's own meta apart from the cursor and the journal", async () => {
    expect(await store.getMeta('selective')).toBeNull()
    await store.setMeta('selective', 'abc')
    expect(await store.getMeta('selective')).toBe('abc')
    // A plugin key spelled like an engine key reaches neither the cursor nor the journal.
    await store.setMeta('cursor', '99')
    await store.setMeta('journal', '{}')
    expect(await store.getCursor()).toBe(0)
    expect(await store.getJournal()).toBeNull()
    await store.setMeta('selective', null)
    expect(await store.getMeta('selective')).toBeNull()
  })

  /**
   * Copying is asserted **inside a transaction**. Outside one every value crosses IndexedDB's
   * structured clone, which would hide a store that handed out its own objects; the overlay
   * holds the very objects the caller passed and read, so this is where copying is real work.
   */
  it('hands out copies of entries, and keeps a copy of the one it was given', async () => {
    await store.put(entry())
    await store.transaction(async () => {
      const given = entry({ versionId: 'ver-2' })
      await store.put(given)
      given.sha = 'f'.repeat(64)
      const byPath = await store.get('notes/a.md')
      byPath!.sha = 'c'.repeat(64)
      const byId = await store.byFileId('file-1')
      byId!.sha = 'd'.repeat(64)
      for await (const each of store.all()) each.sha = 'e'.repeat(64)
      expect(await store.get('notes/a.md')).toEqual(entry({ versionId: 'ver-2' }))
      expect(await store.byFileId('file-1')).toEqual(entry({ versionId: 'ver-2' }))
    })
    expect(await store.get('notes/a.md')).toEqual(entry({ versionId: 'ver-2' }))
    // And the same outside one, where the clone does the work rather than the store.
    const byPath = await store.get('notes/a.md')
    byPath!.sha = 'c'.repeat(64)
    expect(await store.get('notes/a.md')).toEqual(entry({ versionId: 'ver-2' }))
  })

  it('copies the journal out, ops and all, and copies the one it was given in', async () => {
    await store.transaction(async () => {
      const given = journal()
      await store.setJournal(given)
      given.ops.push({ op: 'delete', file_id: 'file-9', base_version_id: 'ver-9' })
      given.batchId = 'batch-9'
      const fetched = await store.getJournal()
      expect(fetched).toEqual(journal())
      fetched!.ops.push({ op: 'delete', file_id: 'file-2', base_version_id: 'ver-2' })
      fetched!.batchId = 'batch-2'
      expect(await store.getJournal()).toEqual(journal())
    })
    expect(await store.getJournal()).toEqual(journal())
  })

  it('keeps everything across a close and a reopen', async () => {
    await store.put(entry())
    await store.setCursor(7)
    await store.setJournal(journal())
    await store.setMeta('scope', 'notes')
    store.close()

    store = await IndexedDbStateStore.open(indexedDB, NAME)
    expect(await collect(store)).toEqual([entry()])
    expect(await store.byFileId('file-1')).toEqual(entry())
    expect(await store.getCursor()).toBe(7)
    expect(await store.getJournal()).toEqual(journal())
    expect(await store.getMeta('scope')).toBe('notes')
  })

  it('gives two vaults two databases that share nothing', async () => {
    const other = await IndexedDbStateStore.open(indexedDB, stateDatabaseName('vault-2'))
    try {
      await store.put(entry())
      await store.setCursor(7)
      expect(await collect(other)).toEqual([])
      expect(await other.getCursor()).toBe(0)

      await other.put(entry({ path: 'other.md', wirePath: 'other.md', fileId: 'file-2' }))
      expect(await collect(store)).toEqual([entry()])
    } finally {
      other.close()
    }
  })

  it('forgets a vault, and opening its name again starts empty', async () => {
    await store.put(entry())
    await store.setCursor(7)
    store.close()
    await IndexedDbStateStore.delete(indexedDB, NAME)

    store = await IndexedDbStateStore.open(indexedDB, NAME)
    expect(await collect(store)).toEqual([])
    expect(await store.getCursor()).toBe(0)
  })

  it('gives up on a delete a connection will not let through', async () => {
    // A raw connection that ignores `versionchange` is what another window running an older
    // build looks like; the store's own connections close themselves and never block.
    const holder = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await expect(IndexedDbStateStore.delete(indexedDB, NAME, 10)).rejects.toMatchObject({
        code: 'io',
      })
    } finally {
      holder.close()
    }
  })

  it('reports a closed database as an io error rather than a driver one', async () => {
    store.close()
    await expect(store.get('notes/a.md')).rejects.toMatchObject({ code: 'io' })
    await expect(store.put(entry())).rejects.toMatchObject({ code: 'io' })
    await expect(store.getCursor()).rejects.toMatchObject({ code: 'io' })
    await expect(
      store.transaction(async () => {
        await store.setCursor(1)
      })
    ).rejects.toMatchObject({ code: 'io' })
    store = await IndexedDbStateStore.open(indexedDB, NAME)
  })

  describe('transaction', () => {
    it('runs the callback and returns its value, committing what it wrote', async () => {
      const result = await store.transaction(async () => {
        await store.put(entry())
        await store.setCursor(7)
        return 'done'
      })
      expect(result).toBe('done')
      expect(await store.get('notes/a.md')).toEqual(entry())
      expect(await store.getCursor()).toBe(7)
    })

    it('rolls every change back when the transaction throws', async () => {
      await store.put(entry())
      await store.setCursor(3)
      await store.setJournal(journal())

      const boom = new Error('boom')
      await expect(
        store.transaction(async () => {
          await store.put(entry({ path: 'notes/b.md', wirePath: 'notes/b.md', fileId: 'file-2' }))
          await store.delete('notes/a.md')
          await store.setCursor(99)
          await store.setJournal(null)
          throw boom
        })
      ).rejects.toBe(boom)

      expect(await collect(store)).toEqual([entry()])
      expect(await store.byFileId('file-1')).toEqual(entry())
      expect(await store.byFileId('file-2')).toBeNull()
      expect(await store.getCursor()).toBe(3)
      expect(await store.getJournal()).toEqual(journal())
    })

    it('writes nothing to the database until the callback returns', async () => {
      // A second connection to the same database is the only witness that can tell an overlay
      // from a write: it sees the store's committed rows and nothing of its overlay.
      const witness = await IndexedDbStateStore.open(indexedDB, NAME)
      try {
        await store.transaction(async () => {
          await store.put(entry())
          await store.setCursor(7)
          expect(await witness.get('notes/a.md')).toBeNull()
          expect(await witness.getCursor()).toBe(0)
        })
        expect(await witness.get('notes/a.md')).toEqual(entry())
        expect(await witness.getCursor()).toBe(7)
      } finally {
        witness.close()
      }
    })

    it('reads inside the transaction see what the transaction wrote', async () => {
      await store.put(entry())
      await store.setCursor(1)
      await store.transaction(async () => {
        const moved = entry({ path: 'notes/b.md', wirePath: 'notes/b.md', versionId: 'ver-2' })
        await store.put(moved)
        await store.setCursor(2)
        await store.setJournal(journal())
        await store.setMeta('scope', 'notes')

        expect(await store.get('notes/b.md')).toEqual(moved)
        // The put re-filed `file-1`, so the row it left is gone to every read here too.
        expect(await store.get('notes/a.md')).toBeNull()
        expect(await store.byFileId('file-1')).toEqual(moved)
        expect(await collect(store)).toEqual([moved])
        expect(await store.getCursor()).toBe(2)
        expect(await store.getJournal()).toEqual(journal())
        expect(await store.getMeta('scope')).toBe('notes')
      })
      expect(await collect(store)).toEqual([
        entry({ path: 'notes/b.md', wirePath: 'notes/b.md', versionId: 'ver-2' }),
      ])
    })

    it('all() inside the transaction hides what it deleted and shows what it added', async () => {
      await store.put(entry())
      await store.put(entry({ path: 'notes/b.md', wirePath: 'notes/b.md', fileId: 'file-2' }))
      await store.transaction(async () => {
        await store.delete('notes/a.md')
        await store.put(entry({ path: 'notes/c.md', wirePath: 'notes/c.md', fileId: 'file-3' }))
        expect((await collect(store)).map((e) => e.path)).toEqual(['notes/b.md', 'notes/c.md'])
      })
      expect((await collect(store)).map((e) => e.path)).toEqual(['notes/b.md', 'notes/c.md'])
    })

    it('runs a nested transaction inside the outer one, committing once', async () => {
      await store.transaction(async () => {
        await store.put(entry())
        await store.transaction(async () => {
          await store.setCursor(5)
          // Still nothing written: the inner transaction commits nothing of its own.
          expect(await store.getCursor()).toBe(5)
        })
        expect(await store.get('notes/a.md')).toEqual(entry())
      })
      expect(await store.get('notes/a.md')).toEqual(entry())
      expect(await store.getCursor()).toBe(5)
    })

    it('rolls the outer transaction back when a nested one throws through it', async () => {
      const boom = new Error('boom')
      await expect(
        store.transaction(async () => {
          await store.put(entry())
          await store.transaction(async () => {
            await store.setCursor(5)
            throw boom
          })
        })
      ).rejects.toBe(boom)
      expect(await collect(store)).toEqual([])
      expect(await store.getCursor()).toBe(0)
    })

    it('keeps the writes of a nested transaction whose failure the caller swallowed', async () => {
      // The daemon's SQLite store behaves the same way: nesting is counted, not saved. The
      // engine lets every failure out, which is what makes that safe.
      await store.transaction(async () => {
        try {
          await store.transaction(async () => {
            await store.setCursor(5)
            throw new Error('boom')
          })
        } catch {
          /* swallowed on purpose */
        }
      })
      expect(await store.getCursor()).toBe(5)
    })

    it('lets a batch swap two names over, keeping both files', async () => {
      // The pusher writes a rename as `delete` the old path, `put` the new one, in one
      // transaction. Two files exchanging names is the case where the database's own answer
      // to "who holds file-1?" is stale, and believing it used to lose one of the two rows.
      await store.put(entry({ path: 'A.md', wirePath: 'A.md', fileId: 'file-1' }))
      await store.put(entry({ path: 'B.md', wirePath: 'B.md', fileId: 'file-2' }))
      await store.transaction(async () => {
        await store.delete('A.md')
        await store.put(entry({ path: 'B.md', wirePath: 'B.md', fileId: 'file-1' }))
        await store.put(entry({ path: 'A.md', wirePath: 'A.md', fileId: 'file-2' }))
      })
      expect(await collect(store)).toEqual([
        entry({ path: 'A.md', wirePath: 'A.md', fileId: 'file-2' }),
        entry({ path: 'B.md', wirePath: 'B.md', fileId: 'file-1' }),
      ])
      expect(await store.byFileId('file-1')).toMatchObject({ path: 'B.md' })
      expect(await store.byFileId('file-2')).toMatchObject({ path: 'A.md' })
    })

    it('lets three files rotate their names in one transaction', async () => {
      for (const [path, fileId] of [
        ['A.md', 'file-1'],
        ['B.md', 'file-2'],
        ['C.md', 'file-3'],
      ]) {
        await store.put(entry({ path, wirePath: path, fileId }))
      }
      await store.transaction(async () => {
        await store.put(entry({ path: 'B.md', wirePath: 'B.md', fileId: 'file-1' }))
        await store.put(entry({ path: 'C.md', wirePath: 'C.md', fileId: 'file-2' }))
        await store.put(entry({ path: 'A.md', wirePath: 'A.md', fileId: 'file-3' }))
      })
      expect((await collect(store)).map((e) => [e.path, e.fileId])).toEqual([
        ['A.md', 'file-3'],
        ['B.md', 'file-1'],
        ['C.md', 'file-2'],
      ])
    })

    it('serialises two transactions started at once and commits both, in order', async () => {
      let release = (): void => undefined
      const held = new Promise<void>((resolve) => (release = resolve))
      const first = store.transaction(async () => {
        await store.put(entry())
        await held
        // The second one is queued, not merged into this overlay.
        expect(await store.get('notes/b.md')).toBeNull()
        await store.setCursor(1)
      })
      const second = store.transaction(async () => {
        // It starts after the first has committed, so it reads what the first wrote.
        expect(await store.get('notes/a.md')).toEqual(entry())
        expect(await store.getCursor()).toBe(1)
        await store.put(entry({ path: 'notes/b.md', wirePath: 'notes/b.md', fileId: 'file-2' }))
        await store.setCursor(2)
      })
      release()
      await Promise.all([first, second])

      expect((await collect(store)).map((e) => e.path)).toEqual(['notes/a.md', 'notes/b.md'])
      expect(await store.getCursor()).toBe(2)
    })

    it('fails a call that joined a running transaction when that transaction rolls back', async () => {
      // A call made while a body is running cannot be told from a nested one, so it joins —
      // and if the transaction it joined is rolled back, it is told so rather than reporting
      // success for writes that were dropped.
      let start = (): void => undefined
      const running = new Promise<void>((resolve) => (start = resolve))
      let release = (): void => undefined
      const held = new Promise<void>((resolve) => (release = resolve))
      let releaseJoined = (): void => undefined
      const joinedHeld = new Promise<void>((resolve) => (releaseJoined = resolve))

      const boom = new Error('boom')
      const outer = store.transaction(async () => {
        start()
        await held
        throw boom
      })
      await running
      const joined = store.transaction(async () => {
        await store.setCursor(5)
        await joinedHeld
      })

      release()
      await expect(outer).rejects.toBe(boom)
      await expect(joined).rejects.toBe(boom)
      releaseJoined()
      expect(await store.getCursor()).toBe(0)
    })

    it('reports a flush that cannot be written as io and leaves the database as it was', async () => {
      await store.put(entry())
      // A value structured clone refuses: the flush fails at the request, not before it.
      const poison = {
        ...entry({ path: 'notes/b.md', wirePath: 'notes/b.md', fileId: 'file-2' }),
        unclonable: () => undefined,
      } as unknown as StateEntry

      await expect(
        store.transaction(async () => {
          await store.setCursor(9)
          await store.delete('notes/a.md')
          await store.put(poison)
        })
      ).rejects.toMatchObject({ code: 'io', message: 'cannot commit the state transaction' })

      expect(await collect(store)).toEqual([entry()])
      expect(await store.getCursor()).toBe(0)
    })

    it('holds the clash rule for a row only the database knows about', async () => {
      await store.put(entry())
      await store.transaction(async () => {
        // Same file, new path — the row in the database has to go, and it is not in the
        // overlay for the check to find.
        await store.put(entry({ path: 'notes/b.md', wirePath: 'notes/b.md' }))
        // And one that clashes on wirePath alone.
        await store.put(entry({ path: 'x.md', wirePath: 'x.md', fileId: 'file-2' }))
        await store.put(entry({ path: 'y.md', wirePath: 'x.md', fileId: 'file-3' }))
      })
      expect((await collect(store)).map((e) => e.path)).toEqual(['notes/b.md', 'y.md'])
      expect(await store.byFileId('file-2')).toBeNull()
      expect(await store.byFileId('file-1')).toMatchObject({ path: 'notes/b.md' })
    })
  })
})
