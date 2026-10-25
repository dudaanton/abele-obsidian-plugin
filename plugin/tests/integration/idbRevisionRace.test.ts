import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { EngineError, MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { PreparedUploads } from '@/sync/preparedUploads'
import { NotSyncedState } from '@/sync/notSyncedState'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ExecutableReview } from '@/sync/executableReview'

const opened: IndexedDbStateStore[] = []
afterEach(() => {
  for (const store of opened.splice(0)) store.close()
})
async function open() {
  const store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-revision-race')
  opened.push(store)
  return store
}

it('persists a scoped push refusal through its owning transaction instead of a competing root writer', async () => {
  const state = await open()
  const metadata = new MemoryStateStore()
  const runtime = new TokenEngineRuntime({
    id: 'sample-refusal-race',
    encoded: encodeAccessToken({
      v: 1,
      address: 'https://sync.example.invalid',
      key: 'a'.repeat(43),
      scope: { kind: 'folder', id: 'sample-root', path: '/' },
    }),
    state,
    fs: new MemoryFileSystem(),
    reviews: {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    },
    changed: () => {},
    failed: () => {},
    covers: async () => false,
  })
  const rootWrite = vi.spyOn(state, 'setMeta')
  try {
    const port = Reflect.get(runtime.engine, 'opts')
      .state as import('@abele/sync-sdk/core').StateStore
    await port.transaction(async (tx) => {
      const refusal = Reflect.get(tx, Symbol.for('abele.sync.push-refusal-v1'))
      await refusal({
        op: { op: 'create', path: 'sample.bin', sha: 'd'.repeat(64), size: 5, mtime: 1 },
        path: 'sample.bin',
        code: 'too_large',
        message: 'sample route limit',
        size: 5,
      })
      await tx.setCursor(7)
      expect(rootWrite).not.toHaveBeenCalled()
    })
    expect(await state.getMeta('not-synced-outgoing:sample.bin')).toContain('too_large')
    expect(await state.getCursor()).toBe(7)
    await expect(
      port.transaction(async (tx) => {
        await Reflect.get(
          tx,
          Symbol.for('abele.sync.push-refusal-v1')
        )({
          op: { op: 'create', path: 'sample-rollback.bin', sha: 'f'.repeat(64), size: 5, mtime: 1 },
          path: 'sample-rollback.bin',
          code: 'too_large',
          message: 'sample route limit',
          size: 5,
        })
        throw new Error('sample rollback')
      })
    ).rejects.toThrow('sample rollback')
    expect(await state.getMeta('not-synced-outgoing:sample-rollback.bin')).toBeNull()
    expect(runtime.pushRefusals.has('sample-rollback.bin')).toBe(false)
    expect(rootWrite.mock.calls.filter(([key]) => key.startsWith('not-synced-outgoing:'))).toEqual(
      []
    )
  } finally {
    rootWrite.mockRestore()
    await runtime.close()
  }
})

it.each([2, 33000])(
  'recovers an initial %i-file early-upload scan across a network cut and a mixed content receipt',
  async (count) => {
    const state = await open()
    const fs = new MemoryFileSystem()
    const paths = Array.from(
      { length: count },
      (_, i) => `sample-${String(i).padStart(5, '0')}.bin`
    )
    for (const path of paths)
      await fs.writeAtomic(path, new Uint8Array(path === paths[0] ? [1] : [2, 3]), 1000)
    Object.assign(fs, {
      [Symbol.for('abele.sync.scan-upload-source-v1')]: true,
      openRead: async (path: string) => {
        const bytes = await fs.read(path)
        return {
          size: bytes.length,
          read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
          assertUnchanged: async () => {},
          close: async () => {},
        }
      },
    })
    // The fake keeps completed transactions forever; native IDB releases them. Discard only
    // finished history so a large inventory measures product behavior rather than fake history.
    const db = Reflect.get(state, 'db') as IDBDatabase
    const transaction = db.transaction.bind(db)
    const history = vi.spyOn(db, 'transaction').mockImplementation((...args) => {
      const tx = transaction(...args)
      tx.addEventListener('complete', () => {
        const raw = Reflect.get(db, '_rawDatabase') as { transactions: { _state: string }[] }
        raw.transactions = raw.transactions.filter((one) => one._state !== 'finished')
      })
      return tx
    })
    const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
    const metadata = new MemoryStateStore()
    let offline = true,
      puts = 0,
      commits = 0
    const present = new Set<string>()
    const failed: string[] = []
    const runtime = new TokenEngineRuntime({
      id: 'sample-network-recovery',
      state,
      fs,
      encoded: encodeAccessToken({
        v: 1,
        address: 'https://sync.example.invalid',
        key: 'a'.repeat(43),
        scope,
      }),
      reviews: {
        executables: new ExecutableReview(metadata),
        attachments: new AttachmentConsent(metadata),
        close: () => {},
      },
      changed: () => {},
      failed: (error) => {
        failed.push(String(error))
      },
      covers: async () => false,
      fetch: async (input, init) => {
        const route = new URL(String(input)).pathname
        if (route === '/v2/connection')
          return Response.json({
            protocol: 2,
            token_id: 'sample-token',
            space_id: 'sample-space',
            scope,
            status: 'active',
            limits: { max_file_bytes: 1000, quota_bytes: null },
          })
        if (route === '/v2/manifest' || route === '/v2/changes')
          return Response.json({ items: [], cursor: 0, next: null })
        if (route.startsWith('/v2/uploads/')) {
          const sha = route.split('/')[3]!
          if (init?.method === 'HEAD')
            return new Response(null, { status: present.has(sha) ? 200 : 404 })
          puts++
          if (offline) throw new EngineError('offline', 'sample network cut')
          present.add(sha)
          return new Response(null, { status: 204 })
        }
        if (route === '/v2/commit') {
          const { ops } = JSON.parse(String(init?.body)) as {
            ops: { path: string; sha: string; size: number; mtime: number }[]
          }
          if (commits++) throw new EngineError('offline', 'sample next batch boundary')
          return Response.json({
            cursor: 1,
            results: ops.map((op, i) =>
              i === 0
                ? { status: 'rejected', code: 'too_large', message: 'sample route limit' }
                : {
                    status: 'applied',
                    file_id: 'sample-file-' + i,
                    version_id: 'sample-version-' + i,
                    seq: 1,
                    path: op.path,
                    sha: op.sha,
                    size: op.size,
                    mtime: op.mtime,
                  }
            ),
          })
        }
        throw new Error('Unexpected sample route: ' + route)
      },
    })
    let interleaved = false
    const receipt = Reflect.get(runtime, 'preparedUploads') as PreparedUploads
    const status = Reflect.get(runtime, 'notSyncedState') as NotSyncedState
    state.observeEntries(async () => {
      if (interleaved) return
      interleaved = true
      // Place the recovery acknowledgement at the actual ledger commit boundary, with
      // no scheduler sleeps. These independent durable writes must survive either outcome.
      await receipt.begin({ path: 'sample-pending.bin', sha: 'e'.repeat(64), size: 3 })
      await receipt.acknowledge('e'.repeat(64))
      status.recordRefusal('sample-waiting.bin', 'quota_waiting: sample pending uploads')
      await status.resolved('sample-unrefused.bin')
    })
    try {
      await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
      expect(puts).toBeGreaterThan(0)
      offline = false
      // The small shape finishes; the large shape stops at the next transport boundary after
      // the mixed receipt is durable. Neither is permitted to fail with a local CAS conflict.
      const outcome = await runtime.sync().then(
        () => null,
        (error: unknown) => error
      )
      if (outcome !== null) expect(outcome).toMatchObject({ code: 'offline' })
      expect(commits).toBeGreaterThan(0)
      expect(await state.getMeta('not-synced-outgoing:' + paths[0])).toContain('too_large')
      expect(await state.get(paths[1]!)).not.toBeNull()
      expect(interleaved).toBe(true)
      expect(await receipt.known('e'.repeat(64))).toBe(true)
      expect(await state.getMeta('not-synced-outgoing:sample-waiting.bin')).toContain(
        'quota_waiting'
      )
      expect(failed.some((error) => error.includes('State changed during transaction'))).toBe(false)
    } finally {
      await (Reflect.get(runtime, 'notSyncedState') as NotSyncedState).resolved(
        'sample-unrefused.bin'
      )
      await runtime.close()
      history.mockRestore()
    }
  },
  180000
)

it('keeps an early upload receipt without replaying an unrelated committed-content callback', async () => {
  const store = await open()
  const prepared = new PreparedUploads(store, () => 'sample-context')
  const sha = 'b'.repeat(64)
  await prepared.begin({ path: 'sample.bin', sha, size: 5 })
  let calls = 0
  await store.transaction(async (tx) => {
    calls++
    await tx.setCursor(7)
    // A restored transport acknowledges another early PUT while the push overlay is open.
    await prepared.acknowledge(sha)
    await tx.setJournal(null)
  })
  expect(calls).toBe(1)
  expect(await prepared.known(sha)).toBe(true)
  expect(await prepared.pending()).toEqual([])
  expect(await store.getCursor()).toBe(7)
})

it('retries a conflicting read on fresh state and acknowledges only the successful attempt', async () => {
  const store = await open()
  await store.setMeta('counter', '0')
  let calls = 0
  let acknowledgements = 0
  await store.transaction(async (tx) => {
    const value = Number(await tx.getMeta?.('counter'))
    if (++calls === 1) await store.setMeta('counter', '10')
    await tx.setMeta?.('counter', String(value + 1))
    tx.afterCommit?.(() => {
      acknowledgements++
    })
  })
  expect(calls).toBe(2)
  expect(await store.getMeta('counter')).toBe('11')
  expect(acknowledgements).toBe(1)
})

it('bounds revision retries and names the competing writer and transaction caller', async () => {
  const store = await open()
  let calls = 0
  async function sampleTransactionOwner() {
    return store.transaction(async (tx) => {
      calls++
      await tx.getMeta?.('counter')
      await store.setMeta('counter', String(calls))
    })
  }
  await expect(sampleTransactionOwner()).rejects.toThrow(
    /State changed.*owner=.*sampleTransactionOwner.*writer=/s
  )
  expect(calls).toBe(3)
  expect(await store.getMeta('counter')).toBe('3')
})

it('does not retry arbitrary conflicts or failed effects', async () => {
  const store = await open()
  let calls = 0
  await expect(
    store.transaction(async () => {
      calls++
      throw new EngineError('conflict', 'sample file identity changed')
    })
  ).rejects.toThrow('sample file identity changed')
  expect(calls).toBe(1)
})

it('restarts a metadata inventory when a concurrent writer adds a matching key', async () => {
  const store = await open()
  let calls = 0
  let keys: string[] = []
  await store.transaction(async (tx) => {
    keys = await tx.metadataKeys!('sample:')
    if (++calls === 1) await store.setMeta('sample:new', 'kept')
    await tx.setMeta?.('result', JSON.stringify(keys))
  })
  expect(calls).toBe(2)
  expect(keys).toEqual(['sample:new'])
  expect(await store.getMeta('sample:new')).toBe('kept')
})

it('does not rebase a blind overwrite over an acknowledged competing write', async () => {
  const store = await open()
  let calls = 0
  await store.transaction(async (tx) => {
    if (++calls === 1) await store.setMeta('sample', 'independent')
    else expect(await tx.getMeta?.('sample')).toBe('independent')
    await tx.setMeta?.('sample', 'intentional replacement')
  })
  expect(calls).toBe(2)
  expect(await store.getMeta('sample')).toBe('intentional replacement')
})

it('retries unknown revisions from another connection without overwriting its result', async () => {
  const factory = new IDBFactory()
  const first = await IndexedDbStateStore.open(factory, 'sample-shared-ledger')
  const second = await IndexedDbStateStore.open(factory, 'sample-shared-ledger')
  opened.push(first, second)
  let calls = 0
  await first.transaction(async (tx) => {
    const counter = Number(await tx.getMeta?.('counter'))
    if (++calls === 1) await second.setMeta('counter', '12')
    await tx.setMeta?.('counter', String(counter + 1))
  })
  expect(calls).toBe(2)
  expect(await first.getMeta('counter')).toBe('13')
  expect(await second.getMeta('counter')).toBe('13')
})

it('preserves recovered early receipts, refusals and a queued engine writer with a 33000-file pending shape', async () => {
  const store = await open()
  const count = 33000
  await store.transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      await tx.setMeta?.(`file-retry:sample-${i}.bin`, JSON.stringify({ path: `sample-${i}.bin` }))
    }
  })
  const prepared = new PreparedUploads(store, () => 'sample-context')
  const status = new NotSyncedState(store)
  const sha = 'c'.repeat(64)
  let offline = true
  async function recoveredUpload() {
    if (offline) throw new EngineError('offline', 'sample network interruption')
    await prepared.acknowledge(sha)
  }
  await prepared.begin({ path: 'sample.bin', sha, size: 5 })
  await expect(recoveredUpload()).rejects.toMatchObject({ code: 'offline' })
  let calls = 0
  let next!: Promise<void>
  await store.transaction(async (tx) => {
    calls++
    await tx.setCursor(7)
    offline = false
    await recoveredUpload()
    status.recordRefusal('sample-other.bin', 'quota_waiting: sample')
    // resolved waits on the actual refusal persistence, not a timer.
    await status.resolved('sample.bin')
    await tx.setMeta?.('sample-cohort', 'durable')
    next = store.transaction(async (queued) => {
      await queued.setCursor(8)
    })
  })
  await next
  expect(calls).toBe(1)
  expect(await prepared.known(sha)).toBe(true)
  expect(await store.getCursor()).toBe(8)
  expect(await store.getMeta('sample-cohort')).toBe('durable')
  expect(await store.getMeta('not-synced-outgoing:sample-other.bin')).toContain('quota_waiting')
  expect((await store.metadataKeys('file-retry:')).length).toBe(count)
  expect(Reflect.get(store, 'recentWrites').size).toBeLessThanOrEqual(128)
}, 60000)
