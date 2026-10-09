import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  scan,
  sha256,
  SyncEngine,
  MemoryStateStore,
  RecoveryBarrier,
  ScopedState,
  scanScopedChanges,
  pullScoped,
} from '@abele/sync-core'
import type { App } from 'obsidian'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ExternalState } from '@/sync/external/state'
import { ExternalRepresentation } from '@/sync/external/representation'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { serializeProjection } from '@/sync/external/projection'
import { buildFakeVault } from '../helpers/fakeVault'

const binding = {
  endpoint: 'https://sync.example.invalid',
  vaultId: 'sample-vault',
  mode: 'personal' as const,
  principalId: 'sample-device',
  principalType: 'device' as const,
  grantId: null,
  generation: 1,
  credentialAssociation: 'sample-slot',
}
const path = 'Media/sample.bin',
  id = 'sample-file'
const bytes = new TextEncoder().encode('sample base')
const entry = {
  path,
  wirePath: path,
  fileId: id,
  versionId: 'sample-v1',
  sha: await sha256(bytes),
  size: bytes.length,
  mtime: 1000,
}
const cleanups: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0)) close()
})

async function setup(scopedMode = false) {
  const localBinding = scopedMode
    ? {
        ...binding,
        mode: 'scoped' as const,
        principalType: 'installation' as const,
        principalId: 'sample-principal',
        grantId: 'sample-grant',
      }
    : binding
  const factory = new IDBFactory(),
    name = 'sample-representation'
  const store = await IndexedDbStateStore.open(factory, name)
  cleanups.push(() => store.close())
  const scoped = scopedMode
    ? await ScopedState.open(
        store,
        {
          version: 4,
          facet: 'scoped',
          endpoint_identity: binding.endpoint,
          vault_id: binding.vaultId,
          grant_id: 'sample-grant',
          principal_kind: 'installation',
          principal_id: 'sample-principal',
          credential_fingerprint: 'c'.repeat(64),
        },
        { initialize: true }
      )
    : undefined
  await store.put(entry)
  if (scoped)
    await scoped.putKnown({
      file_id: id,
      version_id: entry.versionId,
      path,
      sha: entry.sha,
      size: entry.size,
      mtime: entry.mtime,
      state: 'materialized',
      dirty: false,
      native: true,
    })
  const state = await ExternalState.open(store, 'sample-ledger', localBinding)
  const projection = serializeProjection({
    format: 'abele.external',
    schema: 1,
    vaultId: binding.vaultId,
    fileId: id,
    path,
    observedVersionId: entry.versionId,
    sha256: entry.sha,
    size: entry.size,
    mime: 'application/octet-stream',
    mtime: entry.mtime,
  })
  const file = {
    schema: 1 as const,
    ledgerId: 'sample-ledger',
    binding: localBinding,
    fileId: id,
    representation: 'remote-only' as const,
    preference: 'on-demand' as const,
    pinned: false,
    projectionPath: path + '.abele-ref',
    projectionSha: await sha256(projection),
    localRevision: 0,
    pendingOperationId: null,
    availability: 'active' as const,
    blockingReason: null,
    lastProvenLocalBase: {
      fileId: id,
      versionId: entry.versionId,
      path,
      sha: entry.sha,
      size: entry.size,
      mtime: entry.mtime,
    },
    retained: [],
  }
  await state.commit({ expectedRevision: 0, files: [{ expectedRevision: null, next: file }] })
  const fake = buildFakeVault([
    { path: file.projectionPath, content: new TextDecoder().decode(projection), mtime: 1000 },
  ])
  const fs = new ObsidianFileSystem(fake as unknown as App)
  const verify = vi.fn(
    async (
      fileId: string,
      input: { version_id: string; path: string; sha: string; size: number }
    ) => ({ ...input, file_id: fileId, verified: true as const })
  )
  const runtime = await ExternalRepresentation.open({
    state,
    ledger: store,
    scoped,
    fs,
    verify,
    assertOwned: () => {},
    scriptsFolder: () => 'Scripts',
    installProjection: async () => 'cleanup-pending',
  })
  return { factory, name, store, state, scoped, fake, fs, runtime, verify, file, projection }
}
const event = (patch = {}) => ({
  seq: 2,
  file_id: id,
  version_id: 'sample-v2',
  op: 'modify',
  path,
  prev_path: null,
  sha: 'b'.repeat(64),
  size: 18,
  mtime: 2000,
  kind: 'attachment',
  actor: { kind: 'system', id: 'sample-actor', name: 'Sample' },
  at: '',
  ...patch,
})
const filter = { excluded: () => false }

// BUG: ordinary scanner/pull paths do not yet share external representation policy.
describe('common external representation and durable remote projection work', () => {
  it('intentional absence produces neither a server delete nor dirty; ordinary sidecars still sync', async () => {
    const s = await setup()
    await s.fake.vault.adapter.writeBinary(
      'Media/sample-user.abele-ref',
      new TextEncoder().encode('sample ordinary file').buffer
    )
    const result = await scan(s.runtime.fileSystem(), s.runtime.stateStore(), filter)
    expect(result.ops.map((op) => op.op)).toEqual(['create'])
    expect(result.ops[0]).toMatchObject({ path: 'Media/sample-user.abele-ref' })
    expect([...result.dirty]).not.toContain(path)
  })

  it('recognizable renamed/damaged projections are never folder-native creates', async () => {
    const s = await setup()
    await s.fake.vault.adapter.rename(s.file.projectionPath, 'Media/sample-renamed.txt')
    const scopedBinding = {
      version: 4 as const,
      facet: 'scoped' as const,
      endpoint_identity: binding.endpoint,
      vault_id: binding.vaultId,
      grant_id: 'sample-grant',
      principal_kind: 'installation' as const,
      principal_id: 'sample-principal',
      credential_fingerprint: 'c'.repeat(64),
    }
    const scoped = await ScopedState.open(new MemoryStateStore(), scopedBinding, {
      initialize: true,
    })
    expect(await scanScopedChanges(s.runtime.fileSystem(), scoped, 'Media/')).toEqual([])
    expect((await scan(s.runtime.fileSystem(), s.runtime.stateStore(), filter)).ops).toEqual([])
    await s.fake.vault.adapter.writeBinary(
      s.file.projectionPath,
      new TextEncoder().encode('sample damaged bytes').buffer
    )
    expect((await scan(s.runtime.fileSystem(), s.runtime.stateStore(), filter)).ops).toEqual([])
  })

  it('a recognizable projection with an ordinary ledger entry is held, not interpreted as deletion or replay', async () => {
    const s = await setup(),
      foreignPath = 'Media/sample-foreign.txt',
      foreignId = 'sample-foreign-file'
    await s.fake.vault.adapter.writeBinary(foreignPath, s.projection.buffer)
    await s.store.put({
      ...entry,
      path: foreignPath,
      wirePath: foreignPath,
      fileId: foreignId,
      sha: await sha256(s.projection),
      size: s.projection.byteLength,
    })
    const result = await scan(s.runtime.fileSystem(), s.runtime.stateStore(), filter)
    expect(result.ops).toEqual([])
    const commitRaw = vi.fn(async () => ({ body: { results: [] }, replayed: false }))
    await expect(
      s.runtime
        .personalClient({ commitRaw } as never)
        .commitRaw(
          [{ op: 'delete', file_id: foreignId, base_version_id: entry.versionId }],
          'sample-held-replay'
        )
    ).rejects.toThrow('recovery')
    expect(commitRaw).not.toHaveBeenCalled()
  })

  it('metadata-only pages persist projection jobs before cursor advancement and never GET client blobs', async () => {
    const s = await setup(),
      getBlob = vi.fn(async () => {
        throw Error('No blob read for metadata')
      })
    const client = s.runtime.personalClient({
      changes: async () => ({ items: [event()], next_since: 2, head_seq: 2 }),
      getBlob,
    } as never)
    const page = await client.changes(1)
    expect(page.items).toEqual([])
    const snapshot = await s.state.snapshot()
    expect(snapshot.operations).toHaveLength(1)
    expect(snapshot.operations[0].expected?.versionId).toBe('sample-v2')
    expect((await s.store.byFileId(id))?.versionId).toBe('sample-v2')
    expect(await s.store.getCursor()).toBe(0)
    await s.runtime.stateStore().setCursor(2)
    expect(getBlob).not.toHaveBeenCalled()
    expect(s.verify).toHaveBeenCalledOnce()
  })

  it('metadata-only pages do not prematurely end an ordinary feed walk when later pages contain real files', async () => {
    const s = await setup(),
      ordinary = event({ seq: 3, file_id: 'sample-note', path: 'Notes/sample.md', kind: 'note' })
    const changes = vi.fn(async (since: number) =>
      since < 2
        ? { items: [event()], next_since: 2, head_seq: 3 }
        : { items: [ordinary], next_since: 3, head_seq: 3 }
    )
    const client = s.runtime.personalClient({ changes } as never)
    expect((await client.changes(1)).items).toEqual([ordinary])
    expect(changes).toHaveBeenCalledTimes(2)
    expect((await s.state.snapshot()).operations).toHaveLength(1)
  })

  it('reopening after cursor advance recovers or holds durable work without another event', async () => {
    const s = await setup()
    await s.runtime.accept(event() as never)
    await s.runtime.stateStore().setCursor(2)
    s.store.close()
    const reopened = await IndexedDbStateStore.open(s.factory, s.name)
    cleanups.push(() => reopened.close())
    const state = await ExternalState.open(reopened, 'sample-ledger', binding)
    const runtime = await ExternalRepresentation.open({
      state,
      ledger: reopened,
      fs: s.fs,
      verify: s.verify,
      assertOwned: () => {},
      scriptsFolder: () => 'Scripts',
      installProjection: async () => 'cleanup-pending',
    })
    await runtime.recoverJobs()
    expect(await reopened.getCursor()).toBe(2)
    const snapshot = await state.snapshot()
    expect(snapshot.operations[0].phase).toBe('cleanup-pending')
    expect(snapshot.files[0].pendingOperationId).toBe(snapshot.operations[0].operationId)
    expect(await s.fake.vault.adapter.readBinary(s.file.projectionPath)).toEqual(
      s.projection.buffer
    )
  })

  it('rename, delete, detach and restore retain identity, preferences and dependencies', async () => {
    const s = await setup()
    await s.runtime.accept(
      event({ path: 'Media/sample-renamed.bin', prev_path: path, op: 'move' }) as never
    )
    await s.runtime.accept(
      event({
        op: 'delete',
        sha: null,
        size: null,
        mtime: null,
        version_id: 'sample-deleted',
      }) as never
    )
    await s.runtime.detach(id)
    let file = (await s.state.snapshot()).files[0]
    expect(file).toMatchObject({
      fileId: id,
      preference: 'on-demand',
      representation: 'remote-only',
      availability: 'detached',
    })
    expect(file.lastProvenLocalBase?.versionId).toBe('sample-v1')
    expect(file.projectionPath).toBe(path + '.abele-ref')
    await s.runtime.accept(event({ op: 'restore', version_id: 'sample-restored' }) as never)
    file = (await s.state.snapshot()).files[0]
    expect(file).toMatchObject({ fileId: id, preference: 'on-demand', availability: 'active' })
    expect((await s.state.snapshot()).operations.length).toBe(4)
  })

  it('an unexpected original keeps its earlier proven base and dirty hold after new metadata', async () => {
    const s = await setup()
    await s.fake.vault.adapter.writeBinary(
      path,
      new TextEncoder().encode('sample unexpected edit').buffer
    )
    expect(await s.runtime.classify(path)).toMatchObject({
      kind: 'hold',
      reason: 'unexpected-original',
      dirty: true,
      base: { versionId: 'sample-v1' },
    })
    await s.runtime.accept(event() as never)
    expect(await s.runtime.classify(path)).toMatchObject({
      kind: 'hold',
      dirty: true,
      base: { versionId: 'sample-v1' },
    })
    expect((await s.state.snapshot()).files[0].lastProvenLocalBase?.versionId).toBe('sample-v1')
    expect((await scan(s.runtime.fileSystem(), s.runtime.stateStore(), filter)).ops).toEqual([])
  })

  it('an unknown projection installation is held across recovery, never blindly retried', async () => {
    const s = await setup(),
      install = vi.fn(async () => {
        throw Error('sample lost installation acknowledgement')
      })
    const runtime = await ExternalRepresentation.open({
      state: s.state,
      ledger: s.store,
      fs: s.fs,
      verify: s.verify,
      assertOwned: () => {},
      scriptsFolder: () => 'Scripts',
      installProjection: install,
    })
    await runtime.accept(event() as never)
    await runtime.recoverJobs()
    expect(install).toHaveBeenCalledOnce()
    expect((await s.state.snapshot()).operations[0].phase).toBe('held')
  })

  it('an observed unexpected original remains a dirty dependency after disappearance and newer metadata', async () => {
    const s = await setup()
    await s.fake.vault.adapter.writeBinary(
      path,
      new TextEncoder().encode('sample unexpected edit').buffer
    )
    await s.runtime.accept(event() as never)
    await s.fake.vault.adapter.remove(path)
    await s.runtime.accept(event({ version_id: 'sample-v3', seq: 3 }) as never)
    expect(await s.runtime.classify(path)).toMatchObject({
      kind: 'hold',
      dirty: true,
      base: { versionId: 'sample-v1' },
    })
    expect((await s.state.snapshot()).files[0].blockingReason).toBe('unexpected-original')
  })

  it('server verification failure and projection edits preserve bytes and pending work', async () => {
    const s = await setup()
    s.verify.mockRejectedValueOnce(Error('sample unavailable'))
    await s.runtime.accept(event() as never)
    expect((await s.state.snapshot()).operations[0].phase).toBe('held')
    expect(await s.fake.vault.adapter.readBinary(s.file.projectionPath)).toEqual(
      s.projection.buffer
    )
    await s.fake.vault.adapter.writeBinary(
      s.file.projectionPath,
      new TextEncoder().encode('sample user edit').buffer
    )
    await s.runtime.recoverJobs()
    expect(
      new TextDecoder().decode(await s.fake.vault.adapter.readBinary(s.file.projectionPath))
    ).toBe('sample user edit')
  })

  it('an overlong rename sidecar is a durable collision hold, not a cursor-stalling malformed job', async () => {
    const s = await setup()
    await s.runtime.accept(
      event({ op: 'move', path: 'Media/' + 'x'.repeat(250), prev_path: path }) as never
    )
    const snapshot = await s.state.snapshot()
    expect(snapshot.files[0].blockingReason).toBe('collision')
    expect(snapshot.operations[0]).toMatchObject({ phase: 'held', targetPath: null })
    expect(s.verify).not.toHaveBeenCalled()
    expect(await s.fake.vault.adapter.readBinary(s.file.projectionPath)).toEqual(
      s.projection.buffer
    )
    await s.runtime.stateStore().setCursor(2)
    expect(await s.store.getCursor()).toBe(2)
  })

  it('script/settings eligibility and selective exclusion cannot materialize through attachment installation', async () => {
    const s = await setup()
    await s.runtime.accept(event({ kind: 'script', path: 'Scripts/sample.js' }) as never)
    expect((await s.state.snapshot()).files[0].blockingReason).toBe('approval-required')
    expect(s.verify).not.toHaveBeenCalled()
    await s.runtime.accept(
      event({ version_id: 'sample-v3', path: '.obsidian/sample.json', kind: 'settings' }) as never
    )
    expect((await s.state.snapshot()).files[0].blockingReason).toBe('approval-required')
    expect((await scan(s.runtime.fileSystem(), s.runtime.stateStore(), filter)).ops).toEqual([])
  })

  it('publication replay and uploads refuse managed identities/paths instead of adopting by matching SHA', async () => {
    const s = await setup(),
      commitRaw = vi.fn(),
      putBlob = vi.fn()
    const client = s.runtime.personalClient({ commitRaw, putBlob } as never)
    await expect(
      client.commitRaw(
        [{ op: 'delete', file_id: id, base_version_id: entry.versionId }],
        'sample-replay'
      )
    ).rejects.toThrow('recovery')
    await expect(
      client.commitRaw(
        [
          {
            op: 'create',
            path: s.file.projectionPath,
            sha: entry.sha,
            size: entry.size,
            mtime: entry.mtime,
          },
        ],
        'sample-create'
      )
    ).rejects.toThrow('recovery')
    expect(commitRaw).not.toHaveBeenCalled()
    const fs = s.runtime.fileSystem()
    await expect(fs.writeAtomic(path, bytes, 1000)).rejects.toThrow('recovery')
  })

  it('a publication receipt hook can wrap the scoped commit without recursively calling itself', async () => {
    const s = await setup(true),
      rawCommit = vi.fn(async () => ({ results: [] }))
    const client = s.runtime.scopedClient({ commit: rawCommit } as never)
    const original = client.commit.bind(client)
    let hooks = 0
    client.commit = async (request) => {
      if (++hooks > 1) throw Error('sample recursive publication hook')
      return original(request)
    }
    await expect(
      client.commit({
        request_id: 'sample-request',
        ops: [
          {
            op: 'create',
            path: 'Notes/sample-new.md',
            sha: entry.sha,
            size: entry.size,
            mtime: 1000,
          },
        ],
      })
    ).resolves.toEqual({ results: [] })
    expect(hooks).toBe(1)
    expect(rawCommit).toHaveBeenCalledOnce()
  })

  it('scoped feed advances only after durable metadata/jobs, preserving native provenance without version downloads', async () => {
    const s = await setup(true),
      head = {
        file_id: id,
        version_id: 'sample-v2',
        path,
        sha: 'b'.repeat(64),
        size: 18,
        mtime: 2000,
        kind: 'attachment',
      }
    const checkpoint = { kind: 'scoped' as const, token: 'sample-after' }
    await s.scoped!.setCheckpoint({ kind: 'scoped', token: 'sample-before' })
    const version = vi.fn(async () => {
      throw Error('No client version download')
    })
    const client = s.runtime.scopedClient({
      binding: s.scoped!.binding,
      negotiate: async () => ({ state: { state: 'active' } }),
      feed: async () => ({
        checkpoint,
        has_more: false,
        events: [{ type: 'content', file: head }],
      }),
      head: async () => head,
      version,
    } as never)
    const report = await pullScoped({
      client,
      state: s.runtime.scopedState(s.scoped!),
      fs: s.runtime.fileSystem(),
    })
    expect(report.complete).toBe(true)
    expect(await s.scoped!.getCheckpoint()).toEqual(checkpoint)
    expect((await s.state.snapshot()).operations).toHaveLength(1)
    expect(await s.scoped!.getKnown(id)).toMatchObject({ version_id: 'sample-v2', native: true })
    expect(version).not.toHaveBeenCalled()
    expect(s.verify).toHaveBeenCalledOnce()
  })

  it('revocation during scoped verification records lost access without a personal fallback or byte removal', async () => {
    const s = await setup(true)
    s.verify.mockRejectedValueOnce(
      Object.assign(Error('sample grant revoked'), { code: 'forbidden' })
    )
    await s.runtime.accept(event() as never)
    expect((await s.state.snapshot()).files[0]).toMatchObject({
      availability: 'detached',
      preference: 'on-demand',
      lastProvenLocalBase: { versionId: 'sample-v1' },
    })
    expect((await s.scoped!.getKnown(id))?.state).toBe('detached')
    expect(await s.fake.vault.adapter.readBinary(s.file.projectionPath)).toEqual(
      s.projection.buffer
    )
    expect(s.verify).toHaveBeenCalledOnce()
  })

  it('replay repairs a scoped metadata commit that failed after durable job intent, before checkpoint advance', async () => {
    const s = await setup(true),
      put = s.scoped!.putKnown.bind(s.scoped!)
    vi.spyOn(s.scoped!, 'putKnown')
      .mockRejectedValueOnce(Error('sample aborted head write'))
      .mockImplementation(put)
    await expect(s.runtime.accept(event() as never)).rejects.toThrow('sample aborted')
    expect((await s.state.snapshot()).operations).toHaveLength(1)
    expect((await s.scoped!.getKnown(id))?.version_id).toBe('sample-v1')
    await s.runtime.accept(event() as never)
    expect((await s.scoped!.getKnown(id))?.version_id).toBe('sample-v2')
    expect((await s.state.snapshot()).operations).toHaveLength(1)
  })

  it('scoped snapshot work waits for the complete anchored inventory and terminal feed proof', async () => {
    const s = await setup(true),
      head = {
        file_id: id,
        version_id: 'sample-v2',
        path,
        sha: 'b'.repeat(64),
        size: 18,
        mtime: 2000,
        kind: 'attachment',
      }
    const checkpoint = { kind: 'scoped' as const, token: 'sample-anchor' }
    const client = s.runtime.scopedClient({
      openSnapshot: async () => ({
        snapshot_id: 'sample-snapshot',
        cursor: 'sample-first',
        next_cursor: 'sample-last',
        checkpoint,
        items: [head],
      }),
      snapshotPage: async () => ({
        snapshot_id: 'sample-snapshot',
        cursor: 'sample-last',
        next_cursor: null,
        checkpoint,
        feed_checkpoint: checkpoint,
        items: [],
      }),
      head: async () => head,
    } as never)
    await client.openSnapshot()
    expect((await s.state.snapshot()).operations).toEqual([])
    await client.snapshotPage('sample-snapshot', 'sample-last')
    expect((await s.state.snapshot()).operations).toHaveLength(1)
  })

  it('changing scripts_folder or selective policy holds pending work without restoring sync inclusion', async () => {
    const s = await setup(),
      install = vi.fn(async () => 'cleanup-pending' as const)
    let scripts = 'Scripts',
      excluded = false
    const runtime = await ExternalRepresentation.open({
      state: s.state,
      ledger: s.store,
      fs: s.fs,
      verify: s.verify,
      assertOwned: () => {},
      scriptsFolder: () => scripts,
      excluded: () => excluded,
      installProjection: install,
    })
    excluded = true
    await runtime.accept(event() as never)
    expect((await s.state.snapshot()).files[0].blockingReason).toBe('excluded')
    expect(install).not.toHaveBeenCalled()
    excluded = false
    scripts = 'Media'
    await runtime.recoverJobs()
    expect((await s.state.snapshot()).files[0].blockingReason).toBe('approval-required')
    expect(install).not.toHaveBeenCalled()
    expect((await s.state.snapshot()).files[0].preference).toBe('on-demand')
  })

  it('the adopted shared recovery barrier prevents constructor scope effects and all early verbs', async () => {
    const state = new MemoryStateStore(),
      put = vi.spyOn(state, 'setMeta'),
      barrier = new RecoveryBarrier(() => {})
    const engine = new SyncEngine({
      state,
      fs: {} as never,
      client: {} as never,
      selective: {} as never,
      recovery: barrier,
    })
    await Promise.resolve()
    expect(put).not.toHaveBeenCalled()
    await expect(engine.sync()).rejects.toThrow('recovery')
    expect(() => engine.start()).toThrow('recovery')
  })
})
