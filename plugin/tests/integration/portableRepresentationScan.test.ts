import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  MemoryStateStore,
  SyncEngine,
  scan,
  selectiveDefaults,
  prepareRemovalCohort,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { engineRemovalFileSystem } from '@/sync/privateRemovalFileSystem'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { pluginRepresentation } from '@/sync/external/pluginRepresentation'
import { RuntimeFence } from '@/sync/external/recovery'
import { ProgressiveLocalScan, SCAN_HASH_READY } from '@/sync/progressiveLocalScan'
import { buildFakeVault } from '../helpers/fakeVault'

afterEach(() => vi.restoreAllMocks())
it('keeps portable removal retention in the connection private area', async () => {
  const app = buildFakeVault([
    { path: 'Notes/sample.md', content: 'sample bytes', mtime: 1000, ctime: 1000 },
  ])
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-retention-host', app)
  try {
    const owner = 'sample-retention-owner'
    const raw = new ObsidianFileSystem(app as never, { journalOwner: owner })
    const files = engineRemovalFileSystem(raw)
    const bytes = new TextEncoder().encode('sample bytes')
    const info = await files.stat('Notes/sample.md')
    const cohort = await prepareRemovalCohort(files, [
      {
        operation: {
          path: 'Notes/sample.md',
          expected: { size: bytes.length, mtime: info!.mtime, sha: await sha256(bytes) },
          effect: { kind: 'remove' },
        },
      },
    ])
    try {
      expect(await files.stat('.abele-sync/retained-removals/summary.json')).not.toBeNull()
      expect(
        await app.vault.adapter.exists(
          connectionPrivateRoot(owner) + '/retained-removals/summary.json'
        )
      ).toBe(true)
      expect(await app.vault.adapter.exists('.abele-sync/retained-removals/summary.json')).toBe(
        false
      )
    } finally {
      await cohort.close()
    }
  } finally {
    host.close()
  }
})
it('keeps unindexed files out of an index-only discovery budget', async () => {
  const app = buildFakeVault([
    { path: '.obsidian/sample.bin', content: 'ordinary', mtime: 1000, ctime: 1000 },
  ])
  const host = await HostSyncStorage.open(new IDBFactory(), 'sample-hidden-host', app)
  try {
    const fs = new ObsidianFileSystem(app as never, { prepareStartupInventory: async () => {} })
    const info = { path: '.obsidian/sample.bin', size: 8, mtime: 1000, ctime: 1000 }
    expect(await fs[SCAN_HASH_READY](info, {})).toBeUndefined()
    const budget = new ProgressiveLocalScan(0)
    const result = await scan(budget.fileSystem(fs), new MemoryStateStore(), {
      excluded: () => false,
    })
    expect(result.hashes.has(info.path)).toBe(true)
    expect(budget.pending).toBe(false)
  } finally {
    host.close()
  }
})
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

it('checkpoints completed portable inspections before a connection loses ownership', async () => {
  const app = buildFakeVault(
    Array.from({ length: 12000 }, (_, n) => ({
      path: `Notes/sample-${n}.md`,
      content: 'ordinary',
      mtime: 1000,
      ctime: 1000,
    }))
  )
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample-host', app)
  const stores: IndexedDbStateStore[] = []
  const open = async (id: string) => {
    const store = await IndexedDbStateStore.open(factory, id)
    stores.push(store)
    const fence = new RuntimeFence(app, id, () => true)
    fence.activate()
    const fs = new ObsidianFileSystem(app as never)
    return {
      fence,
      runtime: await pluginRepresentation({
        app: app as never,
        factory,
        store,
        ledgerId: id,
        binding,
        fence,
        fs,
        scriptsFolder: () => 'Scripts',
        verify: async () => {
          throw Error('unexpected verify')
        },
      }),
    }
  }
  try {
    const first = await open('sample-connection-one')
    const listing = first.runtime.fileSystem().list()[Symbol.asyncIterator]()
    for (let n = 0; n < 40; n++) expect((await listing.next()).done).toBe(false)
    first.fence.release()
    await listing.return?.()
    expect(await host.readInspections()).toHaveLength(40)
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    const second = await open('sample-connection-two')
    const resumed = second.runtime.fileSystem().list()[Symbol.asyncIterator]()
    for (let n = 0; n < 40; n++) expect((await resumed.next()).done).toBe(false)
    await resumed.return?.()
    expect(read).not.toHaveBeenCalled()
  } finally {
    for (const store of stores) await store.close()
    host.close()
  }
}, 30000)

it('checks an unclassified copied projection before hashing or overwriting it', async () => {
  const app = buildFakeVault([
    { path: 'Notes/copied.md', content: '{"format":"abele.external"}', mtime: 1000, ctime: 1000 },
  ])
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample-marker-host', app)
  const store = await IndexedDbStateStore.open(factory, 'sample-marker-connection')
  const fence = new RuntimeFence(app, 'sample-marker-connection', () => true)
  fence.activate()
  try {
    const raw = new ObsidianFileSystem(app as never, { prepareStartupInventory: async () => {} })
    const runtime = await pluginRepresentation({
      app: app as never,
      factory,
      store,
      ledgerId: 'sample-marker-connection',
      binding,
      fence,
      fs: raw,
      scriptsFolder: () => 'Scripts',
      verify: async () => {
        throw Error('unexpected verify')
      },
    })
    const fs = runtime.fileSystem()
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    expect(await Array.fromAsync(fs.list())).toHaveLength(1)
    expect(read).not.toHaveBeenCalled()
    const result = await scan(fs, new MemoryStateStore(), { excluded: () => false })
    expect(result.ops).toEqual([])
    await expect(
      fs.writeAtomic('Notes/copied.md', new TextEncoder().encode('replacement'), 2000)
    ).rejects.toThrow()
    expect(await app.vault.adapter.read('Notes/copied.md')).toBe('{"format":"abele.external"}')
  } finally {
    fence.release()
    store.close()
    host.close()
  }
})

it('uses metadata for a cold 12k inventory and continues new content on the next connection', async () => {
  const app = buildFakeVault(
    Array.from({ length: 12000 }, (_, n) => ({
      path: `Notes/sample-${n}.md`,
      content: 'ordinary',
      mtime: 1000,
      ctime: 1000,
    }))
  )
  const factory = new IDBFactory()
  const host = await HostSyncStorage.open(factory, 'sample-background-host', app)
  const stores: IndexedDbStateStore[] = []
  const open = async (id: string) => {
    const store = await IndexedDbStateStore.open(factory, id)
    stores.push(store)
    const fence = new RuntimeFence(app, id, () => true)
    fence.activate()
    const fs = new ObsidianFileSystem(app as never, {
      journalOwner: id,
      prepareStartupInventory: async () => {},
    })
    const representation = await pluginRepresentation({
      app: app as never,
      factory,
      store,
      ledgerId: id,
      binding,
      fence,
      fs,
      scriptsFolder: () => 'Scripts',
      verify: async () => {
        throw Error('unexpected verify')
      },
    })
    const budget = new ProgressiveLocalScan()
    return { budget, fs: budget.fileSystem(representation.fileSystem()) }
  }
  try {
    const first = await open('sample-first-background')
    const read = vi.spyOn(app.vault.adapter, 'readBinary')
    let listed = 0
    for await (const _ of first.fs.list()) listed++
    expect(listed).toBe(12000)
    expect(read).not.toHaveBeenCalled()
    const result = await scan(first.fs, new MemoryStateStore(), { excluded: () => false })
    expect(result.hashes.size).toBe(32)
    expect(first.budget.pending).toBe(true)
    const completed = new Set(read.mock.calls.map(([path]) => path))
    read.mockClear()
    const second = await open('sample-second-background')
    const resumed = await scan(second.fs, new MemoryStateStore(), { excluded: () => false })
    expect(resumed.hashes.size).toBe(64)
    expect(read.mock.calls.every(([path]) => !completed.has(path))).toBe(true)
    expect(second.budget.pending).toBe(true)
    let head = 0
    const published: Array<{
      seq: number
      file_id: string
      version_id: string
      op: 'create'
      path: string
      prev_path: null
      sha: string
      size: number
      mtime: number
      kind: 'note'
      actor: { kind: 'system'; id: string; name: string }
      at: string
    }> = []
    const client = {
      prepare: async () => second.budget.begin(),
      state: async () => ({
        head_seq: head,
        settings: {
          conflict: 'merge',
          max_file_bytes: 1000000,
          quota_bytes: null,
          retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
        },
      }),
      manifest: async () => ({ items: published, head_seq: head, next: null }),
      changes: async (since: number) => ({
        items: published.filter((item) => item.seq > since),
        head_seq: head,
        next_since: head,
      }),
      hasBlob: async () => true,
      commitRaw: async (ops: { path: string; sha: string; size: number; mtime: number }[]) => ({
        replayed: false,
        body: {
          results: ops.map((op) => {
            const result = {
              ...op,
              status: 'applied',
              file_id: `sample-file-${++head}`,
              version_id: `sample-version-${head}`,
              seq: head,
            }
            // A committed row must appear in later server pages. Otherwise the
            // second pull correctly sees a departure and retains the local bytes.
            published.push({
              seq: result.seq,
              file_id: result.file_id,
              version_id: result.version_id,
              op: 'create',
              path: op.path,
              prev_path: null,
              sha: op.sha,
              size: op.size,
              mtime: op.mtime,
              kind: 'note',
              actor: { kind: 'system', id: 'sample-actor', name: 'Sample' },
              at: '',
            })
            return result
          }),
          head_seq: head,
        },
      }),
    } as unknown as EngineClient
    const engine = new SyncEngine({
      fs: engineRemovalFileSystem(second.fs),
      state: new MemoryStateStore(),
      client,
      selective: selectiveDefaults(),
    })
    try {
      await engine.sync()
      expect(engine.status.state).toBe('idle')
      expect(engine.status.lastSyncAt).toBeTruthy()
      expect(second.budget.pending).toBe(true)
      expect(new Set(read.mock.calls.map(([path]) => path)).size).toBeLessThan(100)
    } finally {
      await engine.stop()
    }
  } finally {
    for (const store of stores) store.close()
    host.close()
  }
}, 30000)
