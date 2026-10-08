// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStateStore, ScopedState } from '@abele/sync-core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExternalState, ExternalStateError, type ExternalStatePort } from '@/sync/external/state'
import { SqliteExternalStateStore } from '@/sync/external/SqliteExternalStateStore'
import type { ExternalRecord, ExternalOperation } from '@/sync/external/records'

const binding = {
  endpoint: 'https://sync.example.invalid',
  vaultId: 'sample-vault',
  mode: 'personal' as const,
  principalId: 'sample-principal',
  principalType: 'device' as const,
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-credential-slot',
}
const expected = {
  fileId: 'sample-file',
  versionId: 'sample-version',
  path: 'Media/sample.jpg',
  sha: 'a'.repeat(64),
  size: 10,
}
const base = { ...expected, mtime: 1790000000000 }
const record = (patch: Partial<ExternalRecord> = {}): ExternalRecord => ({
  schema: 1,
  ledgerId: 'sample-ledger',
  binding,
  fileId: expected.fileId,
  representation: 'hydrated',
  preference: 'on-demand',
  pinned: false,
  projectionPath: null,
  projectionSha: null,
  localRevision: 0,
  pendingOperationId: null,
  availability: 'active',
  blockingReason: null,
  lastProvenLocalBase: base,
  retained: [],
  ...patch,
})
const operation = (patch: Partial<ExternalOperation> = {}): ExternalOperation => ({
  schema: 1,
  operationId: 'sample-operation',
  kind: 'eviction',
  phase: 'prepared',
  revision: 0,
  connectionGeneration: 1,
  expected,
  sourcePath: expected.path,
  targetPath: `${expected.path}.abele-ref`,
  previousRepresentation: 'hydrated',
  localBase: base,
  desiredRepresentation: 'remote-only',
  projectionDigest: 'b'.repeat(64),
  ownedArtifacts: [],
  unresolvedOutcome: null,
  cleanupReason: null,
  ...patch,
})
const entry = {
  path: expected.path,
  wirePath: expected.path,
  fileId: expected.fileId,
  versionId: expected.versionId,
  sha: expected.sha,
  size: expected.size,
  mtime: base.mtime,
}
const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) fn()
})

async function idb() {
  const factory = new IDBFactory()
  let port = await IndexedDbStateStore.open(factory, 'sample-external-ledger')
  cleanup.push(() => port.close())
  return {
    get port() {
      return port
    },
    reopen: async () => {
      port.close()
      port = await IndexedDbStateStore.open(factory, 'sample-external-ledger')
      return port
    },
    peer: async () => {
      const peer = await IndexedDbStateStore.open(factory, 'sample-external-ledger')
      cleanup.push(() => peer.close())
      return peer
    },
    outer: (fn: () => Promise<void>) => port.transaction(fn),
    readEntry: () => port.get(expected.path),
    readCursor: () => port.getCursor(),
  }
}
async function sqlite() {
  const scratch = resolve(import.meta.dirname, '../../../.scratch')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(resolve(scratch, 'external-sqlite-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const file = resolve(root, 'ledger.sqlite')
  let db = new DatabaseSync(file)
  // The real CLI ledger schema, not an independent external head database.
  db.exec(`CREATE TABLE entries (path TEXT PRIMARY KEY, wire_path TEXT NOT NULL UNIQUE, file_id TEXT NOT NULL UNIQUE, version_id TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  let port = new SqliteExternalStateStore(db)
  cleanup.push(() => db.close())
  return {
    get port() {
      return port
    },
    get db() {
      return db
    },
    reopen: async () => {
      db.close()
      db = new DatabaseSync(file)
      port = new SqliteExternalStateStore(db)
      return port
    },
    peer: async () => {
      const peer = new DatabaseSync(file)
      cleanup.push(() => peer.close())
      return new SqliteExternalStateStore(peer)
    },
    outer: async (fn: () => Promise<void>) => {
      db.exec('BEGIN')
      try {
        await fn()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    readEntry: async () =>
      db.prepare('SELECT * FROM entries WHERE file_id = ?').get(expected.fileId),
    readCursor: async () =>
      Number(
        (
          db.prepare("SELECT value FROM meta WHERE key = 'cursor'").get() as
            | { value: string }
            | undefined
        )?.value ?? 0
      ),
  }
}

for (const [name, create] of [
  ['IndexedDB', idb],
  ['SQLite', sqlite],
] as const) {
  describe(`durable external phases in real ${name}`, () => {
    it('reopens committed representation, phase, earlier local base, retained ownership and atomic ledger progress', async () => {
      const host = await create()
      const state = await ExternalState.open(host.port, 'sample-ledger', binding)
      await state.commit({
        expectedRevision: 0,
        files: [
          { expectedRevision: null, next: record({ pendingOperationId: 'sample-operation' }) },
        ],
        operations: [{ expectedRevision: null, next: operation() }],
        ledger: {
          putEntries: [entry],
          cursor: 7,
          metadata: [{ key: 'sample-scoped-checkpoint', value: 'sample-checkpoint' }],
        },
      })
      const op = operation({ phase: 'delete-ready', revision: 1 })
      const next = record({
        representation: 'remote-only',
        localRevision: 1,
        projectionPath: operation().targetPath,
        projectionSha: 'b'.repeat(64),
        pendingOperationId: 'sample-operation',
        retained: [
          {
            path: 'Recovery/sample.bin',
            sha: 'c'.repeat(64),
            size: 9,
            role: 'retained',
            operationId: 'sample-operation',
          },
        ],
      })
      const receipt = await state.commit({
        expectedRevision: 1,
        files: [{ expectedRevision: 0, next }],
        operations: [{ expectedRevision: 0, next: op }],
        ledger: {
          putEntries: [{ ...entry, versionId: 'sample-version-2', sha: 'd'.repeat(64) }],
          cursor: 8,
        },
      })
      expect(receipt).toMatchObject({ status: 'committed', revision: 2 })
      const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
      const snapshot = await reopened.snapshot()
      expect(snapshot.files).toEqual([next])
      expect(snapshot.operations).toEqual([op])
      expect(snapshot.files[0].lastProvenLocalBase?.versionId).toBe('sample-version')
      expect(await host.readEntry()).not.toBeNull()
      expect(await host.readCursor()).toBe(8)
    })

    it('rejects a phase nested in an uncommitted outer transaction rather than returning an effect receipt', async () => {
      const host = await create()
      const state = await ExternalState.open(host.port, 'sample-ledger', binding)
      await host.outer(async () => {
        await expect(
          state.commit({ expectedRevision: 0, files: [{ expectedRevision: null, next: record() }] })
        ).rejects.toMatchObject({ reason: 'nested-transaction' })
      })
      expect((await state.snapshot()).files).toEqual([])
    })

    it('rejects stale document/file/operation revisions and operation-ID parameter substitution', async () => {
      const host = await create()
      const first = await ExternalState.open(host.port, 'sample-ledger', binding)
      const second = await ExternalState.open(host.port, 'sample-ledger', binding)
      await first.commit({
        expectedRevision: 0,
        files: [
          { expectedRevision: null, next: record({ pendingOperationId: 'sample-operation' }) },
        ],
        operations: [{ expectedRevision: null, next: operation() }],
      })
      await expect(
        second.commit({ expectedRevision: 0, files: [{ expectedRevision: null, next: record() }] })
      ).rejects.toMatchObject({ reason: 'revision-conflict' })
      await expect(
        first.commit({
          expectedRevision: 1,
          files: [{ expectedRevision: 99, next: record({ localRevision: 100 }) }],
        })
      ).rejects.toMatchObject({ reason: 'revision-conflict' })
      await expect(
        first.commit({
          expectedRevision: 1,
          operations: [
            {
              expectedRevision: 0,
              next: operation({
                revision: 1,
                expected: { ...expected, versionId: 'different-version' },
              }),
            },
          ],
        })
      ).rejects.toMatchObject({ reason: 'operation-mismatch' })
      expect((await first.snapshot()).revision).toBe(1)
    })

    it('racing phase commits compare the revision inside the real database transaction', async () => {
      const host = await create()
      const first = await ExternalState.open(host.port, 'sample-ledger', binding)
      const independent = await ExternalState.open(await host.peer(), 'sample-ledger', binding)
      const outcomes = await Promise.allSettled([
        first.commit({
          expectedRevision: 0,
          operations: [{ expectedRevision: null, next: operation() }],
        }),
        independent.commit({
          expectedRevision: 0,
          operations: [
            { expectedRevision: null, next: operation({ operationId: 'other-operation' }) },
          ],
        }),
      ])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      const rejected = outcomes.find(
        (outcome) => outcome.status === 'rejected'
      ) as PromiseRejectedResult
      expect(rejected.reason).toMatchObject({ reason: 'revision-conflict' })
      expect((await first.snapshot()).revision).toBe(1)
      expect((await first.snapshot()).operations).toHaveLength(1)
    })

    it('records operation-owned hidden staging paths but rejects unsafe recovery paths', async () => {
      const host = await create()
      const state = await ExternalState.open(host.port, 'sample-ledger', binding)
      const artifact = {
        path: 'Media/.abele-sync-sample.tmp',
        sha: 'c'.repeat(64),
        size: 9,
        role: 'incoming' as const,
        operationId: 'sample-operation',
      }
      await state.commit({
        expectedRevision: 0,
        operations: [
          {
            expectedRevision: null,
            next: operation({
              kind: 'hydration',
              phase: 'download-intent',
              sourcePath: artifact.path,
              ownedArtifacts: [artifact],
            }),
          },
        ],
      })
      const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
      expect((await reopened.snapshot()).operations[0].ownedArtifacts).toEqual([artifact])
      for (const path of [
        '../sample.tmp',
        'Media/../sample.tmp',
        '/sample.tmp',
        'Media/sample\\\\tmp',
      ])
        await expect(
          reopened.commit({
            expectedRevision: 1,
            operations: [
              {
                expectedRevision: 0,
                next: operation({
                  kind: 'hydration',
                  phase: 'ready-to-install',
                  revision: 1,
                  sourcePath: artifact.path,
                  ownedArtifacts: [{ ...artifact, path }],
                }),
              },
            ],
          })
        ).rejects.toMatchObject({ name: 'ZodError' })
    })

    it('retains the earlier proven base while pending work or exceptional bytes still depend on it', async () => {
      const host = await create()
      const state = await ExternalState.open(host.port, 'sample-ledger', binding)
      await state.commit({
        expectedRevision: 0,
        files: [
          { expectedRevision: null, next: record({ pendingOperationId: 'sample-operation' }) },
        ],
        operations: [{ expectedRevision: null, next: operation() }],
      })
      await expect(
        state.commit({
          expectedRevision: 1,
          files: [
            { expectedRevision: 0, next: record({ localRevision: 1, lastProvenLocalBase: null }) },
          ],
        })
      ).rejects.toMatchObject({ reason: 'recovery-required' })
      expect((await state.snapshot()).files[0].lastProvenLocalBase).toEqual(base)
    })

    it('rejects an operation phase that cannot belong to its kind', async () => {
      const host = await create()
      const state = await ExternalState.open(host.port, 'sample-ledger', binding)
      await expect(
        state.commit({
          expectedRevision: 0,
          operations: [
            {
              expectedRevision: null,
              next: operation({ kind: 'hydration', phase: 'delete-ready' }),
            },
          ],
        })
      ).rejects.toMatchObject({ name: 'ZodError' })
      expect((await state.snapshot()).operations).toEqual([])
    })

    it('does not rebind the same vault on another endpoint, principal, grant, generation or credential', async () => {
      const host = await create()
      await ExternalState.open(host.port, 'sample-ledger', binding)
      const normalized = await ExternalState.open(host.port, 'sample-ledger', {
        ...binding,
        endpoint: 'HTTPS://SYNC.EXAMPLE.INVALID:443/',
      })
      expect((await normalized.snapshot()).binding.endpoint).toBe(binding.endpoint)
      for (const patch of [
        { endpoint: 'https://other.example.invalid' },
        { endpoint: binding.endpoint + '/other' },
        { principalId: 'other-principal' },
        { principalType: 'key' },
        { generation: 2 },
        { credentialAssociation: 'other-slot' },
        { mode: 'scoped', grantId: 'sample-grant', principalType: 'key' },
      ])
        await expect(
          ExternalState.open(host.port, 'sample-ledger', { ...binding, ...patch })
        ).rejects.toMatchObject({ reason: 'binding-mismatch' })
      await expect(ExternalState.open(host.port, 'other-ledger', binding)).rejects.toMatchObject({
        reason: 'binding-mismatch',
      })
    })

    it('stops on unknown commit outcomes; reopening reveals the actual committed phase before any next step', async () => {
      const host = await create()
      const state = await ExternalState.open(host.port, 'sample-ledger', binding)
      const original = host.port.commitExternalPhase.bind(host.port)
      const fault = vi
        .spyOn(host.port, 'commitExternalPhase')
        .mockImplementationOnce(async (batch) => {
          await original(batch)
          throw new ExternalStateError('commit-unknown')
        })
      let authorized = false
      await expect(
        state
          .commit({
            expectedRevision: 0,
            operations: [{ expectedRevision: null, next: operation() }],
          })
          .then(() => {
            authorized = true
          })
      ).rejects.toMatchObject({ reason: 'commit-unknown' })
      expect(authorized).toBe(false)
      await expect(state.commit({ expectedRevision: 1 })).rejects.toMatchObject({
        reason: 'recovery-required',
      })
      expect(fault).toHaveBeenCalledTimes(1)
      const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
      expect((await reopened.snapshot()).operations[0].phase).toBe('prepared')
    })
  })
}

describe('external storage commit boundaries', () => {
  it('refuses the production memory fallback', async () => {
    await expect(
      ExternalState.open(
        new MemoryStateStore() as unknown as ExternalStatePort,
        'sample-ledger',
        binding
      )
    ).rejects.toMatchObject({ reason: 'unsupported-storage' })
  })

  it('refuses an in-memory SQLite database as production external persistence', () => {
    const db = new DatabaseSync(':memory:')
    try {
      expect(() => new SqliteExternalStateStore(db)).toThrowError(
        expect.objectContaining({ reason: 'unsupported-storage' })
      )
    } finally {
      db.close()
    }
  })

  it('settles existing entry provenance before the phase transaction and preserves observer refusal', async () => {
    const host = await idb()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    const observer = vi.fn(async () => {
      throw new Error('sample provenance hold')
    })
    host.port.observeEntries(observer)
    await expect(
      state.commit({ expectedRevision: 0, ledger: { putEntries: [entry], cursor: 9 } })
    ).rejects.toMatchObject({ reason: 'aborted' })
    expect(observer).toHaveBeenCalledWith(entry)
    const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
    expect((await reopened.snapshot()).revision).toBe(0)
    expect(await host.readEntry()).toBeNull()
    expect(await host.readCursor()).toBe(0)
  })

  it('waits for IndexedDB transaction completion, not request success', async () => {
    const host = await idb()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    let requestSucceeded = (): void => undefined
    const requested = new Promise<void>((resolve) => {
      requestSucceeded = resolve
    })
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key)
      if (value.key === 'plugin:external-files')
        request.addEventListener('success', requestSucceeded)
      return request
    })
    let authorized = false
    const commit = state
      .commit({ expectedRevision: 0, operations: [{ expectedRevision: null, next: operation() }] })
      .then(() => {
        authorized = true
      })
    await requested
    expect(authorized).toBe(false)
    await commit
    expect(authorized).toBe(true)
  })

  it('an actual IndexedDB abort rolls back the phase and all ledger writes without an effect receipt', async () => {
    const host = await idb()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    const put = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key)
      if (value.key === 'plugin:external-files')
        request.addEventListener('success', () => this.transaction.abort())
      return request
    })
    await expect(
      state.commit({
        expectedRevision: 0,
        operations: [{ expectedRevision: null, next: operation() }],
        ledger: { putEntries: [entry], cursor: 9 },
      })
    ).rejects.toMatchObject({ reason: 'aborted' })
    vi.restoreAllMocks()
    const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
    expect((await reopened.snapshot()).operations).toEqual([])
    expect(await host.readEntry()).toBeNull()
    expect(await host.readCursor()).toBe(0)
  })

  it('an IndexedDB acknowledgement lost through connection retirement stops the adapter without a write retry', async () => {
    const host = await idb()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    const put = IDBObjectStore.prototype.put
    let writes = 0
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key)
      if (value.key === 'plugin:external-files') {
        writes++
        request.addEventListener('success', () => host.port.close())
      }
      return request
    })
    await expect(
      state.commit({
        expectedRevision: 0,
        operations: [{ expectedRevision: null, next: operation() }],
      })
    ).rejects.toMatchObject({ reason: 'commit-unknown' })
    await expect(
      host.port.commitExternalPhase({ expectedRevision: 0, next: '{}' })
    ).rejects.toMatchObject({ reason: 'recovery-required' })
    expect(writes).toBe(1)
    vi.restoreAllMocks()
    const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
    expect((await reopened.snapshot()).operations[0].phase).toBe('prepared')
  })

  it('an actual SQLite statement abort rolls back phase and ledger changes', async () => {
    const host = await sqlite()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    host.db.exec(
      "CREATE TRIGGER reject_phase BEFORE UPDATE ON meta WHEN NEW.key = 'daemon:external-files' BEGIN SELECT RAISE(ABORT, 'sample abort'); END;"
    )
    await expect(
      state.commit({
        expectedRevision: 0,
        operations: [{ expectedRevision: null, next: operation() }],
        ledger: { putEntries: [entry], cursor: 9 },
      })
    ).rejects.toMatchObject({ reason: 'aborted' })
    const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
    expect((await reopened.snapshot()).operations).toEqual([])
    expect(await host.readEntry()).toBeUndefined()
    expect(await host.readCursor()).toBe(0)
  })

  it('a SQLite COMMIT whose acknowledgement is lost stops the adapter itself, not just the facade', async () => {
    const host = await sqlite()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    const exec = host.db.exec.bind(host.db)
    vi.spyOn(host.db, 'exec').mockImplementation((sql) => {
      exec(sql)
      if (sql === 'COMMIT') throw new Error('sample lost commit acknowledgement')
    })
    await expect(
      state.commit({
        expectedRevision: 0,
        operations: [{ expectedRevision: null, next: operation() }],
      })
    ).rejects.toMatchObject({ reason: 'commit-unknown' })
    await expect(
      host.port.commitExternalPhase({
        expectedRevision: 1,
        next: JSON.stringify({ ...(await state.snapshot()), revision: 2 }),
      })
    ).rejects.toMatchObject({ reason: 'recovery-required' })
    vi.restoreAllMocks()
    const reopened = await ExternalState.open(await host.reopen(), 'sample-ledger', binding)
    expect((await reopened.snapshot()).operations[0].phase).toBe('prepared')
  })

  it('rejects a phase even before an IndexedDB outer body begins, and rejects corrupt persisted records', async () => {
    const host = await idb()
    const state = await ExternalState.open(host.port, 'sample-ledger', binding)
    const outer = host.outer(async () => {
      await expect(state.commit({ expectedRevision: 0 })).rejects.toMatchObject({
        reason: 'nested-transaction',
      })
    })
    await expect(state.commit({ expectedRevision: 0 })).rejects.toMatchObject({
      reason: 'nested-transaction',
    })
    await outer
    await host.port.setMeta('external-files', '{broken')
    await expect(
      ExternalState.open(await host.reopen(), 'sample-ledger', binding)
    ).rejects.toMatchObject({ reason: 'recovery-required' })
  })

  it('uses the existing scoped head/checkpoint record in the same database, not a duplicate external head', async () => {
    const host = await idb()
    const scopedBinding = {
      version: 4,
      facet: 'scoped',
      endpoint_identity: binding.endpoint,
      vault_id: binding.vaultId,
      grant_id: 'sample-grant',
      principal_kind: 'key',
      principal_id: binding.principalId,
      credential_fingerprint: 'e'.repeat(64),
    }
    const scoped = await ScopedState.open(host.port, scopedBinding, { initialize: true })
    const externalBinding = {
      ...binding,
      mode: 'scoped',
      grantId: scopedBinding.grant_id,
      principalType: 'key',
    }
    const external = await ExternalState.open(host.port, 'sample-ledger', externalBinding)
    // ScopedState's existing metadata format remains its sole head authority.
    const metadata = await host.port.pluginMeta()
    const key = 'scoped-v4-state'
    const root = JSON.parse(metadata.get(key)!)
    const checkpoint = { kind: 'scoped', token: 'sample-checkpoint' }
    await external.commit({
      expectedRevision: 0,
      operations: [{ expectedRevision: null, next: operation() }],
      ledger: { metadata: [{ key, value: JSON.stringify({ ...root, checkpoint }) }] },
    })
    expect(await scoped.getCheckpoint()).toEqual(checkpoint)
    const port = await host.reopen()
    const reopened = await ScopedState.open(port, scopedBinding)
    expect(await reopened.getCheckpoint()).toEqual(checkpoint)
    expect(
      (await (await ExternalState.open(port, 'sample-ledger', externalBinding)).snapshot())
        .operations[0].phase
    ).toBe('prepared')
  })
})
