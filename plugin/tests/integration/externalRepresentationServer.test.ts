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

let server: SyncServer | undefined
let store: IndexedDbStateStore | undefined
afterEach(async () => {
  store?.close()
  await server?.close()
  vi.restoreAllMocks()
})

describe('external representation against the selected real server input', () => {
  it('evicts through live-head verification and restores identical version-bound bytes', async () => {
    server = await syncServer()
    const { accountToken } = await server.account('sample-attachment@example.invalid')
    const { vaultId } = await server.vault(accountToken, 'sample-vault')
    const device = await server.device(accountToken, vaultId, 'sample-receiver')
    const sender = await server.device(accountToken, vaultId, 'sample-sender')
    const original = new TextEncoder().encode('sample live attachment')
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
    const state = await ExternalState.open(store, 'sample-ledger', binding)
    const fake = buildFakeVault([{ path: head.path, content: 'sample live attachment' }])
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
        serial: { run: async <T>(job: () => Promise<T>) => job() },
        assertOwned: () => {},
        scriptsFolder: () => 'Scripts',
        sync: async () => {},
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
      const restored = await api.hydrate(head.file_id, {
        operationId: 'sample-real-hydration',
        expectedVersionId: head.version_id,
      })
      expect(restored.status).toBe('cleanup-pending')
      expect(new Uint8Array(await fake.vault.adapter.readBinary(head.path))).toEqual(original)
      expect((await client.head(head.file_id)).version_id).toBe(head.version_id)
    } finally {
      host.close()
    }
  })
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
