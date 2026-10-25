// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  MemoryFileSystem,
  ExpectedWrites,
  pull,
  type EngineClient,
  type StateEntry,
  V2EngineClient,
} from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'

it('retries page-prefetched ordering proofs on overlap and expires their transaction handle', async () => {
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-feed-proof-race')
  const cap = Symbol.for('abele.sync.feed-metadata-v1')
  let attempts = 0,
    stale: ((keys: string[]) => Promise<unknown>) | undefined
  try {
    await state.setMeta('sample-proof', 'old')
    await state.transaction(async (tx) => {
      attempts++
      // Production scheduling/placement ports bind callable properties through proxies.
      const wrapped = new Proxy(tx, {
        get(target, key) {
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      stale = Reflect.get(wrapped, cap).bind(wrapped)
      await stale!(['sample-proof'])
      if (attempts === 1) await state.setMeta('sample-proof', 'new')
      const value = await tx.getMeta!('sample-proof')
      await tx.setMeta!('sample-result', value)
      await tx.setMeta!('sample-proof', value + '-settled')
      expect(await tx.getMeta!('sample-proof')).toBe(value + '-settled')
    })
    expect(attempts).toBe(2)
    expect(await state.getMeta('sample-result')).toBe('new')
    expect(await state.getMeta('sample-proof')).toBe('new-settled')
    await expect(stale!(['sample-proof'])).rejects.toThrow('expired')
  } finally {
    state.close()
  }
})

it('retires the scan proof for committed ledger changes and unknown writers, not known metadata', async () => {
  const factory = new IDBFactory()
  const state = await IndexedDbStateStore.open(factory, 'sample-scan-revision')
  let other: IndexedDbStateStore | undefined
  const read = () =>
    Reflect.get(state, Symbol.for('abele.sync.local-scan-state-revision-v1')).call(state)
  try {
    const initial = await read()
    await state.setMeta('sample-receipt', 'committed')
    await state.transaction(async (tx) => {
      await tx.setMeta!('sample-status', 'waiting')
    })
    expect(await read()).toBe(initial)
    const row = {
      path: 'Notes/sample.bin',
      wirePath: 'Notes/sample.bin',
      fileId: 'sample',
      versionId: 'version',
      sha: 'a'.repeat(64),
      size: 1,
      mtime: 1000,
    }
    await state.transaction(async (tx) => {
      await tx.put(row)
    })
    const changed = await read()
    expect(changed).not.toBe(initial)
    other = await IndexedDbStateStore.open(factory, 'sample-scan-revision')
    await other.put({ ...row, mtime: -1 })
    const foreign = await read()
    expect(foreign).not.toBe(changed)
    for (let i = 0; i < 130; i++) await state.setMeta('sample-status', String(i))
    const aged = await read()
    expect(aged).not.toBe(foreign)
    expect(await read()).toBe(aged)
  } finally {
    other?.close()
    state.close()
  }
})

it.each(['core', 'v2'] as const)(
  'matches 34000 own echoes through %s with bounded ledger transactions and no physical path admission',
  async (transport) => {
    const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-echo-ledger')
    const db = Reflect.get(Reflect.get(state, 'connection'), 'db') as IDBDatabase
    const count = 34000,
      sha = 'a'.repeat(64)
    const rows: StateEntry[] = Array.from({ length: count }, (_, i) => ({
      path: `Notes/Sample ${i}.bin`,
      wirePath: `Notes/Sample ${i}.bin`,
      fileId: `sample-${i}`,
      versionId: `version-${i}`,
      size: 1,
      mtime: 1000,
      sha,
    }))
    // Seed a previously acknowledged ledger; normal entry indexes are maintained by IDB.
    const seed = db.transaction(['entries'], 'readwrite')
    const seeded = new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onabort = () => reject(seed.error)
    })
    for (const row of rows) seed.objectStore('entries').put(row)
    await seeded
    await state.setCursor(1)
    let transactions = 0,
      admissions = 0
    const transaction = db.transaction.bind(db)
    db.transaction = ((...args: Parameters<typeof db.transaction>) => {
      // Browser IDB does not retain completed transactions as the fake's diagnostic history does.
      const raw = Reflect.get(db, '_rawDatabase') as { transactions: { _state: string }[] }
      raw.transactions = raw.transactions.filter((tx) => tx._state !== 'finished')
      if (++transactions > 1024) throw new Error('Unbounded per-file ledger transactions')
      return transaction(...args)
    }) as typeof db.transaction
    const fs = Object.assign(new MemoryFileSystem(), {
      [Symbol.for('abele.sync.path-admission-v1')]: () => {
        admissions++
        return undefined
      },
    })
    const started = performance.now()
    try {
      const v2 = new V2EngineClient(
        encodeAccessToken({
          v: 1,
          address: 'https://sync.example.invalid',
          key: 'a'.repeat(43),
          scope: { kind: 'folder', id: 'sample-root', path: '/' },
        }),
        {}
      )
      Reflect.set(v2, 'ports', { state, fs })
      Reflect.set(v2, 'connectionInfo', { token_id: 'sample-token' })
      vi.spyOn(Reflect.get(v2, 'http'), 'json').mockImplementation(async (...args: unknown[]) => {
        const query = (args[3] as { query: { since: number } }).query
        const offset = query.since - 1,
          end = Math.min(offset + 1000, count)
        return {
          items: rows.slice(offset, end).map((row, i) => ({
            type: 'content',
            cursor: offset + i + 2,
            file_id: row.fileId,
            path: row.wirePath,
            at: '2030-01-01T00:00:00.000Z',
            prev_path: null,
            item: {
              file_id: row.fileId,
              version_id: row.versionId,
              path: row.wirePath,
              kind: 'attachment',
              sha,
              size: 1,
              mtime: 1000,
            },
          })),
          cursor: end + 1,
          next: end < count ? 'sample-next' : null,
        }
      })
      const report = await pull(
        transport === 'v2'
          ? v2
          : ({
              changes: async (since: number) => {
                const offset = since - 1,
                  end = Math.min(offset + 1000, count)
                return {
                  items: rows.slice(offset, end).map((row, i) => ({
                    path: row.wirePath,
                    file_id: row.fileId,
                    version_id: row.versionId,
                    sha,
                    size: 1,
                    mtime: 1000,
                    seq: offset + i + 2,
                    op: 'create',
                    prev_path: null,
                    kind: 'attachment',
                  })),
                  head_seq: count + 1,
                  next_since: end + 1,
                }
              },
            } as unknown as EngineClient),
        fs,
        state,
        { filter: { excluded: () => false }, dirty: new Set(), expected: new ExpectedWrites() }
      )
      console.log('feed ledger batch', {
        transport,
        transactions,
        admissions,
        ms: performance.now() - started,
      })
      expect(report.cursor).toBe(count + 1)
      expect(report.applied).toBe(0)
      expect(report.skipped).toBe(count)
      expect(transactions).toBeLessThan(transport === 'v2' ? 600 : 300)
      expect(admissions).toBe(0)
      expect(performance.now() - started).toBeLessThan(transport === 'v2' ? 10000 : 5000)
      if (transport === 'v2') {
        expect(await state.metadataKeys('settlement-membership:')).toHaveLength(count)
        for (const i of [0, count - 1]) {
          const proof = JSON.parse((await state.getMeta('settlement-membership:sample-' + i))!)
          expect(proof.event.cursor).toBe(i + 2)
          const mark = JSON.parse(
            (await state.getMeta('v2-departure-path:p:' + encodeURIComponent(rows[i]!.wirePath)))!
          )
          expect(mark.present).toBe(false)
        }
      }
    } finally {
      state.close()
    }
  },
  30000
)
