// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { App } from 'obsidian'
import { SyncClient, SyncEngine, RecoveryBarrier, sha256 } from '@abele/sync-core'
import { create, blob, seed } from '@abele/sync-test-seed'
import { syncServer, type SyncServer } from '../helpers/syncServer'
import { buildFakeVault } from '../helpers/fakeVault'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExternalState } from '@/sync/external/state'
import { ExternalRepresentation } from '@/sync/external/representation'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { AttachmentStore } from '@/sync/external/attachmentStore'
import { serializeProjection } from '@/sync/external/projection'
import { selectiveFrom } from '@/sync/connection'
import { pluginRepresentation } from '@/sync/external/pluginRepresentation'
import { RuntimeFence } from '@/sync/external/recovery'
import { runRetention } from '@abele/sync-server/src/history/retention.js'
import { createUploadManager } from '@abele/sync-server/src/blobs/uploads.js'
import { loadConfig } from '@abele/sync-server/src/config.js'

describe('two-device external attachment matrix', () => {
  it.each([
    [false, null],
    [true, null],
    [true, 'staging'],
    [true, 'sidecar'],
    [true, 'unknown'],
  ] as const)(
    'keeps policy local through remote changes (restart=%s, evidence=%s)',
    async (restart, evidence) => {
      server = await syncServer()
      const { accountToken } = await server.account('sample-matrix@example.invalid')
      const { vaultId } = await server.vault(accountToken, 'sample-vault')
      const a = await server.device(accountToken, vaultId, 'sample-a')
      const b = await server.device(accountToken, vaultId, 'sample-b')
      const other = server.clientFor(b.deviceToken, vaultId)
      await seed(other, [await create(other, 'Media/sample-matrix.bin', 'sample first', 1000)])
      const initial = (await other.manifest(null)).items[0]
      const factory = new IDBFactory()
      const binding = {
        endpoint: server.BASE_URL,
        vaultId,
        mode: 'personal' as const,
        principalId: a.deviceId,
        principalType: 'device' as const,
        grantId: null,
        generation: 1,
        credentialAssociation: 'sample-slot',
      }
      const fake = buildFakeVault([{ path: initial.path, content: 'sample first', mtime: 1000 }])
      const retained = buildFakeVault([
        { path: initial.path, content: 'sample first', mtime: 1000 },
      ])
      ;(
        fake.workspace as unknown as { iterateAllLeaves(fn: (leaf: unknown) => void): void }
      ).iterateAllLeaves = () => {}
      const client = server.clientFor(a.deviceToken, vaultId)
      const downloads = vi.spyOn(client, 'getBlob')
      const uploads = vi.spyOn(client, 'putBlob')
      const commits = vi.spyOn(client, 'commitRaw')
      const otherStore = await IndexedDbStateStore.open(factory, 'sample-b-matrix')
      let engine: SyncEngine
      let host: ExternalFileHost
      let api: AttachmentStore
      let fence: RuntimeFence
      async function open() {
        store = await IndexedDbStateStore.open(factory, 'sample-a-matrix')
        const state = await ExternalState.open(store, 'sample-ledger', binding)
        const fs = new ObsidianFileSystem(fake as unknown as App)
        fence = new RuntimeFence(fake, 'sample-a-matrix', () => true)
        fence.activate()
        const representation = await pluginRepresentation({
          app: fake as unknown as App,
          factory,
          store,
          ledgerId: 'sample-ledger',
          binding,
          fs,
          fence,
          scriptsFolder: () => 'Scripts',
          verify: (id, input) => client.verifyExternalFile(id, input),
        })
        engine = new SyncEngine({
          client: representation.personalClient(client),
          fs: representation.fileSystem(),
          state: representation.stateStore(),
          selective: selectiveFrom(undefined),
          recovery: fence.recovery,
        })
        host = new ExternalFileHost(fake as unknown as App, {
          platform: 'mobile',
          assertOwned: () => fence.assertReady(),
        })
        api = new AttachmentStore({
          state,
          ledger: store,
          host,
          binding,
          refreshed: () => representation.refresh(),
          serial: { run: (job) => engine.runExclusive(job) },
          assertOwned: () => fence.assertReady(),
          scriptsFolder: () => 'Scripts',
          sync: () => engine.sync(),
          verify: (id, input) => client.verifyExternalFile(id, input),
          download: (id, version) => client.versionBytes(id, version),
        })
        await api.recover()
      }
      async function reopen() {
        if (!restart) return
        await engine!.stop()
        host!.close()
        fence!.release()
        store!.close()
        await open()
      }
      const base = {
        path: initial.path,
        wirePath: initial.path,
        fileId: initial.file_id,
        versionId: initial.version_id,
        sha: initial.sha,
        size: initial.size,
        mtime: initial.mtime,
      }
      store = await IndexedDbStateStore.open(factory, 'sample-a-matrix')
      await store.put(base)
      await store.setCursor(initial.seq)
      store.close()
      await otherStore.put(base)
      await otherStore.setCursor(initial.seq)
      const ordinary = new SyncEngine({
        client: other,
        fs: new ObsidianFileSystem(retained as unknown as App),
        state: otherStore,
        selective: selectiveFrom(undefined),
      })
      await open()
      try {
        expect(
          await api!.evict(initial.file_id, {
            operationId: 'sample-evict',
            expectedRevision: 0,
            expectedVersionId: initial.version_id,
          })
        ).toMatchObject({ status: 'complete' })
        expect(await fake.vault.adapter.exists(initial.path)).toBe(false)
        await reopen()
        await retained.vault.adapter.writeBinary(
          initial.path,
          new TextEncoder().encode('sample second').buffer
        )
        expect((await ordinary.sync()).push.applied).toBe(1)
        const edited = await other.head(initial.file_id)
        downloads.mockClear()
        uploads.mockClear()
        commits.mockClear()
        await engine!.sync()
        expect((await api!.get(initial.file_id))?.knownVersion).toBe(edited.version_id)
        expect(downloads).not.toHaveBeenCalled()
        expect(uploads).not.toHaveBeenCalled()
        expect(commits).not.toHaveBeenCalled()
        expect(await fake.vault.adapter.exists(initial.path)).toBe(false)
        if (evidence) {
          const state = await ExternalState.open(store!, 'sample-ledger', binding)
          const document = await state.snapshot()
          const pending = document.operations.find(
            (op) => op.operationId === document.files[0].pendingOperationId
          )!
          if (evidence === 'staging')
            await fake.vault.adapter.writeBinary(
              pending.ownedArtifacts[0].path,
              new TextEncoder().encode('sample retained evidence').buffer
            )
          if (evidence === 'sidecar')
            await fake.vault.adapter.writeBinary(
              initial.path + '.abele-ref',
              new TextEncoder().encode('sample foreign sidecar').buffer
            )
          if (evidence === 'unknown')
            await state.commit({
              expectedRevision: document.revision,
              operations: [
                {
                  expectedRevision: pending.revision,
                  next: {
                    ...pending,
                    revision: pending.revision + 1,
                    unresolvedOutcome: 'sample unknown installation',
                  },
                },
              ],
            })
          const before = await state.snapshot()
          expect(
            await api!.hydrate(initial.file_id, {
              operationId: 'sample-held-hydration',
              expectedVersionId: edited.version_id,
            })
          ).toMatchObject({ status: 'ineligible' })
          expect(await state.snapshot()).toEqual(before)
          expect(await fake.vault.adapter.exists(initial.path)).toBe(false)
          expect((await api!.inspectDisconnect()).safe).toBe(false)
          return
        }
        await reopen()
        const config = loadConfig({
          ABELE_MASTER_KEY: 'ab'.repeat(32),
          ABELE_TOKEN_PEPPER: 'test',
          ABELE_BLOB_DIR: server.store.dir,
        })
        const retention = await runRetention({
          db: server.db,
          dialect: 'sqlite',
          store: server.store,
          uploads: createUploadManager({ config, db: server.db, store: server.store }),
          idempotencyTtlMs: 86400000,
          now: () => new Date(Date.now() + 400 * 86400000),
        })
        expect(retention.versions_removed).toBe(1)
        await expect(
          client.versionBytes(initial.file_id, initial.version_id)
        ).rejects.toMatchObject({ code: 'not_found' })
        expect(
          await api!.hydrate(initial.file_id, {
            operationId: 'sample-expired',
            expectedVersionId: initial.version_id,
          })
        ).toMatchObject({ status: 'version-changed' })
        expect(await fake.vault.adapter.exists(initial.path)).toBe(false)
        expect(
          await api!.hydrate(initial.file_id, {
            operationId: 'sample-hydrate',
            expectedVersionId: edited.version_id,
          })
        ).toMatchObject({ status: 'complete' })
        expect(new Uint8Array(await fake.vault.adapter.readBinary(initial.path))).toEqual(
          new TextEncoder().encode('sample second')
        )
        expect(await otherStore.getExternalState()).toBeNull()
        expect(await retained.vault.adapter.exists(initial.path)).toBe(true)
        const snapshot = await api!.get(initial.file_id)
        expect(
          await api!.evict(initial.file_id, {
            operationId: 'sample-evict-again',
            expectedRevision: snapshot!.localRevision,
            expectedVersionId: edited.version_id,
          })
        ).toMatchObject({ status: 'complete' })
        const renamed = (
          await seed(other, [
            {
              op: 'move',
              file_id: initial.file_id,
              base_version_id: edited.version_id,
              to_path: 'Media/sample-renamed.bin',
            },
          ])
        ).results[0]
        await engine!.sync()
        await reopen()
        expect((await store!.byFileId(initial.file_id))?.path).toBe('Media/sample-renamed.bin')
        await seed(other, [
          { op: 'delete', file_id: initial.file_id, base_version_id: renamed.version_id! },
        ])
        await engine!.sync()
        await reopen()
        expect((await api!.get(initial.file_id))?.availability).toBe('deleted')
        expect((await api!.inspectDisconnect()).safe).toBe(false)
        expect((await other.restoreDeleted(initial.file_id)).status).toBe('applied')
        await engine!.sync()
        await reopen()
        expect((await api!.get(initial.file_id))?.availability).toBe('active')
        expect(await fake.vault.adapter.exists('Media/sample-renamed.bin')).toBe(false)
        const restored = await other.head(initial.file_id)
        expect(
          await api!.hydrate(initial.file_id, {
            operationId: 'sample-restored-hydration',
            expectedVersionId: restored.version_id,
          })
        ).toMatchObject({ status: 'complete' })
        expect(
          new Uint8Array(await fake.vault.adapter.readBinary('Media/sample-renamed.bin'))
        ).toEqual(new TextEncoder().encode('sample second'))
        expect(await otherStore.getExternalState()).toBeNull()
      } finally {
        await engine!.stop()
        await ordinary.stop()
        host!.close()
        fence!.release()
        otherStore.close()
      }
    }
  )
})

let server: SyncServer | undefined
let store: IndexedDbStateStore | undefined
afterEach(async () => {
  store?.close()
  await server?.close()
  vi.restoreAllMocks()
})

describe('external representation against the selected real server input', () => {
  it.each([false, true, 'disconnect'] as const)(
    'evicts with ordinary publication (edited=%s) and restores identical version-bound bytes',
    async (edited) => {
      server = await syncServer()
      const { accountToken } = await server.account('sample-attachment@example.invalid')
      const { vaultId } = await server.vault(accountToken, 'sample-vault')
      const device = await server.device(accountToken, vaultId, 'sample-receiver')
      const sender = await server.device(accountToken, vaultId, 'sample-sender')
      const original = new TextEncoder().encode(
        edited ? 'sample edited live attachment' : 'sample live attachment'
      )
      await seed(server.clientFor(sender.deviceToken, vaultId), [
        await create(
          server.clientFor(sender.deviceToken, vaultId),
          'Media/sample-live.bin',
          'sample live attachment',
          1000
        ),
      ])
      const client = new SyncClient({
        baseUrl: server.BASE_URL,
        token: device.deviceToken,
        fetch: server.fetch,
        WebSocket: server.WebSocket,
      }).forVault(vaultId)
      const head = (await client.manifest(null)).items[0]
      const binding = {
        endpoint: server.BASE_URL,
        vaultId,
        mode: 'personal' as const,
        principalId: device.deviceId,
        principalType: 'device' as const,
        grantId: null,
        generation: 1,
        credentialAssociation: 'sample-slot',
      }
      store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-round-trip')
      await store.put({
        path: head.path,
        wirePath: head.path,
        fileId: head.file_id,
        versionId: head.version_id,
        sha: head.sha,
        size: head.size,
        mtime: head.mtime,
      })
      await store.setCursor(head.seq)
      const state = await ExternalState.open(store, 'sample-ledger', binding)
      const fake = buildFakeVault([
        { path: head.path, content: new TextDecoder().decode(original) },
      ])
      const barrier = new RecoveryBarrier(() => {})
      barrier.activate()
      const engine = new SyncEngine({
        client,
        fs: new ObsidianFileSystem(fake as unknown as App),
        state: store,
        selective: selectiveFrom(undefined),
        recovery: barrier,
      })
      ;(
        fake.workspace as unknown as { iterateAllLeaves(fn: (leaf: unknown) => void): void }
      ).iterateAllLeaves = () => {}
      const host = new ExternalFileHost(fake as unknown as App, {
        platform: 'mobile',
        assertOwned: () => {},
      })
      try {
        const api = new AttachmentStore({
          state,
          ledger: store,
          host,
          binding,
          serial: { run: <T>(job: () => Promise<T>) => engine.runExclusive(job) },
          assertOwned: () => {},
          scriptsFolder: () => 'Scripts',
          sync: async () => {
            const report = await engine.sync()
            return {
              published:
                report.push.committed?.results.filter((result) => result.status === 'applied') ??
                [],
            }
          },
          verify: (id, expected) => client.verifyExternalFile(id, expected),
          download: (_id, _version, sha) => client.getBlob(sha),
        })
        const result = await api.evict(head.file_id, {
          operationId: 'sample-real-eviction',
          expectedRevision: 0,
          expectedVersionId: head.version_id,
        })
        expect(result).toEqual({ status: 'complete', reclaimedBytes: original.length })
        expect(await fake.vault.adapter.exists(head.path)).toBe(false)
        const published = await client.head(head.file_id)
        if (edited) expect(published.version_id).not.toBe(head.version_id)
        const restored =
          edited === 'disconnect'
            ? await api.materializeForDisconnect({ operationId: 'sample-real-departure' })
            : await api.hydrate(head.file_id, {
                operationId: 'sample-real-hydration',
                expectedVersionId: published.version_id,
              })
        expect(restored.status).toBe('complete')
        expect(new Uint8Array(await fake.vault.adapter.readBinary(head.path))).toEqual(original)
        expect((await client.head(head.file_id)).version_id).toBe(published.version_id)
        if (edited === 'disconnect') {
          expect(await api.inspectDisconnect()).toMatchObject({ safe: true, requiredBytes: 0 })
          expect(
            await new SyncClient({
              baseUrl: server.BASE_URL,
              token: device.deviceToken,
              fetch: server.fetch,
            }).revokeSelf()
          ).toBe('revoked')
          await expect(
            client.verifyExternalFile(head.file_id, {
              version_id: published.version_id,
              path: published.path,
              sha: published.sha,
              size: published.size,
            })
          ).rejects.toThrow()
          expect(new Uint8Array(await fake.vault.adapter.readBinary(head.path))).toEqual(original)
        }
      } finally {
        host.close()
      }
    }
  )
  it('a real personal sync advances remote-only metadata without delete/create/upload or client blob GET', async () => {
    server = await syncServer()
    const { accountToken } = await server.account('sample-sync@example.invalid')
    const { vaultId } = await server.vault(accountToken, 'sample-vault')
    const receiver = await server.device(accountToken, vaultId, 'sample-receiver')
    const sender = await server.device(accountToken, vaultId, 'sample-sender')
    const other = server.clientFor(sender.deviceToken, vaultId)
    await seed(other, [await create(other, 'Media/sample.bin', 'sample original', 1000)])
    const client = new SyncClient({
      baseUrl: server.BASE_URL,
      token: receiver.deviceToken,
      fetch: server.fetch,
      WebSocket: server.WebSocket,
    }).forVault(vaultId)
    const initial = (await client.manifest(null)).items[0]
    const base = {
      fileId: initial.file_id,
      versionId: initial.version_id,
      path: initial.path,
      sha: initial.sha,
      size: initial.size,
      mtime: initial.mtime,
    }
    const binding = {
      endpoint: server.BASE_URL,
      vaultId,
      mode: 'personal' as const,
      principalId: receiver.deviceId,
      principalType: 'device' as const,
      grantId: null,
      generation: 1,
      credentialAssociation: 'sample-slot',
    }
    store = await IndexedDbStateStore.open(new IDBFactory(), 'sample-server-ledger')
    await store.put({ ...base, wirePath: base.path })
    await store.setCursor(initial.seq)
    const state = await ExternalState.open(store, 'sample-ledger', binding)
    const projection = serializeProjection({
      format: 'abele.external',
      schema: 1,
      vaultId,
      fileId: base.fileId,
      path: base.path,
      observedVersionId: base.versionId,
      sha256: base.sha,
      size: base.size,
      mime: 'application/octet-stream',
      mtime: base.mtime,
    })
    await state.commit({
      expectedRevision: 0,
      files: [
        {
          expectedRevision: null,
          next: {
            schema: 1,
            ledgerId: 'sample-ledger',
            binding,
            fileId: base.fileId,
            representation: 'remote-only',
            preference: 'on-demand',
            pinned: false,
            projectionPath: base.path + '.abele-ref',
            projectionSha: await sha256(projection),
            localRevision: 0,
            pendingOperationId: null,
            availability: 'active',
            blockingReason: null,
            lastProvenLocalBase: base,
            retained: [],
          },
        },
      ],
    })
    const fake = buildFakeVault([
      {
        path: base.path + '.abele-ref',
        content: new TextDecoder().decode(projection),
        mtime: 1000,
      },
    ])
    const getBlob = vi.spyOn(client, 'getBlob'),
      putBlob = vi.spyOn(client, 'putBlob'),
      commit = vi.spyOn(client, 'commitRaw'),
      verify = vi.spyOn(client, 'verifyExternalFile')
    const runtime = await ExternalRepresentation.open({
      state,
      ledger: store,
      fs: new ObsidianFileSystem(fake as unknown as App),
      assertOwned: () => {},
      scriptsFolder: () => 'Scripts',
      verify: (id, input) => client.verifyExternalFile(id, input),
      installProjection: async () => 'cleanup-pending',
    })
    const modified = await seed(other, [
      {
        op: 'modify',
        file_id: base.fileId,
        base_version_id: base.versionId,
        ...(await blob(other, 'sample second version')),
        mtime: 2000,
      },
    ])
    const result = modified.results[0]
    const barrier = new RecoveryBarrier(() => {})
    barrier.activate()
    const engine = new SyncEngine({
      client: runtime.personalClient(client),
      fs: runtime.fileSystem(),
      state: runtime.stateStore(),
      selective: selectiveFrom(undefined),
      recovery: barrier,
    })
    const report = await engine.sync()
    expect(report.push.committed).toBeNull()
    expect(report.push.applied).toBe(0)
    expect((await client.head(base.fileId)).version_id).toBe(result.version_id)
    expect((await store.byFileId(base.fileId))?.versionId).toBe(result.version_id)
    expect(await store.getCursor()).toBe((await client.state()).head_seq)
    expect(getBlob).not.toHaveBeenCalled()
    expect(putBlob).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(verify).toHaveBeenCalledOnce()
    expect((await state.snapshot()).operations[0]).toMatchObject({
      phase: 'cleanup-pending',
      expected: { versionId: result.version_id },
    })
    expect(await fake.vault.adapter.exists(base.path)).toBe(false)
    expect(
      new TextDecoder().decode(await fake.vault.adapter.readBinary(base.path + '.abele-ref'))
    ).toBe(new TextDecoder().decode(projection))
    await engine.stop()
  })
})
